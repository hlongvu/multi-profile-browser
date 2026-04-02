import { app, BrowserWindow, Menu, MenuItem } from 'electron';
import path from 'path';
import { ProfileManager } from './profileManager';
import { BrowserViewManager } from './browserViewManager';
import { registerIpcHandlers } from './ipc';

const TOOLBAR_HEIGHT = 72;

let win: BrowserWindow;

console.log('Starting ProfileBrowser...');

app.commandLine.appendSwitch('remote-debugging-port', '9222');

app.whenReady().then(() => {
  console.log('App ready, creating window...');
  
  win = new BrowserWindow({
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

  console.log('Window created');

  const profileManager = new ProfileManager();
  const viewManager = new BrowserViewManager(win, profileManager, TOOLBAR_HEIGHT);

  registerIpcHandlers(win, profileManager, viewManager);

  win.on('resize', () => viewManager.recalculateBounds());
  
  win.on('closed', () => {
    console.log('Window closed');
    win = undefined as any;
  });

  const menu = new Menu();
  menu.append(new MenuItem({
    label: 'Browser',
    submenu: [
      { label: 'New Profile', accelerator: 'CmdOrCtrl+T', click: () => win.webContents.send('ui:newProfile') },
      { label: 'Close Profile', accelerator: 'CmdOrCtrl+W', click: () => win.webContents.send('ui:closeProfile') },
      { label: 'Focus Address', accelerator: 'CmdOrCtrl+L', click: () => win.webContents.send('ui:focusAddress') },
    ],
  }));
  Menu.setApplicationMenu(menu);

  if (process.env.VITE_DEV_SERVER_URL) {
    console.log('Loading dev URL:', process.env.VITE_DEV_SERVER_URL);
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    const indexPath = path.join(__dirname, '../dist/renderer/index.html');
    console.log('Loading file:', indexPath);
    win.loadFile(indexPath);
  }
  
  win.webContents.on('did-finish-load', () => {
    console.log('Window content loaded');
  });
  
  win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.log('Failed to load:', errorCode, errorDescription);
  });
});

app.on('window-all-closed', () => {
  console.log('All windows closed');
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  console.log('App activated');
  if (win === undefined) {
    // Recreate window if needed
  }
});
