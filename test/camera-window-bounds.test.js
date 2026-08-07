const test = require('node:test');
const assert = require('node:assert/strict');
const {
  clampRectToWorkArea, defaultCameraBounds, restoreBounds, isOffscreen,
  MIN_WIDTH, MIN_HEIGHT, DEFAULT_WIDTH, DEFAULT_HEIGHT, CASCADE_STEP
} = require('../core/camera-window-bounds');

// Placement for pop-out camera windows (spec: 2026-08-04-camera-windows-design).
// Adam's requirement was "this will need to flow with a multi monitor setup
// well", and the failure that actually strands a window is restoring it onto a
// monitor that is no longer plugged in — coordinates no screen covers, so the
// window is invisible with no way to drag it back. These tests exist mostly to
// pin that behaviour.

const PRIMARY = { workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
// A second monitor to the right, as Windows reports it.
const RIGHT = { workArea: { x: 1920, y: 0, width: 2560, height: 1400 } };
// And one to the left, which gives negative coordinates.
const LEFT = { workArea: { x: -1920, y: 0, width: 1920, height: 1040 } };

test('camera bounds: a window already on screen is left where it is', () => {
  const rect = { x: 100, y: 120, w: 800, h: 500 };
  assert.deepEqual(clampRectToWorkArea(rect, PRIMARY.workArea), rect);
});

test('camera bounds: pulls a window back inside every edge', () => {
  const area = PRIMARY.workArea;
  assert.deepEqual(clampRectToWorkArea({ x: -500, y: 10, w: 640, h: 420 }, area).x, 0);
  assert.deepEqual(clampRectToWorkArea({ x: 10, y: -500, w: 640, h: 420 }, area).y, 0);
  const offRight = clampRectToWorkArea({ x: 5000, y: 10, w: 640, h: 420 }, area);
  assert.equal(offRight.x, 1920 - 640, 'flush to the right edge, fully visible');
  const offBottom = clampRectToWorkArea({ x: 10, y: 5000, w: 640, h: 420 }, area);
  assert.equal(offBottom.y, 1040 - 420);
});

test('camera bounds: a window bigger than the screen is shrunk to fit', () => {
  const fitted = clampRectToWorkArea({ x: 0, y: 0, w: 9000, h: 9000 }, PRIMARY.workArea);
  assert.equal(fitted.w, 1920);
  assert.equal(fitted.h, 1040);
  assert.equal(fitted.x, 0);
  assert.equal(fitted.y, 0);
});

test('camera bounds: never shrinks below a usable size', () => {
  const tiny = clampRectToWorkArea({ x: 10, y: 10, w: 4, h: 4 }, PRIMARY.workArea);
  assert.equal(tiny.w, MIN_WIDTH);
  assert.equal(tiny.h, MIN_HEIGHT);
});

test('camera bounds: junk falls back to defaults instead of NaN', () => {
  const fallback = clampRectToWorkArea({ x: 'nope', y: undefined, w: null, h: NaN }, PRIMARY.workArea);
  assert.equal(fallback.w, DEFAULT_WIDTH);
  assert.equal(fallback.h, DEFAULT_HEIGHT);
  assert.equal(fallback.x, 0);
  assert.equal(fallback.y, 0);
  for (const value of Object.values(fallback)) assert.ok(Number.isFinite(value));
});

test('camera bounds: coordinates come back as whole pixels', () => {
  const rect = clampRectToWorkArea({ x: 10.6, y: 20.4, w: 640.7, h: 420.2 }, PRIMARY.workArea);
  for (const value of Object.values(rect)) assert.equal(value, Math.round(value));
});

// Several pop-outs opening at once must not look like one window.
test('camera bounds: each new pop-out cascades down-right, then wraps', () => {
  const first = defaultCameraBounds(PRIMARY.workArea, 0);
  const second = defaultCameraBounds(PRIMARY.workArea, 1);
  assert.equal(second.x - first.x, CASCADE_STEP);
  assert.equal(second.y - first.y, CASCADE_STEP);
  const seventh = defaultCameraBounds(PRIMARY.workArea, 6);
  assert.deepEqual(seventh, first, 'wraps rather than marching off the screen');
});

test('camera bounds: a default window opens fully on screen, even on a small display', () => {
  const small = { x: 0, y: 0, width: 800, height: 600 };
  const rect = defaultCameraBounds(small, 3);
  assert.ok(rect.x >= 0 && rect.y >= 0);
  assert.ok(rect.x + rect.w <= 800);
  assert.ok(rect.y + rect.h <= 600);
});

test('camera bounds: restores onto the monitor the saved spot belongs to', () => {
  const onRight = { x: 2200, y: 300, w: 800, h: 500 };
  assert.deepEqual(restoreBounds(onRight, [PRIMARY, RIGHT]), onRight, 'second monitor honoured');
  const onLeft = { x: -1500, y: 200, w: 700, h: 450 };
  assert.deepEqual(restoreBounds(onLeft, [PRIMARY, LEFT]), onLeft, 'negative coordinates are fine');
});

// The whole reason this module exists.
test('camera bounds: a window whose monitor was unplugged lands on the nearest one', () => {
  const onRight = { x: 2200, y: 300, w: 800, h: 500 };
  const restored = restoreBounds(onRight, [PRIMARY]);
  assert.ok(restored.x + restored.w <= 1920, 'pulled onto the surviving screen');
  assert.ok(restored.x >= 0 && restored.y >= 0);
  assert.equal(restored.w, 800, 'size is kept — only the position had to move');
});

test('camera bounds: picks the nearest survivor, not just the first', () => {
  const farLeft = { x: -1800, y: 100, w: 600, h: 400 };
  const restored = restoreBounds(farLeft, [RIGHT, PRIMARY]);
  assert.ok(restored.x < 1920, 'chose the primary, which is closer than the right-hand monitor');
});

test('camera bounds: no saved position means the default cascade slot', () => {
  assert.deepEqual(restoreBounds(null, [PRIMARY], 2), defaultCameraBounds(PRIMARY.workArea, 2));
  assert.deepEqual(restoreBounds({ w: 800 }, [PRIMARY], 0), defaultCameraBounds(PRIMARY.workArea, 0));
});

test('camera bounds: no displays at all still returns something usable', () => {
  const rect = restoreBounds({ x: 10, y: 10, w: 800, h: 500 }, []);
  for (const value of Object.values(rect)) assert.ok(Number.isFinite(value));
  assert.deepEqual(restoreBounds(null, undefined), { x: 0, y: 0, w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT });
});

test('camera bounds: spots a window stranded off every screen', () => {
  assert.equal(isOffscreen({ x: 100, y: 100, w: 640, h: 420 }, [PRIMARY]), false);
  assert.equal(isOffscreen({ x: 2200, y: 300, w: 640, h: 420 }, [PRIMARY]), true, 'monitor gone');
  assert.equal(isOffscreen({ x: 2200, y: 300, w: 640, h: 420 }, [PRIMARY, RIGHT]), false);
  assert.equal(isOffscreen({ x: 100, y: 100, w: 640, h: 420 }, []), true, 'no screens at all');
});
