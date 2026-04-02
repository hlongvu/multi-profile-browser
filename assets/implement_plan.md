# ProfileBrowser — Detailed Technical Implementation Plan

> Based on: `ProfileBrowser-Plan.md`
> Last updated: 2026-04-02

---

## 0. Prerequisites & Tooling Setup

### Required versions
- Node.js ≥ 20 LTS
- Electron ≥ 30 (Chromium 124+)
- TypeScript ≥ 5.4
- Vite ≥ 5 (with `vite-plugin-electron`)

### Initial scaffold

```bash
npm create vite@latest profilebrowser -- --template react-ts
cd profilebrowser
npm install electron electron-builder vite-plugin-electron \
  electron-store playwright-core @monaco-editor/react ws
npm install -D @types/ws @types/node concurrently cross-env
```

### `vite.config.ts`

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';

export default defineConfig({
  plugins: [
    react(),
    electron([
      { entry: 'src/main/index.ts' },
      { entry: 'src/main/preload.ts', onstart(args) { args.reload(); } },
    ]),
  ],
});
```

### `tsconfig.json` roots
- `src/main/` — `module: CommonJS`, `target: ES2022`
- `src/renderer/` — `module: ESNext`, `jsx: react-jsx`
- `src/shared/` — shared by both, `module: ESNext`

---

## 1. Shared Types (`src/shared/types.ts`)

Define all cross-boundary contracts first so main and renderer stay in sync.

```ts
export interface Profile {
  id: string;                   // crypto.randomUUID()
  name: string;
  color: string;                // hex, shown in tab
  partition: string;            // 'persist:profile-<id>'
  userAgent?: string;
  proxyConfig?: string;         // 'socks5://host:port' | 'direct://'
  homeUrl: string;              // last visited URL, persisted
  cdpPort?: number;             // assigned when proxy is running
  createdAt: number;
}

export interface Script {
  id: string;
  name: string;
  code: string;
  profileId?: string;           // null = global
  updatedAt: number;
}

export interface RunResult {
  success: boolean;
  logs: LogEntry[];
  error?: string;
  durationMs: number;
}

export interface LogEntry {
  level: 'log' | 'warn' | 'error';
  message: string;
  ts: number;
}

// IPC channel names — keep in one place to avoid typos
export const IPC = {
  // Renderer → Main (invoke)
  PROFILE_CREATE:    'profile:create',
  PROFILE_DELETE:    'profile:delete',
  PROFILE_LIST:      'profile:list',
  PROFILE_UPDATE:    'profile:update',
  BROWSER_NAVIGATE:  'browser:navigate',
  BROWSER_BACK:      'browser:back',
  BROWSER_FORWARD:   'browser:forward',
  BROWSER_RELOAD:    'browser:reload',
  CDP_START:         'cdp:startProxy',
  CDP_STOP:          'cdp:stopProxy',
  SCRIPT_RUN:        'script:run',
  SCRIPT_STOP:       'script:stop',
  SCRIPT_SAVE:       'script:save',
  SCRIPT_LIST:       'script:list',
  SCRIPT_DELETE:     'script:delete',
  // Main → Renderer (send)
  BROWSER_TITLE:     'browser:titleChanged',
  BROWSER_FAVICON:   'browser:faviconChanged',
  BROWSER_LOADING:   'browser:loadingChanged',
  BROWSER_URL:       'browser:urlChanged',
  SCRIPT_LOG:        'script:log',
  SCRIPT_DONE:       'script:done',
} as const;
```

---

## 2. Phase 1 — Core Shell

### 2.1 Main entry (`src/main/index.ts`)

```ts
import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { ProfileManager } from './profileManager';
import { BrowserViewManager } from './browserViewManager';
import { registerIpcHandlers } from './ipc';

const TOOLBAR_HEIGHT = 72; // px — keep in sync with renderer CSS var

let win: BrowserWindow;

