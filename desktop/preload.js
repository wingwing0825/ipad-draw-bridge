const { contextBridge, ipcRenderer } = require("electron");

function onStatus(handler) {
  const listener = (_event, payload) => {
    handler(payload);
  };
  ipcRenderer.on("bridge:status", listener);
  return () => ipcRenderer.removeListener("bridge:status", listener);
}

contextBridge.exposeInMainWorld("bridgeApp", {
  getStatus: () => ipcRenderer.invoke("bridge:get-status"),
  start: () => ipcRenderer.invoke("bridge:start"),
  stop: () => ipcRenderer.invoke("bridge:stop"),
  regenerateToken: () => ipcRenderer.invoke("bridge:regenerate-token"),
  openOverlay: (options) => ipcRenderer.invoke("bridge:open-overlay", options),
  clearRegion: () => ipcRenderer.invoke("bridge:clear-region"),
  releasePointer: () => ipcRenderer.invoke("bridge:release-pointer"),
  setPreviewEnabled: (enabled) => ipcRenderer.invoke("bridge:set-preview-enabled", enabled),
  copyText: (text) => ipcRenderer.invoke("bridge:copy-text", text),
  openExternal: (url) => ipcRenderer.invoke("bridge:open-external", url),
  onStatus
});

contextBridge.exposeInMainWorld("overlayApp", {
  getModel: () => ipcRenderer.invoke("overlay:get-model"),
  applyRegion: (region) => ipcRenderer.invoke("overlay:apply-region", region),
  close: () => ipcRenderer.invoke("overlay:close")
});
