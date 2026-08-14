// Chromium's occlusion tracker is disabled app-wide (main.js — the July 20
// speech fix, which keeps SpeechSynthesis alive under a covering window).
// The cost of that fix: document.hidden is pinned to false in every renderer,
// so the orb skins' pause-when-hidden logic can never fire, and a hidden
// window keeps rendering at full framerate forever.
//
// This is the replacement signal. The main process is the only party that
// still knows when a window is hidden, so it pushes the fact to the page over
// IPC and src/visibility-shim.js overlays document.hidden with it.
function wireVisibilitySignal(win) {
  const push = (visible) => {
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
    win.webContents.send('window:visibility', visible);
  };
  win.on('show', () => push(true));
  win.on('hide', () => push(false));
  // A minimized window never gets hide(), but it is just as invisible.
  win.on('minimize', () => push(false));
  win.on('restore', () => push(true));
  // A page that loads (or reloads) while hidden must start paused.
  win.webContents.on('did-finish-load', () => push(win.isVisible()));
}

module.exports = { wireVisibilitySignal };
