# ProfileBrowser — Multiplatform Desktop App Plan

A multi-profile in-app browser built on Electron with remote debugging and script automation support.

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Framework | Electron (latest) + TypeScript | Multiplatform, full Node.js access |
| Renderer UI | React + TypeScript | Component model fits tab/panel layout |
| In-app browser | `BrowserView` (one per profile) | More stable API than `<webview>` tag |
| Profile isolation | `session.fromPartition('persist:<id>')` | Separate cookies, cache, localStorage per profile |
| Persistence | `electron-store` | Lightweight JSON store for profile metadata |
| Remote debugging | `ws` WebSocket proxy + CDP | Route external DevTools to per-profile targets |
| Automation | `playwright-core` over CDP | Attach to existing Electron Chromium, no second browser |
| Script editor | Monaco Editor (renderer) | VSCode-quality editing in-app |
| Packaging | `electron-builder` | DMG / NSIS / AppImage targets |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Renderer Process (React UI)             │
│      Profile tabs · Script editor · DevTools panel       │
└────────────────────┬────────────────────────────────────┘
                     │ IPC (contextBridge / ipcRenderer ↔ ipcMain)
┌────────────────────▼────────────────────────────────────┐
│                  Main Process (Node.js)                  │
│    Profile manager · Script runner · CDP proxy · Window  │
└──────┬──────────────────┬──────────────────┬────────────┘
       │                  │                  │
┌──────▼──────┐  ┌────────▼──────┐  ┌───────▼──────┐
│  Profile A  │  │   Profile B   │  │  Profile N   │
│ BrowserView │  │  BrowserView  │  │ BrowserView  │
│ partition:A │  │  partition:B  │  │ partition:N  │
│ CDP :9222   │  │  CDP :9223    │  │ CDP :922N    │
└──────┬──────┘  └────────┬──────┘  └───────┬──────┘
       │                  │                  │
┌──────▼──────┐  ┌────────▼──────┐  ┌───────▼──────┐
│ Persistence │  │   CDP Proxy   │  │Script Engine │
│electron-store│ │  WS per port  │  │ Playwright   │
└─────────────┘  └───────────────┘  └──────────────┘
```

---

## Project Structure

```
profilebrowser/
├── src/
│   ├── main/
│   │   ├── index.ts                # App bootstrap, window creation
│   │   ├── profileManager.ts       # Create / delete / switch profiles
│   │   ├── browserViewManager.ts   # BrowserView lifecycle per profile
│   │   ├── cdpProxy.ts             # WebSocket proxy for remote debugging
│   │   ├── scriptRunner.ts         # Playwright CDP automation
│   │   └── ipc/                    # All ipcMain handlers
│   ├── renderer/
│   │   ├── App.tsx                 # Profile tab bar + BrowserView overlay
│   │   ├── components/
│   │   │   ├── ProfileTabs.tsx
│   │   │   ├── ScriptEditor.tsx    # Monaco editor for automation scripts
│   │   │   ├── DevToolsPanel.tsx   # CDP port display + DevTools link
│   │   │   └── AddressBar.tsx
│   │   └── hooks/
│   │       └── useIpc.ts
│   └── shared/
│       └── types.ts                # Profile, Script, RunResult types
├── scripts/                        # Saved user automation scripts
├── electron-builder.config.js
└── package.json
```

---

## Phase Plan

### Phase 1 — Core Shell (Week 1–2)

**Goal:** Working multi-session browser with tab switching.

- Scaffold Electron + React + TypeScript with Vite
- Build the main window with a profile tab bar at the top
- Implement `profileManager.ts`:
  - Profile model: `{ id, name, color, partition, userAgent, proxyConfig }`
  - Backed by `electron-store` for metadata persistence
- Implement `browserViewManager.ts`:
  - One `BrowserView` per profile, associated with its named partition
  - Mount/unmount on tab switch via `win.setBrowserView()`
  - Recalculate bounds on every window resize
- Wire a basic address bar (navigate, back, forward, reload) via IPC
- Add "New Profile" and "Delete Profile" flows in the UI

**Deliverable:** Switch between isolated browser sessions; Gmail login in Profile A does not appear in Profile B.

---

### Phase 2 — Session Persistence & Login Sites (Week 2–3)

**Goal:** Logins to Gmail, Facebook, Twitter survive app restarts.

- Sessions persist automatically via Electron's named partitions stored in `userData/`
- Add profile settings panel:
  - Custom User-Agent string per profile (reduces detection risk)
  - Proxy configuration: `session.setProxy({ proxyRules: 'socks5://...' })`
- Add profile avatar / color picker in the "New Profile" dialog
- Add a profile import / export feature:
  - Export: zip the partition folder + `electron-store` metadata entry
  - Import: unzip into `userData/` and register in the store
- Pre-load convenience shortcuts for Gmail, Facebook, Twitter in the address bar suggestions

**Deliverable:** Full session isolation with persistent login state and per-profile proxy + user agent.

---

### Phase 3 — CDP Remote Debugging (Week 3–4)

**Goal:** Each profile exposes its own CDP port for external DevTools connections.

#### How it works

Electron launches with one process-level debug port (`--remote-debugging-port=9222`). All `BrowserView` targets are listed under this single port. The CDP proxy differentiates them by `webContents.id`.

#### Implementation

**Main process — launch flag** (`index.ts`):
```ts
app.commandLine.appendSwitch('remote-debugging-port', '9222');
```

**`cdpProxy.ts`** — spin up one WS server per profile:
```ts
import WebSocket, { WebSocketServer } from 'ws';
import http from 'http';

