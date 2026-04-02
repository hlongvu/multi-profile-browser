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