app.commandLine.appendSwitch('remote-debugging-port', '9222');
// Disable web security only in dev — never in production
// app.commandLine.appendSwitch('disable-web-security');

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    titleBarStyle: 'hiddenInset',   // native macOS traffic lights
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const profileManager = new ProfileManager();
  const viewManager = new BrowserViewManager(win, profileManager, TOOLBAR_HEIGHT);

  registerIpcHandlers(win, profileManager, viewManager);

  win.on('resize', () => viewManager.recalculateBounds());

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

### 2.2 Preload (`src/main/preload.ts`)

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/types';

contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (channel: string, ...args: unknown[]) => {
    const allowed = Object.values(IPC);
    if (!allowed.includes(channel as any)) throw new Error(`Blocked IPC: ${channel}`);
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel: string, cb: (...args: unknown[]) => void) => {
    const listener = (_: Electron.IpcRendererEvent, ...args: unknown[]) => cb(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);   // cleanup fn
  },
});
```

### 2.3 Profile Manager (`src/main/profileManager.ts`)

```ts
import Store from 'electron-store';
import crypto from 'crypto';
import { Profile } from '../shared/types';

interface StoreSchema { profiles: Profile[] }

export class ProfileManager {
  private store = new Store<StoreSchema>({ defaults: { profiles: [] } });

  list(): Profile[] { return this.store.get('profiles'); }

  get(id: string): Profile | undefined {
    return this.list().find(p => p.id === id);
  }

  create(name: string, color: string): Profile {
    const id = crypto.randomUUID();
    const profile: Profile = {
      id,
      name,
      color,
      partition: `persist:profile-${id}`,  // stable, UUID-based — never raw user input
      homeUrl: 'about:blank',
      createdAt: Date.now(),
    };
    this.store.set('profiles', [...this.list(), profile]);
    return profile;
  }

  update(id: string, patch: Partial<Profile>): Profile {
    const profiles = this.list().map(p => p.id === id ? { ...p, ...patch } : p);
    this.store.set('profiles', profiles);
    return profiles.find(p => p.id === id)!;
  }

  delete(id: string): void {
    this.store.set('profiles', this.list().filter(p => p.id !== id));
  }
}
```

### 2.4 BrowserView Manager (`src/main/browserViewManager.ts`)

Key rules:
- One `BrowserView` per profile, created lazily on first activation.
- Only one view is visible at a time (`win.setBrowserView()`).
- Bounds are always recalculated after mount and after any window resize.

```ts
import { BrowserWindow, BrowserView, session } from 'electron';
import { Profile } from '../shared/types';
import { ProfileManager } from './profileManager';

export class BrowserViewManager {
  private views = new Map<string, BrowserView>();

  constructor(
    private win: BrowserWindow,
    private profiles: ProfileManager,
    private toolbarHeight: number,
  ) {}

