const { contextBridge, ipcRenderer } = require('electron');

function on(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('jarvis', {
  bootstrap: () => ipcRenderer.invoke('bootstrap'),
  telemetry: () => ipcRenderer.invoke('telemetry'),
  submitCommand: (text, project) => ipcRenderer.invoke('command:submit', { text, project }),
  resolveApproval: (id, approved) => ipcRenderer.invoke('approval:resolve', { id, approved }),
  recentActivity: (limit) => ipcRenderer.invoke('activity:recent', limit),
  transcribe: (bytes, mimeType) => ipcRenderer.invoke('voice:transcribe', { bytes, mimeType }),
  voiceStatus: () => ipcRenderer.invoke('voice:status'),
  diagnoseVoice: () => ipcRenderer.invoke('voice:diagnose'),
  setupLocalVoice: () => ipcRenderer.invoke('voice:setup'),
  restartLocalVoice: () => ipcRenderer.invoke('voice:restart'),
  connectOllama: () => ipcRenderer.invoke('ollama:connect'),
  ollamaStatus: () => ipcRenderer.invoke('ollama:status'),
  saveOpenAIKey: (key) => ipcRenderer.invoke('openai:save-key', key),
  removeOpenAIKey: () => ipcRenderer.invoke('openai:remove-key'),
  testOpenAI: () => ipcRenderer.invoke('openai:test'),
  tasks: {
    list: () => ipcRenderer.invoke('tasks:list'),
    add: (input) => ipcRenderer.invoke('tasks:add', input),
    update: (id, patch) => ipcRenderer.invoke('tasks:update', { id, patch }),
    remove: (id) => ipcRenderer.invoke('tasks:remove', id)
  },
  memories: {
    list: () => ipcRenderer.invoke('memory:list'),
    add: (text, project) => ipcRenderer.invoke('memory:add', { text, project }),
    update: (id, text) => ipcRenderer.invoke('memory:update', { id, text }),
    remove: (id) => ipcRenderer.invoke('memory:remove', id)
  },
  files: {
    roots: () => ipcRenderer.invoke('files:roots'),
    home: () => ipcRenderer.invoke('files:home'),
    list: (directory) => ipcRenderer.invoke('files:list', directory),
    open: (target) => ipcRenderer.invoke('path:open', target)
  },
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  chooseFolder: (title) => ipcRenderer.invoke('dialog:folder', title),
  openPath: (target) => ipcRenderer.invoke('path:open', target),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  writeClipboard: (text) => ipcRenderer.invoke('clipboard:write', text),
  openOllamaDownload: () => ipcRenderer.invoke('external:ollama'),
  openOpenAIBilling: () => ipcRenderer.invoke('external:openai-billing'),
  openOpenAIKeys: () => ipcRenderer.invoke('external:openai-keys'),
  showWidget: () => ipcRenderer.send('widget:show'),
  restoreMain: () => ipcRenderer.send('widget:restore'),
  windowControl: (action) => ipcRenderer.send('window:control', action),
  onWakeDetected: (callback) => on('wake:detected', callback),
  onWakeStatus: (callback) => on('voice:status', callback),
  onVoiceLog: (callback) => on('voice:log', callback),
  cancelAI: () => ipcRenderer.send('ai:cancel'),
  onAIStream: (callback) => on('ai:stream', callback),
  onAIStreamReset: (callback) => on('ai:stream-reset', callback),
  onVoiceSetupProgress: (callback) => on('voice:setup-progress', callback),
  onVoiceSetupDone: (callback) => on('voice:setup-done', callback),
  onOllamaStatus: (callback) => on('ollama:status', callback),
  onFileStart: (callback) => on('files:start', callback),
  onFileProgress: (callback) => on('files:progress', callback),
  onFileMatch: (callback) => on('files:match', callback),
  onFileComplete: (callback) => on('files:complete', callback),
  onTasksChanged: (callback) => on('tasks:changed', callback),
  setUIState: (state, message) => ipcRenderer.send('ui:state', { state, message }),
  onUIState: (callback) => on('ui:state', callback)
});
