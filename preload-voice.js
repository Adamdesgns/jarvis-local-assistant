// Bridge for the hidden voice worker window.
//
// The worker deliberately runs without node integration — transformers.js picks
// the onnxruntime-node backend whenever it sees a node process, and that
// backend has no WebGPU, which is the entire reason the worker exists. So it
// gets this narrow channel instead of require().

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('voiceWorker', {
  ready: (info) => ipcRenderer.send('voice-worker:ready', info),
  model: (info) => ipcRenderer.send('voice-worker:model', info),
  result: (payload) => ipcRenderer.send('voice-worker:result', payload),
  onSynthesize: (handler) => ipcRenderer.on('voice-worker:synthesize', (_event, payload) => handler(payload)),
  onVoices: (handler) => ipcRenderer.on('voice-worker:voices', (_event, payload) => handler(payload))
});