  private create(profile: Profile): BrowserView {
    const ses = session.fromPartition(profile.partition);

    // Apply proxy before creating the view
    if (profile.proxyConfig) {
      ses.setProxy({ proxyRules: profile.proxyConfig });
    }
    if (profile.userAgent) {
      ses.setUserAgent(profile.userAgent);
    }

    const view = new BrowserView({
      webPreferences: {
        session: ses,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    // Wire up push events to renderer
    view.webContents.on('page-title-updated', (_, title) => {
      this.win.webContents.send('browser:titleChanged', { profileId: profile.id, title });
    });
    view.webContents.on('page-favicon-updated', (_, favicons) => {
      this.win.webContents.send('browser:faviconChanged', { profileId: profile.id, favicon: favicons[0] });
    });
    view.webContents.on('did-start-loading', () => {
      this.win.webContents.send('browser:loadingChanged', { profileId: profile.id, loading: true });
    });
    view.webContents.on('did-stop-loading', () => {
      this.win.webContents.send('browser:loadingChanged', { profileId: profile.id, loading: false });
      const url = view.webContents.getURL();
      this.win.webContents.send('browser:urlChanged', { profileId: profile.id, url });
      this.profiles.update(profile.id, { homeUrl: url });
    });

    this.views.set(profile.id, view);
    return view;
  }

  activate(profileId: string): void {
    const profile = this.profiles.get(profileId);
    if (!profile) return;

    let view = this.views.get(profileId);
    if (!view) view = this.create(profile);

    this.win.setBrowserView(view);
    this.recalculateBounds();

    if (view.webContents.getURL() === '' || view.webContents.getURL() === 'about:blank') {
      if (profile.homeUrl && profile.homeUrl !== 'about:blank') {
        view.webContents.loadURL(profile.homeUrl);
      }
    }
  }

  recalculateBounds(): void {
    const view = this.win.getBrowserView();
    if (!view) return;
    const { width, height } = this.win.getBounds();
    view.setBounds({ x: 0, y: this.toolbarHeight, width, height: height - this.toolbarHeight });
  }

  navigate(profileId: string, url: string): void {
    const view = this.views.get(profileId);
    if (!view) return;
    const normalized = url.startsWith('http') ? url : `https://${url}`;
    view.webContents.loadURL(normalized);
  }

  back(profileId: string): void  { this.views.get(profileId)?.webContents.goBack(); }
  forward(profileId: string): void { this.views.get(profileId)?.webContents.goForward(); }
  reload(profileId: string): void  { this.views.get(profileId)?.webContents.reload(); }

  destroy(profileId: string): void {
    const view = this.views.get(profileId);
    if (!view) return;
    if (this.win.getBrowserView() === view) this.win.setBrowserView(null);
    // BrowserView does not have a .destroy(), remove all listeners instead
    view.webContents.removeAllListeners();
    this.views.delete(profileId);
  }

  getWebContentsId(profileId: string): number | undefined {
    return this.views.get(profileId)?.webContents.id;
  }
}
```

### 2.5 IPC Handlers (`src/main/ipc/index.ts`)

```ts
import { BrowserWindow, ipcMain } from 'electron';
import { IPC } from '../../shared/types';
import { ProfileManager } from '../profileManager';
import { BrowserViewManager } from '../browserViewManager';

export function registerIpcHandlers(
  win: BrowserWindow,
  profiles: ProfileManager,
  views: BrowserViewManager,
) {
  ipcMain.handle(IPC.PROFILE_LIST,   () => profiles.list());
  ipcMain.handle(IPC.PROFILE_CREATE, (_, name, color) => {
    const p = profiles.create(name, color);
    views.activate(p.id);
    return p;
  });
  ipcMain.handle(IPC.PROFILE_DELETE, (_, id) => {
    views.destroy(id);
    profiles.delete(id);
  });
  ipcMain.handle(IPC.PROFILE_UPDATE, (_, id, patch) => profiles.update(id, patch));

  ipcMain.handle(IPC.BROWSER_NAVIGATE, (_, profileId, url) => views.navigate(profileId, url));
  ipcMain.handle(IPC.BROWSER_BACK,     (_, profileId) => views.back(profileId));
  ipcMain.handle(IPC.BROWSER_FORWARD,  (_, profileId) => views.forward(profileId));
  ipcMain.handle(IPC.BROWSER_RELOAD,   (_, profileId) => views.reload(profileId));

  // Tab switch — activate the view
  ipcMain.handle('browser:activateProfile', (_, profileId) => views.activate(profileId));
}
```

### 2.6 Renderer (`src/renderer/`)

#### `App.tsx` — skeleton

```tsx
import { useState, useEffect } from 'react';
import { Profile, IPC } from '../shared/types';
import { ProfileTabs } from './components/ProfileTabs';
import { AddressBar } from './components/AddressBar';

declare global {
  interface Window {
    electronAPI: {
      invoke(channel: string, ...args: unknown[]): Promise<unknown>;
      on(channel: string, cb: (...args: unknown[]) => void): () => void;
    };
  }
}

export default function App() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [urlMap, setUrlMap] = useState<Record<string, string>>({});
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    window.electronAPI.invoke(IPC.PROFILE_LIST).then(p => {
      const list = p as Profile[];
      setProfiles(list);
      if (list.length > 0) activate(list[0].id);
    });

    const offUrl = window.electronAPI.on('browser:urlChanged', ({ profileId, url }: any) =>
      setUrlMap(m => ({ ...m, [profileId]: url })));
    const offLoading = window.electronAPI.on('browser:loadingChanged', ({ profileId, loading }: any) =>
      setLoadingMap(m => ({ ...m, [profileId]: loading })));

    return () => { offUrl(); offLoading(); };
  }, []);

