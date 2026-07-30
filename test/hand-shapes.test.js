'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { classifyHand, createStableRead } = require('../core/hand-shapes');

// Geometric fixtures, no camera anywhere. The hand points "up" from a wrist
// at (0.5, 0.9): an extended tip lands far above its pip (wrist-distance
// ratio ~1.8), a curled tip lands just past its pip (ratio ~0.83, under the
// 1.15 gate). Thumb landmarks are filled but neutral — the classifier must
// ignore them.
function makeHand({ index = false, middle = false, ring = false, pinky = false } = {}) {
  const wrist = { x: 0.5, y: 0.9 };
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.8 }));
  landmarks[0] = wrist;
  // Thumb chain (1-4): tucked sideways, never counted.
  landmarks[1] = { x: 0.42, y: 0.85 };
  landmarks[2] = { x: 0.40, y: 0.82 };
  landmarks[3] = { x: 0.39, y: 0.80 };
  landmarks[4] = { x: 0.38, y: 0.79 };
  const fingers = [
    { open: index, x: 0.44, mcp: 5, pip: 6, dip: 7, tip: 8 },
    { open: middle, x: 0.48, mcp: 9, pip: 10, dip: 11, tip: 12 },
    { open: ring, x: 0.52, mcp: 13, pip: 14, dip: 15, tip: 16 },
    { open: pinky, x: 0.56, mcp: 17, pip: 18, dip: 19, tip: 20 }
  ];
  for (const f of fingers) {
    landmarks[f.mcp] = { x: f.x, y: 0.70 };
    landmarks[f.pip] = { x: f.x, y: 0.60 };
    landmarks[f.dip] = { x: f.x, y: f.open ? 0.47 : 0.63 };
    landmarks[f.tip] = { x: f.x, y: f.open ? 0.35 : 0.65 };
  }
  return landmarks;
}

// Rotate every point about the wrist — a sideways or upside-down throw must
// classify identically, which is the whole reason the classifier measures
// wrist distance instead of direction.
function rotate(landmarks, radians) {
  const wrist = landmarks[0];
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return landmarks.map((p) => ({
    x: wrist.x + (p.x - wrist.x) * cos - (p.y - wrist.y) * sin,
    y: wrist.y + (p.x - wrist.x) * sin + (p.y - wrist.y) * cos
  }));
}

test('a fist is rock, an open hand is paper, index+middle is scissors', () => {
  assert.equal(classifyHand(makeHand()), 'rock');
  assert.equal(classifyHand(makeHand({ index: true, middle: true, ring: true, pinky: true })), 'paper');
  assert.equal(classifyHand(makeHand({ index: true, middle: true })), 'scissors');
});

test('a lazy pinky still reads as paper — kids rarely open all four cleanly', () => {
  assert.equal(classifyHand(makeHand({ index: true, middle: true, ring: true })), 'paper');
});

test('ambiguous hands are null, never a guess', () => {
  assert.equal(classifyHand(makeHand({ index: true })), null, 'pointing is not a throw');
  assert.equal(classifyHand(makeHand({ index: true, ring: true })), null, 'index+ring is no shape');
  assert.equal(classifyHand(makeHand({ middle: true, pinky: true })), null, 'middle+pinky is no shape');
});

test('rotation changes nothing: sideways and upside-down throws classify the same', () => {
  const cases = [
    [makeHand(), 'rock'],
    [makeHand({ index: true, middle: true, ring: true, pinky: true }), 'paper'],
    [makeHand({ index: true, middle: true }), 'scissors']
  ];
  for (const [hand, expected] of cases) {
    for (const angle of [Math.PI / 2, Math.PI, -Math.PI / 3]) {
      assert.equal(classifyHand(rotate(hand, angle)), expected, `${expected} at ${angle}`);
    }
  }
});

test('garbage in, null out — short, empty, or malformed landmark arrays', () => {
  assert.equal(classifyHand(null), null);
  assert.equal(classifyHand([]), null);
  assert.equal(classifyHand(makeHand().slice(0, 12)), null);
  const broken = makeHand();
  broken[8] = { x: 'nope', y: 0.2 };
  assert.equal(classifyHand(broken), null);
});

test('stable read fires only after N consecutive identical frames', () => {
  const gate = createStableRead({ need: 3 });
  assert.equal(gate.push('rock'), null);
  assert.equal(gate.push('rock'), null);
  assert.equal(gate.push('rock'), 'rock');
});

test('a different shape resets the count — no banking frames across a change', () => {
  const gate = createStableRead({ need: 3 });
  gate.push('rock');
  gate.push('rock');
  assert.equal(gate.push('paper'), null, 'switch restarts');
  assert.equal(gate.push('paper'), null);
  assert.equal(gate.push('paper'), 'paper');
});

test('null frames (blur, occlusion) neither count nor reset', () => {
  const gate = createStableRead({ need: 3 });
  gate.push('scissors');
  assert.equal(gate.push(null), null);
  gate.push('scissors');
  assert.equal(gate.push(null), null);
  assert.equal(gate.push('scissors'), 'scissors', 'flicker did not reset the run');
});

test('reset() starts over', () => {
  const gate = createStableRead({ need: 2 });
  gate.push('rock');
  gate.reset();
  assert.equal(gate.push('rock'), null);
  assert.equal(gate.push('rock'), 'rock');
});
