const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { wireVisibilitySignal } = require('../core/window-visibility');

// The signal exists because Chromium's occlusion tracker is disabled app-wide
// (the July 20 speech fix), which pins document.hidden to false in every
// renderer forever. The main process is the only party that still knows when a
// window is hidden, so it must say so over IPC.

function fakeWindow({ visible = true } = {}) {
  const win = new EventEmitter();
  win.sent = [];
  win.destroyed = false;
  win.visible = visible;
  win.isDestroyed = () => win.destroyed;
  win.isVisible = () => win.visible;
  win.webContents = new EventEmitter();
  win.webContents.isDestroyed = () => win.destroyed;
  win.webContents.send = (channel, payload) => win.sent.push([channel, payload]);
  return win;
}

test('show and hide push window:visibility with the matching flag', () => {
  const win = fakeWindow();
  wireVisibilitySignal(win);
  win.emit('show');
  win.emit('hide');
  assert.deepEqual(win.sent, [
    ['window:visibility', true],
    ['window:visibility', false]
  ]);
});

test('minimize pauses and restore resumes — a minimized window is invisible even though hide() never ran', () => {
  const win = fakeWindow();
  wireVisibilitySignal(win);
  win.emit('minimize');
  win.emit('restore');
  assert.deepEqual(win.sent, [
    ['window:visibility', false],
    ['window:visibility', true]
  ]);
});

test('did-finish-load pushes the current visibility so a page that loads (or reloads) while hidden starts paused', () => {
  const win = fakeWindow({ visible: false });
  wireVisibilitySignal(win);
  win.webContents.emit('did-finish-load');
  assert.deepEqual(win.sent, [['window:visibility', false]]);

  const shown = fakeWindow({ visible: true });
  wireVisibilitySignal(shown);
  shown.webContents.emit('did-finish-load');
  assert.deepEqual(shown.sent, [['window:visibility', true]]);
});

test('events after the window is destroyed are swallowed, not thrown', () => {
  const win = fakeWindow();
  wireVisibilitySignal(win);
  win.destroyed = true;
  win.emit('show');
  win.emit('hide');
  win.webContents.emit('did-finish-load');
  assert.deepEqual(win.sent, []);
});