export async function startCdpProxy(profileId: string, externalPort: number, targetUrl: string) {
  const wss = new WebSocketServer({ port: externalPort });
  wss.on('connection', (client) => {
    const upstream = new WebSocket(targetUrl); // targetUrl from /json/list
    client.on('message', (msg) => upstream.send(msg));
    upstream.on('message', (msg) => client.send(msg));
    client.on('close', () => upstream.close());
    upstream.on('close', () => client.close());
  });
}
```

**Target matching** — fetch `http://localhost:9222/json/list`, cross-reference `webContents.id` stored at `BrowserView` creation time with the `id` field in the CDP target list.

**UI** — DevTools panel shows:
```
Profile A  →  chrome://inspect  →  add localhost:9222
Profile B  →  chrome://inspect  →  add localhost:9223
```

**Deliverable:** Open Chrome DevTools externally and inspect any profile's page independently.

---

### Phase 4 — Script Automation Engine (Week 4–5)

**Goal:** Run click/scroll/type/evaluate scripts against any profile's page.

#### Architecture

Scripts run in the main process inside a `worker_threads` worker (prevents blocking the UI). Each worker gets a timeout (default 30s). Logs and errors stream back to the renderer via IPC.

#### Connecting Playwright to the existing browser

```ts
// scriptRunner.ts
import { chromium } from 'playwright-core';

export async function runScript(profileIndex: number, scriptCode: string) {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[profileIndex];
  const page = context.pages()[0];

  // Expose a safe `page` API to the user script
  const fn = new Function('page', scriptCode);
  await fn(page);
}
```

#### Available script actions

```ts
// Click a button
await page.click('#submit-btn');

// Scroll the page
await page.evaluate(() => window.scrollTo(0, 500));

// Type into an input
await page.fill('input[name="q"]', 'search query');

// Wait for element
await page.waitForSelector('.feed-item', { timeout: 5000 });

// Take a screenshot
const buf = await page.screenshot();

// Run arbitrary JS in the page context
const title = await page.evaluate(() => document.title);
```

#### UI

- Monaco Editor embedded in a slide-over panel
- "Run" button executes the script against the currently active profile
- A profile selector dropdown lets you target a different profile while staying on the current tab
- Output console shows logs, errors, and screenshot previews
- Script library: save / load named scripts per profile via `electron-store`

**Deliverable:** Write and execute automation scripts against any profile directly from the app.

---

### Phase 5 — Polish & Packaging (Week 5–6)

**Goal:** Shippable multiplatform builds with a polished UX.

#### Packaging (`electron-builder.config.js`)

