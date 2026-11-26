const test = require('node:test');
const assert = require('node:assert/strict');
const { friendlyError } = require('../src/renderer');

const INSTALLED = { installed: true, running: true, wakeReady: true };

// Issue #3: every diagnostic green, yet the home screen kept saying
// "not ready yet — install it" because any voice error collapsed into that line.
test('friendlyError: installed voice never gets told to install', () => {
  for (const raw of [
    'Local voice stopped unexpectedly.',
    'Local voice is not running.',
    'Local transcription took too long.',
    'Local transcription failed: [Errno 22] Invalid data found when processing input'
  ]) {
    const shown = friendlyError(new Error(raw), INSTALLED);
    assert.doesNotMatch(shown, /install local voice/i, raw);
    assert.match(shown, /^Local voice hit a problem: /, raw);
  }
});

test('friendlyError: the real cause is kept in the message', () => {
  const shown = friendlyError(new Error('Local transcription failed: [Errno 22] Invalid data found when processing input'), INSTALLED);
  assert.match(shown, /Invalid data found when processing input/);
  assert.match(shown, /Repair Voice/);
});

test('friendlyError: genuinely missing voice still says install', () => {
  const fromService = friendlyError(new Error('Install Local Voice from Settings first. No paid API is required.'), INSTALLED);
  assert.match(fromService, /not installed yet.*Install Local Voice/);
  const fromStatus = friendlyError(new Error('Local voice is not running.'), { installed: false });
  assert.match(fromStatus, /not installed yet/);
});

test('friendlyError: very long voice errors are trimmed', () => {
  const shown = friendlyError(new Error(`Local transcription failed: ${'x'.repeat(1000)}`), INSTALLED);
  assert.ok(shown.length < 360);
});

test('friendlyError: non-voice errors are unchanged', () => {
  assert.equal(friendlyError(new Error('fetch failed')), 'Ollama is offline. Your tasks and file tools still work normally.');
  assert.equal(friendlyError(new Error('OpenAI quota exceeded')), 'OpenAI quota exceeded');
});
