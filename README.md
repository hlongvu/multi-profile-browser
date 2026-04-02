# ProfileBrowser

A multi-profile desktop browser built with Electron, featuring isolated browser profiles with separate cookies/cache, CDP remote debugging, and Playwright script automation.

## Prerequisites

- Node.js 18+
- npm 9+

## Install Dependencies

```bash
npm install
```

## Development

### Run Vite Dev Server (React UI only)

```bash
npm run dev
```

### Run Electron App in Development Mode

```bash
npm run electron:dev
```

This runs both Vite dev server and Electron concurrently with development mode enabled.

### Type Checking

```bash
npm run typecheck
```

### Linting

```bash
npm run lint
```

## Build

### Build for Production

```bash
npm run electron:build
```

Output will be in the `release` directory:
- macOS: `release/mac/ProfileBrowser-{version}.dmg`
- Windows: `release/win-unpacked/ProfileBrowser.exe`
- Linux: `release/linux-unpacked/profilebrowser`

## Usage

1. **Create a Profile**: Click the `+` button in the left sidebar
2. **Navigate**: Type a URL in the address bar and press Enter
3. **Switch Profiles**: Click on a profile tab to switch between isolated browsing contexts
4. **Delete Profile**: Click the `×` button on a profile tab
5. **DevTools**: Access CDP debugging via the devtools panel (click the expand button)

## Features

- **Isolated Profiles**: Each profile has its own cookies, cache, and localStorage
- **CDP Remote Debugging**: Connect external tools (like Playwright) to individual profiles
- **Script Automation**: Run Playwright scripts against specific profiles
- **Vertical Tab Layout**: Profile tabs displayed on the left sidebar with color indicators
