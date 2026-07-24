const { contextBridge, ipcRenderer } = require('electron');

// The STOP window's entire API surface: read the current step, press stop.
// Nothing else is exposed on purpose — this window exists to kill a driving
// session, and a renderer that can only say "stop" can't be talked into
// anything worse.
contextBridge.exposeInMainWorld('driveStop', {
  stop: () => ipcRenderer.send('screen:drive-stop'),
  onStep: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('drive:step', listener);
    return () => ipcRenderer.removeListener('drive:step', listener);
  }
});
