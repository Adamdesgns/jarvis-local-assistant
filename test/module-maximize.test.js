const { test } = require('node:test');
const assert = require('node:assert');
const { toggleMaximize, clearRestore, applyDragStep, clampRect } = require('../src/layout-engine');

// Maximize is a layout operation, not a CSS trick: the module's rect becomes
// the whole workspace and the old rect rides along as `restore`, so the state
// survives a save/reload like every other layout fact.

test('maximize fills the workspace and remembers the old spot', () => {
  const layout = { browser: { x: 20, y: 10, w: 40, h: 50, z: 7 } };
  const nowMaximized = toggleMaximize(layout, 'browser');
  assert.strictEqual(nowMaximized, true);
  assert.deepStrictEqual(layout.browser, {
    x: 0, y: 0, w: 100, h: 100, z: 7,
    restore: { x: 20, y: 10, w: 40, h: 50 }
  });
});

test('toggling again puts the module back exactly where it was', () => {
  const layout = { browser: { x: 20, y: 10, w: 40, h: 50, z: 7 } };
  toggleMaximize(layout, 'browser');
  layout.browser.z = 12; // brought to front while maximized
  const nowMaximized = toggleMaximize(layout, 'browser');
  assert.strictEqual(nowMaximized, false);
  assert.deepStrictEqual(layout.browser, { x: 20, y: 10, w: 40, h: 50, z: 12 });
});

test('a manual drag or resize clears the restore memory', () => {
  const layout = { browser: { x: 20, y: 10, w: 40, h: 50, z: 7 } };
  toggleMaximize(layout, 'browser');
  clearRestore(layout, 'browser'); // what track() calls when the user takes over
  assert.strictEqual(layout.browser.restore, undefined);
  // The next toggle treats the hand-arranged rect as the new "old spot".
  const nowMaximized = toggleMaximize(layout, 'browser');
  assert.strictEqual(nowMaximized, true);
  assert.deepStrictEqual(layout.browser.restore, { x: 0, y: 0, w: 100, h: 100 });
});

test('unknown modules are a safe no-op', () => {
  const layout = {};
  assert.strictEqual(toggleMaximize(layout, 'ghost'), false);
  assert.deepStrictEqual(layout, {});
  clearRestore(layout, 'ghost'); // must not throw
  assert.strictEqual(applyDragStep(layout, 'ghost', { x: 1, y: 1, w: 30, h: 30 }), false);
});

// The verification pass caught this: a maximized module is pinned by
// clampRect, so a jittery header click produced identical rects on every
// pointermove — and still wiped `restore`, wedging the toggle at full-screen.
test('a drag that cannot move a maximized module keeps the restore memory', () => {
  const layout = { browser: { x: 20, y: 10, w: 40, h: 50, z: 7 } };
  toggleMaximize(layout, 'browser');
  // Header jitter: clampRect pins a 100x100 rect at 0,0 whatever the delta.
  const next = clampRect({ ...layout.browser, x: layout.browser.x + 0.4, y: layout.browser.y + 0.2 });
  assert.strictEqual(applyDragStep(layout, 'browser', next), false);
  assert.deepStrictEqual(layout.browser.restore, { x: 20, y: 10, w: 40, h: 50 });
  // The toggle still works after the sloppy click.
  assert.strictEqual(toggleMaximize(layout, 'browser'), false);
  assert.deepStrictEqual(layout.browser, { x: 20, y: 10, w: 40, h: 50, z: 7 });
});

test('a drag that actually moves the module still clears the memory', () => {
  const layout = { browser: { x: 20, y: 10, w: 40, h: 50, z: 7, restore: { x: 1, y: 2, w: 30, h: 40 } } };
  assert.strictEqual(applyDragStep(layout, 'browser', { x: 25, y: 10, w: 40, h: 50 }), true);
  assert.strictEqual(layout.browser.restore, undefined);
  assert.strictEqual(layout.browser.x, 25);
});