  const activate = (id: string) => {
    setActiveId(id);
    window.electronAPI.invoke('browser:activateProfile', id);
  };

  return (
    <div className="shell">
      <ProfileTabs
        profiles={profiles}
        activeId={activeId}
        onSelect={activate}
        onAdd={() => { /* open dialog */ }}
        onClose={id => { /* delete flow */ }}
      />
      <AddressBar
        url={urlMap[activeId ?? ''] ?? ''}
        loading={loadingMap[activeId ?? ''] ?? false}
        onNavigate={url => activeId && window.electronAPI.invoke(IPC.BROWSER_NAVIGATE, activeId, url)}
        onBack={() => activeId && window.electronAPI.invoke(IPC.BROWSER_BACK, activeId)}
        onForward={() => activeId && window.electronAPI.invoke(IPC.BROWSER_FORWARD, activeId)}
        onReload={() => activeId && window.electronAPI.invoke(IPC.BROWSER_RELOAD, activeId)}
      />
    </div>
  );
}
```

#### CSS variable contract
```css
:root { --toolbar-height: 72px; }
.shell { height: var(--toolbar-height); }  /* renderer never goes below toolbar */
```

> The `--toolbar-height` value must match `TOOLBAR_HEIGHT` in `index.ts` exactly.

---

## 3. Phase 2 — Session Persistence & Profile Settings

### 3.1 Profile settings IPC

Add `PROFILE_UPDATE` handler (already in IPC list). The renderer sends a patch:

```ts
await window.electronAPI.invoke(IPC.PROFILE_UPDATE, id, {
  userAgent: 'Mozilla/5.0 ...',
  proxyConfig: 'socks5://127.0.0.1:1080',
});
```

Main process applies the patch to the store. For the proxy/UA to take effect on an active view, the session must be reconfigured:

```ts
// in ipcMain.handle(IPC.PROFILE_UPDATE):
const updated = profiles.update(id, patch);
const ses = session.fromPartition(updated.partition);
if (patch.proxyConfig !== undefined) await ses.setProxy({ proxyRules: patch.proxyConfig });
if (patch.userAgent !== undefined) ses.setUserAgent(patch.userAgent);
// Reload the active view so the new settings take effect
views.reload(id);
```

### 3.2 Import / Export

```ts
// Export: zip partition folder + store entry
import AdmZip from 'adm-zip';
import path from 'path';
import { app } from 'electron';

export function exportProfile(profile: Profile, destPath: string): void {
  const zip = new AdmZip();
  const partitionDir = path.join(
    app.getPath('userData'),
    'Partitions',
    profile.partition.replace('persist:', ''),
  );
  zip.addLocalFolder(partitionDir, 'partition');
  zip.addFile('profile.json', Buffer.from(JSON.stringify(profile)));
  zip.writeZip(destPath);
}

export function importProfile(zipPath: string, profiles: ProfileManager): Profile {
  const zip = new AdmZip(zipPath);
  const meta: Profile = JSON.parse(zip.readAsText('profile.json'));
  const newId = crypto.randomUUID();
  const newPartition = `persist:profile-${newId}`;
  const destDir = path.join(app.getPath('userData'), 'Partitions', `profile-${newId}`);
  zip.extractEntryTo('partition', destDir, false, true);
  return profiles.create(meta.name, meta.color); // creates fresh record, data already on disk
}
```

---

## 4. Phase 3 — CDP Remote Debugging

### 4.1 CDP Proxy (`src/main/cdpProxy.ts`)

```ts
import WebSocket, { WebSocketServer } from 'ws';
import http from 'http';

