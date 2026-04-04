import { BrowserWindow, ipcMain, session, dialog, app } from 'electron';
import { IPC } from '../../shared/types';
import { ProfileManager } from '../profileManager';
import { BrowserViewManager } from '../browserViewManager';
import { startCdpProxy, stopCdpProxy, getCdpProxyPort } from '../cdpProxy';
import { runScript, stopScript } from '../scriptRunner';

const CDP_BASE_PORT = 9223;

function assignPort(profiles: { cdpPort?: number }[]): number {
  const usedPorts = new Set(profiles.map(p => p.cdpPort).filter(Boolean));
  let port = CDP_BASE_PORT;
  while (usedPorts.has(port)) port++;
  return port;
}

export function registerIpcHandlers(
  win: BrowserWindow,
  profiles: ProfileManager,
  views: BrowserViewManager,
) {
  ipcMain.handle(IPC.SETTINGS_GET_STORAGE_PATH, () => profiles.getStoragePath());
  ipcMain.handle(IPC.SETTINGS_SELECT_STORAGE_PATH, async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select Profile Storage Folder',
    });
    if (!result.canceled && result.filePaths.length > 0) {
      profiles.setStoragePath(result.filePaths[0]);
      app.relaunch();
      app.exit(0);
      return result.filePaths[0];
    }
    return null;
  });
  ipcMain.handle(IPC.PROFILE_LIST, () => profiles.list());
  ipcMain.handle(IPC.PROFILE_CREATE, (_, name, color) => {
    const p = profiles.create(name, color);
    views.activate(p.id);
    return p;
  });
  ipcMain.handle(IPC.PROFILE_DELETE, (_, id) => {
    views.destroy(id);
    profiles.delete(id);
  });
  ipcMain.handle(IPC.PROFILE_UPDATE, (_, id, patch) => {
    const updated = profiles.update(id, patch);
    const ses = session.fromPath(profiles.resolvePartition(updated.partition));
    if (patch.proxyConfig !== undefined) {
      ses.setProxy({ proxyRules: patch.proxyConfig });
    }
    if (patch.userAgent !== undefined) {
      ses.setUserAgent(patch.userAgent);
    }
    views.reload(id);
    return updated;
  });

  ipcMain.handle(IPC.PROFILE_GET_RUNNING, () => {
    const activeIds = views.getActiveProfileIds();
    return profiles.list().filter(p => activeIds.includes(p.id)).map(p => ({
      id: p.id,
      name: p.name,
      color: p.color,
      cdpPort: p.cdpPort,
      isActive: views.isActive(p.id),
    }));
  });

  ipcMain.handle(IPC.BROWSER_NAVIGATE, (_, profileId, url) => {
    console.log('[IPC] BROWSER_NAVIGATE:', profileId, url);
    views.navigate(profileId, url);
  });
  ipcMain.handle(IPC.BROWSER_BACK, (_, profileId) => views.back(profileId));
  ipcMain.handle(IPC.BROWSER_FORWARD, (_, profileId) => views.forward(profileId));
  ipcMain.handle(IPC.BROWSER_RELOAD, (_, profileId) => views.reload(profileId));

  ipcMain.handle(IPC.BROWSER_ACTIVATE, (_, profileId) => views.activate(profileId));

  let lastActiveProfileId: string | null = null;
  ipcMain.handle(IPC.SETTINGS_SHOW, () => {
    const active = views.getActiveProfileIds().find(id => views.isActive(id));
    if (active) lastActiveProfileId = active;
    views.hideAll();
  });
  ipcMain.handle(IPC.SETTINGS_HIDE, () => {
    views.hideAll();
    if (lastActiveProfileId) {
      views.show(lastActiveProfileId);
    }
  });

  ipcMain.handle(IPC.CDP_START, async (_, profileId) => {
    // Return existing proxy port if already running
    const existingPort = getCdpProxyPort(profileId);
    if (existingPort !== undefined) return existingPort;

    const port = assignPort(profiles.list());
    const result = await views.ensureViewAndWait(profileId);
    if (!result) throw new Error('Failed to create view');
    await startCdpProxy(profileId, result.cdpSessionId, port);
    profiles.update(profileId, { cdpPort: port });
    return port;
  });

  ipcMain.handle(IPC.CDP_STOP, (_, profileId) => {
    stopCdpProxy(profileId);
    profiles.update(profileId, { cdpPort: undefined });
  });

  ipcMain.handle(IPC.SCRIPT_LIST, () => profiles.listScripts());
  ipcMain.handle(IPC.SCRIPT_SAVE, (_, script) => profiles.saveScript(script));
  ipcMain.handle(IPC.SCRIPT_DELETE, (_, id) => profiles.deleteScript(id));

  ipcMain.handle(IPC.SCRIPT_RUN, (_, profileId, profileIndex, code) => {
    runScript(win, profileId, profileIndex as number, code as string);
  });
  ipcMain.handle(IPC.SCRIPT_STOP, (_, profileId) => {
    stopScript(profileId);
  });
}
