export interface Profile {
  id: string;
  name: string;
  color: string;
  partition: string;
  userAgent?: string;
  proxyConfig?: string;
  homeUrl: string;
  cdpPort?: number;
  createdAt: number;
}

export interface Script {
  id: string;
  name: string;
  code: string;
  profileId?: string;
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

export const IPC = {
  PROFILE_CREATE: 'profile:create',
  PROFILE_DELETE: 'profile:delete',
  PROFILE_LIST: 'profile:list',
  PROFILE_UPDATE: 'profile:update',
  BROWSER_NAVIGATE: 'browser:navigate',
  BROWSER_BACK: 'browser:back',
  BROWSER_FORWARD: 'browser:forward',
  BROWSER_RELOAD: 'browser:reload',
  CDP_START: 'cdp:startProxy',
  CDP_STOP: 'cdp:stopProxy',
  SCRIPT_RUN: 'script:run',
  SCRIPT_STOP: 'script:stop',
  SCRIPT_SAVE: 'script:save',
  SCRIPT_LIST: 'script:list',
  SCRIPT_DELETE: 'script:delete',
  BROWSER_TITLE: 'browser:titleChanged',
  BROWSER_FAVICON: 'browser:faviconChanged',
  BROWSER_LOADING: 'browser:loadingChanged',
  BROWSER_URL: 'browser:urlChanged',
  SCRIPT_LOG: 'script:log',
  SCRIPT_DONE: 'script:done',
} as const;

export type IPCChannels = typeof IPC[keyof typeof IPC];