interface ProxyHandle { wss: WebSocketServer; close(): void }
const proxies = new Map<string, ProxyHandle>();

interface CdpTarget { id: string; webSocketDebuggerUrl: string; }

async function findTargetUrl(webContentsId: number): Promise<string> {
  const res = await fetch('http://localhost:9222/json/list');
  const targets: CdpTarget[] = await res.json();
  // Electron encodes webContents.id in the target id as the last segment
  const target = targets.find(t => t.id.endsWith(`${webContentsId}`));
  if (!target) throw new Error(`No CDP target for webContents ${webContentsId}`);
  return target.webSocketDebuggerUrl;
}

export async function startCdpProxy(
  profileId: string,
  externalPort: number,
  webContentsId: number,
): Promise<void> {
  if (proxies.has(profileId)) return; // already running

  const targetUrl = await findTargetUrl(webContentsId);

  const wss = new WebSocketServer({ port: externalPort });

  wss.on('connection', (client) => {
    const upstream = new WebSocket(targetUrl);
    const forward = (src: WebSocket, dst: WebSocket) =>
      src.on('message', (msg, isBinary) => {
        if (dst.readyState === WebSocket.OPEN) dst.send(msg, { binary: isBinary });
      });
    forward(client, upstream);
    forward(upstream, client);
    client.on('close', () => upstream.terminate());
    upstream.on('close', () => client.terminate());
    upstream.on('error', () => client.terminate());
  });

  proxies.set(profileId, {
    wss,
    close() { wss.close(); proxies.delete(profileId); },
  });
}

export function stopCdpProxy(profileId: string): void {
  proxies.get(profileId)?.close();
}
```

### 4.2 Port allocation strategy

```ts
// Assign ports sequentially starting at 9223 (9222 is Electron's master port)
const CDP_BASE_PORT = 9223;

function assignPort(profiles: Profile[]): number {
  const usedPorts = new Set(profiles.map(p => p.cdpPort).filter(Boolean));
  let port = CDP_BASE_PORT;
  while (usedPorts.has(port)) port++;
  return port;
}
```

### 4.3 IPC registration

```ts
ipcMain.handle(IPC.CDP_START, async (_, profileId) => {
  const profile = profiles.get(profileId)!;
  const port = assignPort(profiles.list());
  const wcId = views.getWebContentsId(profileId)!;
  await startCdpProxy(profileId, port, wcId);
  profiles.update(profileId, { cdpPort: port });
  return port;
});

ipcMain.handle(IPC.CDP_STOP, (_, profileId) => {
  stopCdpProxy(profileId);
  profiles.update(profileId, { cdpPort: undefined });
});
```

---

## 5. Phase 4 — Script Automation Engine

### 5.1 Script Worker (`src/main/scriptWorker.ts`)

Runs in a `worker_threads` Worker so it can be terminated on timeout without affecting the main process.

```ts
// This file is the worker entry — loaded via new Worker(...)
import { workerData, parentPort } from 'worker_threads';
import { chromium } from 'playwright-core';

const { scriptCode, profileIndex } = workerData as { scriptCode: string; profileIndex: number };

async function run() {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[profileIndex];
  if (!context) throw new Error(`No context at index ${profileIndex}`);
  const page = context.pages()[0] ?? await context.newPage();

  // Redirect console from the script into the worker message channel
  const log = (level: string, ...args: unknown[]) =>
    parentPort!.postMessage({ type: 'log', level, message: args.join(' '), ts: Date.now() });

  const console = { log: (...a: unknown[]) => log('log', ...a),
                    warn: (...a: unknown[]) => log('warn', ...a),
                    error: (...a: unknown[]) => log('error', ...a) };

  const fn = new Function('page', 'console', `return (async () => { ${scriptCode} })()`);
  await fn(page, console);
  parentPort!.postMessage({ type: 'done', success: true });
}

