const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldAttemptResume } = require('../src/renderer');

// shouldAttemptResume() is the pure decision function behind the speech
// watchdog: given a snapshot of speechSynthesis's speaking/paused/pending
// tri-state, should we call resume() right now? The DOM/Electron wiring
// around it (the setInterval watchdog itself, actually calling
// speechSynthesis.resume(), onstart/onend/onerror handling) is not
// unit-testable in this repo — it depends on the real Web Speech API and a
// live renderer, which is exactly what was exercised manually against
// src/index.html in the browser pane while diagnosing this bug, not here.

test('shouldAttemptResume: paused while speaking is the stuck case — resume', () => {
  assert.equal(shouldAttemptResume({ speaking: true, paused: true, pending: false }), true);
});

test('shouldAttemptResume: paused while a queued utterance is pending — resume', () => {
  assert.equal(shouldAttemptResume({ speaking: false, paused: true, pending: true }), true);
});

test('shouldAttemptResume: normal playback (speaking, not paused) — leave it alone', () => {
  assert.equal(shouldAttemptResume({ speaking: true, paused: false, pending: false }), false);
});

test('shouldAttemptResume: idle engine, nothing speaking or pending — leave it alone', () => {
  assert.equal(shouldAttemptResume({ speaking: false, paused: false, pending: false }), false);
});

test('shouldAttemptResume: paused but nothing queued at all — nothing to resume', () => {
  assert.equal(shouldAttemptResume({ speaking: false, paused: true, pending: false }), false);
});

test('shouldAttemptResume: missing or malformed state is treated as "do nothing"', () => {
  assert.equal(shouldAttemptResume(null), false);
  assert.equal(shouldAttemptResume(undefined), false);
  assert.equal(shouldAttemptResume({}), false);
});
