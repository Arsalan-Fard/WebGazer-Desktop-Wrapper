const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopAPI", {
  setClickThrough(enabled) {
    return ipcRenderer.invoke("desktop:setClickThrough", enabled);
  },
  getDisplayInfo() {
    return ipcRenderer.invoke("desktop:getDisplayInfo");
  },
  startSystemClickCapture(payload) {
    return ipcRenderer.invoke("desktop:startSystemClickCapture", payload);
  },
  stopSystemClickCapture() {
    return ipcRenderer.invoke("desktop:stopSystemClickCapture");
  },
  saveRecording(payload) {
    return ipcRenderer.invoke("desktop:saveRecording", payload);
  },
  saveGazeData(payload) {
    return ipcRenderer.invoke("desktop:saveGazeData", payload);
  },
  onShortcut(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("desktop:shortcut", listener);
    return () => ipcRenderer.removeListener("desktop:shortcut", listener);
  },
  onClickThroughChanged(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("desktop:clickThrough", listener);
    return () => ipcRenderer.removeListener("desktop:clickThrough", listener);
  }
});

contextBridge.exposeInMainWorld("maskAPI", {
  getBounds() {
    return ipcRenderer.invoke("mask:getBounds");
  },
  setBounds(bounds) {
    return ipcRenderer.invoke("mask:setBounds", bounds);
  },
  setVisible(visible) {
    return ipcRenderer.invoke("mask:setVisible", visible);
  },
  setInteractive(enabled) {
    return ipcRenderer.invoke("mask:setInteractive", enabled);
  },
  onBounds(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("mask:bounds", listener);
    return () => ipcRenderer.removeListener("mask:bounds", listener);
  },
  onInteractive(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("mask:interactive", listener);
    return () => ipcRenderer.removeListener("mask:interactive", listener);
  }
});
