const test = require('node:test');
const assert = require('node:assert/strict');
const { createVisibilityShim } = require('../src/visibility-shim');

// The shim overlays document.hidden / document.visibilityState with the
// window:visibility flag pushed from the main process, and fires a real
// visibilitychange event when the answer changes. Every orb skin already
// pauses on exactly that signal — this makes the signal true again.

class FakeDocument {
  constructor() {
    this.listeners = new Map();
    this.nativeHidden = false;
  }
  get hidden() { return this.nativeHidden; }
  get visibilityState() { return this.nativeHidden ? 'hidden' : 'visible'; }
  addEventListener(type, cb) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(cb);
  }
  dispatchEvent(event) {
    (this.listeners.get(event.type) || []).forEach((cb) => cb(event));
    return true;
  }
}

// node:test runs without a DOM; the shim only needs type + dispatch.
class FakeEvent {
  constructor(type) { this.type = type; }
}

test('window hidden makes document.hidden true and fires one visibilitychange', () => {
  const doc = new FakeDocument();
  let fired = 0;
  doc.addEventListener('visibilitychange', () => { fired += 1; });
  const shim = createVisibilityShim(doc, { EventCtor: FakeEvent });

  assert.equal(doc.hidden, false);
  shim.setWindowVisible(false);
  assert.equal(doc.hidden, true);
  assert.equal(doc.visibilityState, 'hidden');
  assert.equal(fired, 1);

  shim.setWindowVisible(true);
  assert.equal(doc.hidden, false);
  assert.equal(doc.visibilityState, 'visible');
  assert.equal(fired, 2);
});

test('repeating the same visibility does not fire duplicate events', () => {
  const doc = new FakeDocument();
  let fired = 0;
  doc.addEventListener('visibilitychange', () => { fired += 1; });
  const shim = createVisibilityShim(doc, { EventCtor: FakeEvent });

  shim.setWindowVisible(false);
  shim.setWindowVisible(false);
  assert.equal(fired, 1);
  shim.setWindowVisible(true);
  shim.setWindowVisible(true);
  assert.equal(fired, 2);
});

test('a natively hidden document stays hidden even while the window flag says visible', () => {
  const doc = new FakeDocument();
  doc.nativeHidden = true;
  const shim = createVisibilityShim(doc, { EventCtor: FakeEvent });
  shim.setWindowVisible(true);
  assert.equal(doc.hidden, true);
  assert.equal(doc.visibilityState, 'hidden');
});

test('the skins’ real pause pattern works end to end: visibilitychange listener reads document.hidden', () => {
  const doc = new FakeDocument();
  const shim = createVisibilityShim(doc, { EventCtor: FakeEvent });

  // This is the exact shape used by plasma.js, aurora.js, classic.js, etc.
  let running = true;
  doc.addEventListener('visibilitychange', () => {
    if (doc.hidden) running = false; else running = true;
  });

  shim.setWindowVisible(false);
  assert.equal(running, false);
  shim.setWindowVisible(true);
  assert.equal(running, true);
});
