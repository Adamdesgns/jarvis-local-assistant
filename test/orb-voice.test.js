const test = require('node:test');
const assert = require('node:assert/strict');
const { levelFromSamples, captionSlice, boundarySlice } = require('../src/orb-voice');

// The "he comes alive" pass (Adam, 2026-07-27): the orb pulses with JARVIS's
// OWN voice and his words caption live below the sphere while he speaks.
// These are the pure pieces; the renderer only wires them to WebAudio.

// ---- levelFromSamples: byte time-domain samples -> orb audio level ------

test('silence is level zero', () => {
  // 128 is the zero line for byte time-domain data.
  assert.equal(levelFromSamples(new Uint8Array(512).fill(128)), 0);
});

test('a loud signal clamps to 1 and never overshoots', () => {
  const loud = new Uint8Array(512);
  for (let i = 0; i < loud.length; i++) loud[i] = i % 2 ? 255 : 0;
  const level = levelFromSamples(loud);
  assert.equal(level, 1);
});

test('a moderate signal lands between 0 and 1, matching the mic curve', () => {
  // The mic path scales RMS by 9 — the orb must react to his voice exactly
  // as it reacts to Adam's, or the two moods look like different features.
  const gentle = new Uint8Array(512);
  for (let i = 0; i < gentle.length; i++) gentle[i] = 128 + (i % 2 ? 13 : -13);
  const rms = 13 / 128;
  const expected = Math.min(1, rms * 9);
  assert.ok(Math.abs(levelFromSamples(gentle) - expected) < 1e-9);
});

test('empty or missing samples read as silence, never a crash', () => {
  assert.equal(levelFromSamples(new Uint8Array(0)), 0);
  assert.equal(levelFromSamples(null), 0);
  assert.equal(levelFromSamples(undefined), 0);
});

// ---- captionSlice: progress through the audio -> whole words shown ------

test('captionSlice reveals nothing at 0 and everything at 1', () => {
  assert.equal(captionSlice('Good evening, sir.', 0), '');
  assert.equal(captionSlice('Good evening, sir.', 1), 'Good evening, sir.');
  assert.equal(captionSlice('Good evening, sir.', 1.7), 'Good evening, sir.');
  assert.equal(captionSlice('Good evening, sir.', -1), '');
});

test('captionSlice never cuts a word in half', () => {
  const text = 'The cameras are up and the porch is quiet.';
  for (let progress = 0; progress <= 1.0001; progress += 0.03) {
    const slice = captionSlice(text, progress);
    assert.ok(text.startsWith(slice), `"${slice}" must be a prefix`);
    if (slice.length && slice.length < text.length) {
      // A partial slice must end exactly at a word boundary: the last shown
      // character is not a space, and the very next character is.
      assert.notEqual(slice[slice.length - 1], ' ', 'must not end with a dangling space');
      assert.match(text.slice(slice.length), /^\s/, 'the cut must land on a word boundary');
    }
  }
});

test('captionSlice grows monotonically with progress', () => {
  const text = 'Systems steady, mood excellent, all cameras accounted for.';
  let previous = '';
  for (let progress = 0; progress <= 1; progress += 0.05) {
    const slice = captionSlice(text, progress);
    assert.ok(slice.length >= previous.length, 'captions never un-say a word');
    previous = slice;
  }
});

test('captionSlice handles degenerate text', () => {
  assert.equal(captionSlice('', 0.5), '');
  assert.equal(captionSlice(null, 0.5), '');
  assert.equal(captionSlice('word', 0.5), '');
  assert.equal(captionSlice('word', 1), 'word');
});

// ---- boundarySlice: speechSynthesis onboundary charIndex -> words shown --

test('boundarySlice shows text through the word being spoken', () => {
  const text = 'Standing by for orders.';
  assert.equal(boundarySlice(text, 0), 'Standing');
  assert.equal(boundarySlice(text, 9), 'Standing by');
  assert.equal(boundarySlice(text, 12), 'Standing by for');
  assert.equal(boundarySlice(text, 16), 'Standing by for orders.');
});

test('boundarySlice clamps out-of-range indexes', () => {
  assert.equal(boundarySlice('Hello there.', 500), 'Hello there.');
  assert.equal(boundarySlice('Hello there.', -3), 'Hello');
  assert.equal(boundarySlice('', 4), '');
  assert.equal(boundarySlice(null, 4), '');
});
