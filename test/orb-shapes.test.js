// test/orb-shapes.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { SHAPES, morphRadius, SHAPE_TINTS } = require('../src/orbs/shapes');

const TAU = Math.PI * 2;

test('every shape is finite, positive, and bounded over the whole circle', () => {
  for (const name of Object.keys(SHAPES)) {
    for (let i = 0; i < 720; i++) {
      const r = SHAPES[name]((i / 720) * TAU, 123);
      assert.ok(Number.isFinite(r) && r > 0.05 && r < 1.6, `${name} at step ${i}: ${r}`);
    }
  }
});

test('shapes are periodic: θ and θ+2π agree', () => {
  for (const name of Object.keys(SHAPES)) {
    for (const theta of [0.3, 1.7, 4.4]) {
      assert.ok(Math.abs(SHAPES[name](theta, 5) - SHAPES[name](theta + TAU, 5)) < 1e-9, name);
    }
  }
});

test('rock, paper, scissors hold still; the orb breathes', () => {
  for (const name of ['rock', 'paper', 'scissors']) {
    assert.equal(SHAPES[name](1.1, 0), SHAPES[name](1.1, 999), `${name} must ignore time`);
  }
  assert.notEqual(SHAPES.orb(1.1, 0), SHAPES.orb(1.1, 999));
});

test('scissors reads as two blades: two clear maxima near 10 and 2 o\'clock', () => {
  let peaks = 0;
  const samples = 720;
  const r = (i) => SHAPES.scissors((i / samples) * TAU, 0);
  for (let i = 0; i < samples; i++) {
    const prev = r((i + samples - 1) % samples), here = r(i), next = r((i + 1) % samples);
    if (here > prev && here > next && here > 0.9) peaks += 1;
  }
  assert.equal(peaks, 2, `expected exactly 2 blade peaks, found ${peaks}`);
});

test('morph endpoints are exact and the middle is between', () => {
  const theta = 0.8, t = 42;
  assert.equal(morphRadius('orb', 'rock', 0, theta, t), SHAPES.orb(theta, t));
  assert.equal(morphRadius('orb', 'rock', 1, theta, t), SHAPES.rock(theta, t));
  const mid = morphRadius('orb', 'rock', 0.5, theta, t);
  const [lo, hi] = [SHAPES.orb(theta, t), SHAPES.rock(theta, t)].sort((a, b) => a - b);
  assert.ok(mid >= lo - 1e-9 && mid <= hi + 1e-9);
});

test('tints: the three throws are tinted, the orb keeps its soul', () => {
  assert.match(SHAPE_TINTS.rock, /^#[0-9a-f]{6}$/i);
  assert.equal(SHAPE_TINTS.orb, null);
});