```js
module.exports = {
  appId: 'com.yourname.profilebrowser',
  productName: 'ProfileBrowser',
  mac: {
    target: [{ target: 'dmg', arch: ['universal'] }],
    category: 'public.app-category.productivity',
    hardenedRuntime: true,
    entitlements: 'build/entitlements.mac.plist',
  },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
  },
  linux: {
    target: [{ target: 'AppImage', arch: ['x64'] }],
  },
};
```

- Set up Apple code signing + notarization for macOS
- Set up EV certificate signing for Windows
- Auto-update via `electron-updater` pointing to a GitHub Releases feed

#### UX polish checklist

- [ ] Keyboard shortcuts: `Cmd/Ctrl+T` new profile tab, `Cmd/Ctrl+W` close tab, `Cmd/Ctrl+L` focus address bar
- [ ] Drag-to-reorder profile tabs
- [ ] Per-profile favicon shown in the tab bar
- [ ] "Open in external browser" button in the address bar
- [ ] Dark/light mode following system preference
- [ ] Onboarding flow for first-time users (create first profile, visit a site)

---

## Key Gotchas

### BrowserView bounds management
`BrowserView` lives outside the DOM and is positioned in pixel coordinates. Recalculate bounds on **every** window resize and tab switch:

```ts
browserView.setBounds({
  x: 0,
  y: TOOLBAR_HEIGHT,
  width: win.getBounds().width,
  height: win.getBounds().height - TOOLBAR_HEIGHT,
});
```

Missing this is the most common source of visual glitches (misaligned or clipped browser view).

### CDP target matching
All `BrowserView` instances appear as targets under the single debug port. At creation time, store the `webContents.id` in your profile record. Cross-reference it with the `id` field from `/json/list` to find the right target's `webSocketDebuggerUrl`.

### Playwright + Electron Chromium
Use `playwright-core` (no bundled browsers) and point it at Electron's own Chromium:

```ts
const browser = await chromium.connectOverCDP('http://localhost:9222');
```

This avoids shipping a second ~200MB Chromium binary inside your app.

### Session partition naming
Use a stable, sanitized prefix — never use raw user input as a partition name:

```ts
const partition = `persist:profile-${crypto.randomUUID()}`;
```

### Script sandboxing
Run user scripts in a `worker_threads` Worker with a hard timeout to prevent blocking the main process:

```ts
const worker = new Worker('./scriptWorker.js', { workerData: { script, port: 9222 } });
const timer = setTimeout(() => worker.terminate(), 30_000);
worker.on('exit', () => clearTimeout(timer));
```

### Proxy per profile
Apply the proxy **before** the `BrowserView` is created — `setProxy` on an active session may not take effect immediately:

```ts
const ses = session.fromPartition(profile.partition);
await ses.setProxy({ proxyRules: profile.proxyConfig });
const view = new BrowserView({ webPreferences: { session: ses } });
```

---

## IPC Surface (shared/types.ts)

```ts
// Renderer → Main
'profile:create'    (name: string, color: string) => Profile
'profile:delete'    (id: string) => void
'profile:list'      () => Profile[]
'browser:navigate'  (profileId: string, url: string) => void
'cdp:startProxy'    (profileId: string, port: number) => void
'cdp:stopProxy'     (profileId: string) => void
'script:run'        (profileId: string, code: string) => RunResult
'script:stop'       (profileId: string) => void

// Main → Renderer (push events)
'browser:titleChanged'   { profileId, title }
'browser:faviconChanged' { profileId, favicon }
'browser:loadingChanged' { profileId, loading }
'script:log'             { profileId, message, level }
'script:done'            { profileId, success, error? }
```

---

## Milestones Summary

| Phase | Weeks | Deliverable |
|---|---|---|
| 1 — Core shell | 1–2 | Multi-session browser with tab switching |
| 2 — Persistence & login | 2–3 | Persistent sessions, proxy, user agent per profile |
| 3 — CDP remote debugging | 3–4 | External DevTools per profile via WS proxy |
| 4 — Script automation | 4–5 | Monaco editor + Playwright script runner |
| 5 — Polish & packaging | 5–6 | Signed builds for macOS, Windows, Linux |
