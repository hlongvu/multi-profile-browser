"use strict";
const electron = require("electron");
const IPC = {
  PROFILE_CREATE: "profile:create",
  PROFILE_DELETE: "profile:delete",
  PROFILE_LIST: "profile:list",
  PROFILE_UPDATE: "profile:update",
  BROWSER_NAVIGATE: "browser:navigate",
  BROWSER_BACK: "browser:back",
  BROWSER_FORWARD: "browser:forward",
  BROWSER_RELOAD: "browser:reload",
  CDP_START: "cdp:startProxy",
  CDP_STOP: "cdp:stopProxy",
  SCRIPT_RUN: "script:run",
  SCRIPT_STOP: "script:stop",
  SCRIPT_SAVE: "script:save",
  SCRIPT_LIST: "script:list",
  SCRIPT_DELETE: "script:delete",
  BROWSER_TITLE: "browser:titleChanged",
  BROWSER_FAVICON: "browser:faviconChanged",
  BROWSER_LOADING: "browser:loadingChanged",
  BROWSER_URL: "browser:urlChanged",
  SCRIPT_LOG: "script:log",
  SCRIPT_DONE: "script:done"
};
const allowedChannels = Object.values(IPC);
electron.contextBridge.exposeInMainWorld("electronAPI", {
  invoke: (channel, ...args) => {
    if (!allowedChannels.includes(channel)) {
      throw new Error(`Blocked IPC: ${channel}`);
    }
    return electron.ipcRenderer.invoke(channel, ...args);
  },
  on: (channel, cb) => {
    const listener = (_, ...args) => cb(...args);
    electron.ipcRenderer.on(channel, listener);
    return () => electron.ipcRenderer.removeListener(channel, listener);
  }
});
