import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/types';

const allowedChannels = Object.values(IPC);

contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (channel: string, ...args: unknown[]) => {
    if (!allowedChannels.includes(channel as typeof IPC[keyof typeof IPC])) {
      throw new Error(`Blocked IPC: ${channel}`);
    }
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel: string, cb: (...args: unknown[]) => void) => {
    const listener = (_: Electron.IpcRendererEvent, ...args: unknown[]) => cb(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
