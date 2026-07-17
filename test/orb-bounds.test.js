const test = require('node:test');
const assert = require('node:assert/strict');
const { ORB_MIN, ORB_MAX, ORB_STEP, ORB_DEFAULT, nextOrbSize, resizeAroundCenter, clampToWorkArea, resizeOutcome, defaultOrbBounds } = require('../core/orb-bounds');

test('orb size: steps up and down and clamps to its limits', () => {
  assert.equal(nextOrbSize(132, 1), 132 + ORB_STEP);
  assert.equal(nextOrbSize(132, -1), 132 - ORB_STEP);
  assert.equal(nextOrbSize(ORB_MAX, 1), ORB_MAX, 'cannot grow past max');
  assert.equal(nextOrbSize(ORB_MIN, -1), ORB_MIN, 'cannot shrink past min');
  assert.equal(nextOrbSize(undefined, 1), 132 + ORB_STEP, 'missing size falls back to the default');
});

test('orb resize: keeps the orb centred while it grows or shrinks', () => {
  const grown = resizeAroundCenter({ x: 100, y: 100, size: 132 }, 1);
  assert.equal(grown.size, 132 + ORB_STEP);
  assert.equal(grown.x, 100 - ORB_STEP / 2);
  assert.equal(grown.y, 100 - ORB_STEP / 2);
  const same = resizeAroundCenter({ x: 100, y: 100, size: ORB_MAX }, 1);
  assert.deepEqual(same, { x: 100, y: 100, size: ORB_MAX }, 'no movement when already at the limit');
});

test('orb easter egg: growing past max explodes, shrinking past min vanishes', () => {
  // Normal resizes stay resizes.
  assert.equal(resizeOutcome({ x: 10, y: 10, size: 132 }, 1).type, 'resize');
  assert.equal(resizeOutcome({ x: 10, y: 10, size: 132 }, -1).type, 'resize');
  // One more click past either limit triggers the pop.
  assert.deepEqual(resizeOutcome({ x: 10, y: 10, size: ORB_MAX }, 1), { type: 'explode' });
  assert.deepEqual(resizeOutcome({ x: 10, y: 10, size: ORB_MIN }, -1), { type: 'vanish' });
  // Shrinking a maxed orb (or growing a minimal one) is still a plain resize.
  assert.equal(resizeOutcome({ x: 10, y: 10, size: ORB_MAX }, -1).type, 'resize');
  assert.equal(resizeOutcome({ x: 10, y: 10, size: ORB_MIN }, 1).type, 'resize');
});

test('orb respawn: default bounds sit at the bottom-right of the work area', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  const bounds = defaultOrbBounds(area);
  assert.equal(bounds.size, ORB_DEFAULT);
  assert.equal(bounds.x, 1920 - ORB_DEFAULT - 28);
  assert.equal(bounds.y, 1040 - ORB_DEFAULT - 38);
  // Offset monitors respected too.
  const second = defaultOrbBounds({ x: 1920, y: 200, width: 1280, height: 700 });
  assert.equal(second.x, 1920 + 1280 - ORB_DEFAULT - 28);
  assert.equal(second.y, 200 + 700 - ORB_DEFAULT - 38);
});

test('orb position: clamps fully inside the work area', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(clampToWorkArea({ x: -50, y: -20, size: 132 }, area), { x: 0, y: 0, size: 132 });
  assert.deepEqual(clampToWorkArea({ x: 5000, y: 5000, size: 132 }, area), { x: 1920 - 132, y: 1040 - 132, size: 132 });
  // A second monitor's offset work area is respected.
  const second = { x: 1920, y: 0, width: 1280, height: 700 };
  assert.deepEqual(clampToWorkArea({ x: 0, y: 0, size: 132 }, second), { x: 1920, y: 0, size: 132 });
});
