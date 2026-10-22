const { contextBridge, ipcRenderer } = require("electron");

// The renderer receives narrow operations, never Electron or filesystem access.
const subscribe = (channel, callback) => {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld("sector", {
  initializeOverlays: () => ipcRenderer.invoke("sector:overlays-initialize"),
  saveOverlays: (value) => ipcRenderer.invoke("sector:overlays-save", value),
  editOverlays: (value) => ipcRenderer.invoke("sector:overlays-edit", value),
  onOverlays: (callback) => subscribe("sector:overlays", callback),
  initialize: () => ipcRenderer.invoke("sector:initialize"),
  exportDiagnostics: () => ipcRenderer.invoke("sector:diagnostics-export"),
  launchGame: () => ipcRenderer.invoke("sector:launch-game"),
  enableReset: () => ipcRenderer.invoke("sector:reset-enable"),
  disableReset: () => ipcRenderer.invoke("sector:reset-disable"),
  restartOnline: () => ipcRenderer.invoke("sector:restart-online"),
  reportBug: () => ipcRenderer.invoke("sector:report-bug"),
  installation: () => ipcRenderer.invoke("sector:installation"),
  updateInstallation: (folder) =>
    ipcRenderer.invoke("sector:installation-update", folder),
  reset: (action) => ipcRenderer.invoke("sector:reset", action),
  onGame: (callback) => subscribe("sector:game", callback),
  detectInstallations: () => ipcRenderer.invoke("sector:setup-detect"),
  browseInstallation: () => ipcRenderer.invoke("sector:setup-browse"),
  confirmInstallation: (folder) =>
    ipcRenderer.invoke("sector:setup-confirm", folder),
  completeOnboarding: () => ipcRenderer.invoke("sector:setup-complete"),
  captureWheel: () => ipcRenderer.invoke("sector:wheel-capture"),
  cancelWheelCapture: () => ipcRenderer.invoke("sector:wheel-cancel"),
  saveSettings: (settings) => ipcRenderer.invoke("sector:settings", settings),
  previewSound: (name) => ipcRenderer.invoke("sector:sound", name),
  minimize: () => ipcRenderer.invoke("sector:minimize"),
  maximize: () => ipcRenderer.invoke("sector:maximize"),
  background: () => ipcRenderer.invoke("sector:background"),
  quit: () => ipcRenderer.invoke("sector:quit"),
  onStatus: (callback) => subscribe("sector:status", callback),
  onCloseRequested: (callback) => subscribe("sector:close-requested", callback),
});
