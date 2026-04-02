import { BrowserWindow, ipcMain, session } from 'electron';
import { IPC } from '../../shared/types';
import { ProfileManager } from '../profileManager';
import { BrowserViewManager } from '../browserViewManager';
import { startCdpProxy, stopCdpProxy } from '../cdpProxy';
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
    const ses = session.fromPartition(updated.partition);
    if (patch.proxyConfig !== undefined) {
      ses.setProxy({ proxyRules: patch.proxyConfig });
    }
    if (patch.userAgent !== undefined) {
      ses.setUserAgent(patch.userAgent);
    }
    views.reload(id);
    return updated;
  });

  ipcMain.handle(IPC.BROWSER_NAVIGATE, (_, profileId, url) => {
    console.log('[IPC] BROWSER_NAVIGATE:', profileId, url);
    views.navigate(profileId, url);
  });
  ipcMain.handle(IPC.BROWSER_BACK, (_, profileId) => views.back(profileId));
  ipcMain.handle(IPC.BROWSER_FORWARD, (_, profileId) => views.forward(profileId));
  ipcMain.handle(IPC.BROWSER_RELOAD, (_, profileId) => views.reload(profileId));

  ipcMain.handle(IPC.BROWSER_ACTIVATE, (_, profileId) => views.activate(profileId));

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
