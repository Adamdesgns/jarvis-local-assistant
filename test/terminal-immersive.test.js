const { test } = require('node:test');
const assert = require('node:assert');
const { rainStyle, RAIN_LEVELS } = require('../src/terminal-ui');

// THE TERMINAL, immersive pass. Two pure pieces are worth pinning: how bright
// the rain paints at each level, and that the levels are genuinely ordered.
// Everything else about the rain is pixels, and the rig proves those.

test('every named level produces alphas and chances inside the legal range', () => {
  for (const level of RAIN_LEVELS) {
    const style = rainStyle(level);
    for (const [key, value] of Object.entries(style)) {
      assert.ok(Number.isFinite(value), `${level}.${key} is not a number`);
      assert.ok(value >= 0 && value <= 1, `${level}.${key} = ${value} is outside 0..1`);
    }
  }
});

test('the levels are strictly ordered — each one paints more than the last', () => {
  const styles = RAIN_LEVELS.map((level) => rainStyle(level));
  for (let i = 1; i < styles.length; i += 1) {
    const dimmer = styles[i - 1];
    const brighter = styles[i];
    const label = `${RAIN_LEVELS[i - 1]} → ${RAIN_LEVELS[i]}`;
    assert.ok(brighter.trail > dimmer.trail, `${label}: trail must brighten`);
    assert.ok(brighter.glow > dimmer.glow, `${label}: glow must brighten`);
    assert.ok(brighter.headChance > dimmer.headChance, `${label}: more white heads`);
    assert.ok(brighter.glowChance > dimmer.glowChance, `${label}: more glowing glyphs`);
  }
});

test('a brighter level never fades the previous frame harder — that would eat the trails', () => {
  const styles = RAIN_LEVELS.map((level) => rainStyle(level));
  for (let i = 1; i < styles.length; i += 1) {
    assert.ok(
      styles[i].fade <= styles[i - 1].fade,
      `${RAIN_LEVELS[i]} fades harder than ${RAIN_LEVELS[i - 1]}, which shortens the trails`
    );
  }
});

test('the glow is always brighter than the trail it sits in', () => {
  for (const level of RAIN_LEVELS) {
    const style = rainStyle(level);
    assert.ok(style.glow > style.trail, `${level}: glowing glyphs must outshine the tail`);
  }
});

test('an unknown level falls back to the normal one rather than throwing', () => {
  assert.deepStrictEqual(rainStyle('technicolor'), rainStyle('normal'));
  assert.deepStrictEqual(rainStyle(undefined), rainStyle('normal'));
});

test('bold is meaningfully brighter than normal, not a rounding error', () => {
  const normal = rainStyle('normal');
  const bold = rainStyle('bold');
  // The whole point of the immersive mode: you can see the difference.
  assert.ok(bold.trail >= normal.trail * 1.4, 'bold trails should be clearly brighter');
});
