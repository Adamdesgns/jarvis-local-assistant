// The bench window runs without node integration (WebGPU depends on it staying
// off), so file writes go through the main process.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bench', {
  save: (name, buffer) => ipcRenderer.invoke('bench:save', name, buffer),
  readme: (text) => ipcRenderer.invoke('bench:readme', text)
});
