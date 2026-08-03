const test = require('node:test');
const assert = require('node:assert/strict');

const U = require('../src/orbs/orb-utils');

// Plasma's wrap-safe surge frequencies: multiples of TAU/120 so the envelope
// is seamless across its 120-second phase wrap.
const W0 = (Math.PI * 2) / 120;

test('lcg matches the shared seed-4107 recurrence exactly', () => {
  const rand = U.lcg(4107);
  let seed = 4107;
  for (let i = 0; i < 32; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    assert.equal(rand(), seed / 4294967296);
  }
});

test('mulberry32 is deterministic and in [0,1)', () => {
  const a = U.mulberry32(1337);
  const b = U.mulberry32(1337);
  for (let i = 0; i < 32; i++) {
    const v = a();
    assert.equal(v, b());
    assert.ok(v >= 0 && v < 1);
  }
  // Locks the exact sequence aurora depends on for its stable look.
  assert.equal(U.mulberry32(1337)(), 0.1844118325971067);
});

test('lerp and mix3', () => {
  assert.equal(U.lerp(2, 10, 0.25), 4);
  assert.deepEqual(U.mix3([0, 100, 200], [100, 200, 300], 0.5), [50, 150, 250]);
});

test('css formats 0-255 ints, rgba01 formats 0-1 floats', () => {
  assert.equal(U.css([255, 128.7, 0], 0.5), 'rgba(255,128,0,0.5000)');
  assert.equal(U.rgba01([1, 0.5, 0], 0.25), 'rgba(255,127,0,0.250)');
});

test('hsl2rgb anchors and hue wrap', () => {
  assert.deepEqual(U.hsl2rgb(0, 1, 0.5), [1, 0, 0]);
  assert.deepEqual(U.hsl2rgb(120, 1, 0.5), [0, 1, 0]);
  assert.deepEqual(U.hsl2rgb(240, 1, 0.5), [0, 0, 1]);
  assert.deepEqual(U.hsl2rgb(360, 1, 0.5), U.hsl2rgb(0, 1, 0.5));
  assert.deepEqual(U.hsl2rgb(-120, 1, 0.5), U.hsl2rgb(240, 1, 0.5));
  assert.deepEqual(U.hsl2rgb(0, 0, 0.5), [0.5, 0.5, 0.5]);
});

test('smoothK is the shared easing kernel', () => {
  assert.equal(U.smoothK(3, 0), 0);
  assert.ok(Math.abs(U.smoothK(3, 1 / 60) - (1 - Math.exp(-0.05))) < 1e-12);
  assert.ok(U.smoothK(3, 10) > 0.999);
});

test('surgeEnvelope stays in [0,1], surges rarely but dramatically', () => {
  const samples = [];
  for (let t = 0; t < 240; t += 0.05) samples.push(U.surgeEnvelope(t));
  for (const v of samples) assert.ok(v >= 0 && v <= 1);
  const sorted = samples.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  assert.ok(median < 0.1, `median ${median} should be near zero (rare surges)`);
  assert.ok(Math.max(...samples) > 0.5, 'peaks should be dramatic');
});

test('surgeEnvelope strength scales output monotonically', () => {
  const t = 3.9; // near a wave-1 peak
  const lo = U.surgeEnvelope(t, { strength: 0.5 });
  const mid = U.surgeEnvelope(t, { strength: 1 });
  const hi = U.surgeEnvelope(t, { strength: 1.5 });
  assert.ok(lo < mid && mid <= hi);
  assert.ok(hi <= 1);
});

test('surgeEnvelope with wrap-safe frequencies is continuous across t=120', () => {
  const opts = { f1: 8 * W0, f2: 13 * W0 };
  const before = U.surgeEnvelope(119.999, opts);
  const wrapped = U.surgeEnvelope(-0.001, opts); // phase wraps 120 -> 0
  assert.ok(Math.abs(before - wrapped) < 1e-3);
});

test('scanSweep geometry', () => {
  for (let t = 0; t < 40; t += 0.1) {
    const s = U.scanSweep(t, 0.4);
    assert.ok(s.y >= -1 && s.y <= 1);
    assert.ok(Math.abs(s.scale - Math.sqrt(Math.max(0, 1 - s.y * s.y))) < 1e-12);
    assert.ok(s.alpha >= 0 && s.alpha <= 1);
  }
  const p0 = U.scanSweep(1, 0.4);
  const p1 = U.scanSweep(1, 0.4, Math.PI);
  assert.ok(Math.abs(p0.y - p1.y) > 0.1, 'phase offsets the sweep');
});

test('flicker stays within ±2%', () => {
  for (let t = 0; t < 20; t += 0.01) {
    const f = U.flicker(t);
    assert.ok(f >= 0.98 && f <= 1.02);
  }
});

test('caScale disables on tiny canvases, clamps, and shrinks with size', () => {
  assert.equal(U.caScale(64), 0);
  assert.equal(U.caScale(199), 0);
  assert.equal(U.caScale(NaN), 0);
  assert.equal(U.caScale(200), 0.02); // 6/200 = 0.03 clamped to 0.02
  assert.ok(Math.abs(U.caScale(1000) - 0.006) < 1e-12);
  assert.ok(U.caScale(400) >= U.caScale(800));
  assert.ok(Math.abs(U.caScale(1000, 5) - 0.01) < 1e-12);
});

test('bindVisibility is a safe no-op outside the browser', () => {
  const unbind = U.bindVisibility(() => {});
  assert.equal(typeof unbind, 'function');
  unbind();
});
