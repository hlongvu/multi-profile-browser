import { app, BrowserWindow, Menu, MenuItem } from 'electron';
import path from 'path';
import { ProfileManager } from './profileManager';
import { BrowserViewManager } from './browserViewManager';
import { registerIpcHandlers } from './ipc';
import { startApiServer } from './apiServer';
import net from 'net';

app.setName('ProfileBrowser');

const TOOLBAR_HEIGHT = 48;
const SIDEBAR_WIDTH = 180;

let win: BrowserWindow;
let cdpPort: number;
let profileManager: ProfileManager;
let viewManager: BrowserViewManager;
let initialized = false;

console.log('Starting ProfileBrowser...');

async function findAvailablePort(startPort = 9222): Promise<number> {
  let port = startPort;
  while (port < 9300) {
    try {
      await new Promise<void>((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.once('listening', () => {
          server.close();
          resolve();
        });
        server.listen(port, '127.0.0.1');
      });
      return port;
    } catch {
      port++;
    }
  }
  throw new Error('No available port found for CDP');
}

export function getCdpPort(): number {
  return cdpPort;
}

async function initCdp() {
  cdpPort = await findAvailablePort();
  app.commandLine.appendSwitch('remote-debugging-port', cdpPort.toString());
  app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
  console.log(`Using CDP port: ${cdpPort}`);
}

initCdp().catch(err => {
  console.error('Failed to initialize CDP:', err);
  process.exit(1);
});

function createWindow(): BrowserWindow {
  const newWin = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (!viewManager) {
    viewManager = new BrowserViewManager(newWin, profileManager, TOOLBAR_HEIGHT, SIDEBAR_WIDTH);
  } else {
    viewManager = new BrowserViewManager(newWin, profileManager, TOOLBAR_HEIGHT, SIDEBAR_WIDTH);
  }

  newWin.on('resize', () => viewManager.recalculateBounds());
  newWin.on('closed', () => {
    console.log('Window closed');
    win = undefined as any;
  });

  newWin.webContents.on('did-finish-load', () => {
    console.log('Window content loaded');
  });

  newWin.webContents.on('did-fail-load', (_, errorCode, errorDescription) => {
    console.log('Failed to load:', errorCode, errorDescription);
  });

  return newWin;
}

function createMenu() {
  const menu = new Menu();
  menu.append(new MenuItem({
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  }));
  menu.append(new MenuItem({
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ],
  }));
  menu.append(new MenuItem({
    label: 'Browser',
    submenu: [
      { label: 'New Profile', accelerator: 'CmdOrCtrl+T', click: () => win?.webContents.send('ui:newProfile') },
      { label: 'Close Profile', accelerator: 'CmdOrCtrl+W', click: () => win?.webContents.send('ui:closeProfile') },
      { label: 'Focus Address', accelerator: 'CmdOrCtrl+L', click: () => win?.webContents.send('ui:focusAddress') },
    ],
  }));
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  console.log('App ready, creating window...');

  profileManager = new ProfileManager();

  win = createWindow();
  console.log('Window created');

  createMenu();
  registerIpcHandlers(win, profileManager, viewManager);
  startApiServer(profileManager, viewManager);
  initialized = true;

  if (process.env.VITE_DEV_SERVER_URL) {
    console.log('Loading dev URL:', process.env.VITE_DEV_SERVER_URL);
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    const indexPath = path.join(__dirname, '../dist/renderer/index.html');
    console.log('Loading file:', indexPath);
    win.loadFile(indexPath);
  }
});

app.on('window-all-closed', () => {
  console.log('All windows closed');
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  console.log('App activated');
  if (win === undefined) {
    win = createWindow();
    console.log('Window recreated');

    if (process.env.VITE_DEV_SERVER_URL) {
      win.loadURL(process.env.VITE_DEV_SERVER_URL);
    } else {
      const indexPath = path.join(__dirname, '../dist/renderer/index.html');
      win.loadFile(indexPath);
    }
  } else {
    win.show();
  }
});