run().catch(err => {
  parentPort!.postMessage({ type: 'done', success: false, error: err.message });
});
```

### 5.2 Script Runner (`src/main/scriptRunner.ts`)

```ts
import { Worker } from 'worker_threads';
import path from 'path';
import { BrowserWindow } from 'electron';
import { IPC } from '../shared/types';

const activeWorkers = new Map<string, Worker>();

export function runScript(
  win: BrowserWindow,
  profileId: string,
  profileIndex: number,
  scriptCode: string,
): void {
  if (activeWorkers.has(profileId)) throw new Error('Script already running for this profile');

  const worker = new Worker(path.join(__dirname, 'scriptWorker.js'), {
    workerData: { scriptCode, profileIndex },
  });

  const TIMEOUT_MS = 30_000;
  const timer = setTimeout(() => {
    worker.terminate();
    win.webContents.send(IPC.SCRIPT_DONE, { profileId, success: false, error: 'Timeout' });
  }, TIMEOUT_MS);

  worker.on('message', (msg) => {
    if (msg.type === 'log') {
      win.webContents.send(IPC.SCRIPT_LOG, { profileId, ...msg });
    } else if (msg.type === 'done') {
      clearTimeout(timer);
      activeWorkers.delete(profileId);
      win.webContents.send(IPC.SCRIPT_DONE, { profileId, ...msg });
    }
  });

  worker.on('error', (err) => {
    clearTimeout(timer);
    activeWorkers.delete(profileId);
    win.webContents.send(IPC.SCRIPT_DONE, { profileId, success: false, error: err.message });
  });

  activeWorkers.set(profileId, worker);
}

export function stopScript(profileId: string): void {
  activeWorkers.get(profileId)?.terminate();
  activeWorkers.delete(profileId);
}
```

### 5.3 Script persistence (`electron-store`)

```ts
// In ProfileManager or a dedicated ScriptStore
private scriptStore = new Store<{ scripts: Script[] }>({ name: 'scripts', defaults: { scripts: [] } });

saveScript(script: Omit<Script, 'id' | 'updatedAt'>): Script {
  const entry: Script = { ...script, id: crypto.randomUUID(), updatedAt: Date.now() };
  this.scriptStore.set('scripts', [...this.listScripts(), entry]);
  return entry;
}
listScripts(): Script[] { return this.scriptStore.get('scripts'); }
deleteScript(id: string): void {
  this.scriptStore.set('scripts', this.listScripts().filter(s => s.id !== id));
}
```

### 5.4 Monaco editor integration

```tsx
// src/renderer/components/ScriptEditor.tsx
import Editor from '@monaco-editor/react';
import { useState, useEffect } from 'react';
import { IPC } from '../../shared/types';

export function ScriptEditor({ profileId }: { profileId: string }) {
  const [code, setCode] = useState('// Write your automation script here\n');
  const [logs, setLogs] = useState<string[]>([]);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const offLog = window.electronAPI.on(IPC.SCRIPT_LOG, ({ message, level }: any) =>
      setLogs(l => [...l, `[${level}] ${message}`]));
    const offDone = window.electronAPI.on(IPC.SCRIPT_DONE, ({ success, error }: any) => {
      setRunning(false);
      if (!success) setLogs(l => [...l, `[error] ${error}`]);
    });
    return () => { offLog(); offDone(); };
  }, []);

  const run = () => {
    setLogs([]);
    setRunning(true);
    window.electronAPI.invoke(IPC.SCRIPT_RUN, profileId, code);
  };

  return (
    <div className="script-panel">
      <Editor
        height="300px"
        language="javascript"
        value={code}
        onChange={v => setCode(v ?? '')}
        theme="vs-dark"
        options={{ minimap: { enabled: false }, fontSize: 13 }}
      />
      <div className="script-toolbar">
        <button onClick={run} disabled={running}>Run</button>
        <button onClick={() => window.electronAPI.invoke(IPC.SCRIPT_STOP, profileId)} disabled={!running}>Stop</button>
      </div>
      <pre className="script-output">{logs.join('\n')}</pre>
    </div>
  );
}
```

---

## 6. Phase 5 — Polish & Packaging

### 6.1 Keyboard shortcuts

Register in `index.ts` using `globalShortcut` or `Menu`:

```ts
import { Menu, MenuItem } from 'electron';

const menu = new Menu();
menu.append(new MenuItem({
  label: 'Browser',
  submenu: [
    { label: 'New Profile',   accelerator: 'CmdOrCtrl+T', click: () => win.webContents.send('ui:newProfile') },
    { label: 'Close Profile', accelerator: 'CmdOrCtrl+W', click: () => win.webContents.send('ui:closeProfile') },
    { label: 'Focus Address', accelerator: 'CmdOrCtrl+L', click: () => win.webContents.send('ui:focusAddress') },
  ],
}));
Menu.setApplicationMenu(menu);
```

### 6.2 Auto-update (`electron-updater`)

```ts
import { autoUpdater } from 'electron-updater';

autoUpdater.checkForUpdatesAndNotify();
autoUpdater.on('update-available', () => win.webContents.send('update:available'));
autoUpdater.on('update-downloaded', () => win.webContents.send('update:ready'));
// On user confirm:
ipcMain.handle('update:install', () => autoUpdater.quitAndInstall());
```

`electron-builder.config.js`:
```js
module.exports = {
  appId: 'com.yourname.profilebrowser',
  productName: 'ProfileBrowser',
  publish: [{ provider: 'github', owner: 'yourname', repo: 'profilebrowser' }],
  mac: {
    target: [{ target: 'dmg', arch: ['universal'] }],
    hardenedRuntime: true,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
  },
  win: { target: [{ target: 'nsis', arch: ['x64'] }] },
  linux: { target: [{ target: 'AppImage', arch: ['x64'] }] },
};
```

`build/entitlements.mac.plist` (required for Hardened Runtime + notarization):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.network.client</key><true/>
  <key>com.apple.security.files.user-selected.read-write</key><true/>
</dict>
</plist>
```

---

## 7. Security Checklist

| Risk | Mitigation |
|---|---|
| XSS → Node.js access | `contextIsolation: true`, `nodeIntegration: false` in all webPreferences |
| IPC channel spoofing | Allowlist in preload — only channels defined in `IPC` enum are callable |
| Raw user input as partition name | Always `persist:profile-${crypto.randomUUID()}` |
| User script DoS | `worker_threads` + 30s hard timeout |
| Proxy misconfiguration | `setProxy` is called before `BrowserView` creation |
| Outdated Electron | Keep `electron` dependency pinned and updated — Chromium CVEs |
| Remote debugging exposure | Debug port 9222 binds to `localhost` only by default |

---

## 8. Testing Strategy

| Layer | Tool | What to test |
|---|---|---|
| Unit | Vitest | ProfileManager CRUD, port allocation, URL normalization |
| Integration | Playwright (test mode) | IPC round-trips, profile isolation (cookie leakage) |
| E2E | `playwright/electron` | Tab switching, script execution, CDP proxy connection |

---

## 9. Implementation Order (strict)

1. `shared/types.ts` — types + IPC constants
2. `main/preload.ts` — bridge, allowlist
3. `main/profileManager.ts` — store CRUD
4. `main/browserViewManager.ts` — view lifecycle
5. `main/ipc/index.ts` — handlers
6. `main/index.ts` — app bootstrap
7. Renderer: `App.tsx`, `ProfileTabs`, `AddressBar`
8. `main/cdpProxy.ts` — Phase 3
9. `main/scriptWorker.ts` + `scriptRunner.ts` — Phase 4
10. Renderer: `ScriptEditor`, `DevToolsPanel` — Phase 4
11. Packaging config, update flow — Phase 5
