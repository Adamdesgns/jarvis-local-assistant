const test = require('node:test');
const assert = require('node:assert/strict');
const { cacheKeyFor, isAudioUsable, shouldFallback, speakableText } = require('../core/voice-service');

// The rule these tests exist to protect: a render that reports success but
// contains no sound must be rejected. On this GPU every fp16 dtype does exactly
// that — tens of thousands of NaN samples followed by pure zeros, correct
// length, no error raised. Nobody on this project can hear the output, so this
// arithmetic is the only thing standing between a broken model and an assistant
// that silently stops talking.
test('isAudioUsable rejects the silent-render failure mode', () => {
  // Real speech from Kokoro measures peak 0.69-0.92, RMS 0.073-0.119.
  assert.equal(isAudioUsable({ peak: 0.746, rms: 0.0775, nan: 0, samples: 261600 }), true);

  // The fp16 failure exactly as observed: NaN prefix, then zeros.
  assert.equal(isAudioUsable({ peak: 0, rms: 0, nan: 65529, samples: 261600 }), false);

  // A single NaN is disqualifying — it means the render went wrong, and NaN
  // reaching an audio device is not something to gamble on.
  assert.equal(isAudioUsable({ peak: 0.8, rms: 0.09, nan: 1, samples: 261600 }), false);

  // Digital silence with no NaN at all: still nothing to play.
  assert.equal(isAudioUsable({ peak: 0, rms: 0, nan: 0, samples: 261600 }), false);

  // Audible but far below real speech — a barely-there render is a failure too.
  assert.equal(isAudioUsable({ peak: 0.04, rms: 0.004, nan: 0, samples: 261600 }), false);

  // An empty buffer is not "valid because nothing was wrong with it".
  assert.equal(isAudioUsable({ peak: 0, rms: 0, nan: 0, samples: 0 }), false);
  assert.equal(isAudioUsable(null), false);
  assert.equal(isAudioUsable(undefined), false);
});

test('shouldFallback keeps JARVIS talking whenever Kokoro cannot be trusted', () => {
  const healthy = { engine: 'kokoro', workerReady: true, modelReady: true, lastError: '' };
  assert.equal(shouldFallback(healthy), false);

  // The model takes a moment to load at launch; that is a fallback, not a bug.
  assert.equal(shouldFallback({ ...healthy, modelReady: false }), true);
  assert.equal(shouldFallback({ ...healthy, workerReady: false }), true);

  // A previous failure keeps him on the system voice rather than retrying into
  // silence on every reply.
  assert.equal(shouldFallback({ ...healthy, lastError: 'voice synthesis timed out' }), true);

  // The user explicitly choosing Windows voices must win.
  assert.equal(shouldFallback({ ...healthy, engine: 'system' }), true);

  // Called with nothing at all, fall back — never assume a working model.
  assert.equal(shouldFallback(), true);
  assert.equal(shouldFallback({}), true);
});

test('cacheKeyFor treats the same line in a different voice as a different sound', () => {
  const line = 'All systems are online and at your service.';
  assert.notEqual(cacheKeyFor('bm_daniel', line), cacheKeyFor('am_michael', line));

  // Whitespace and case differences are the same spoken line — cache once.
  assert.equal(cacheKeyFor('bm_daniel', line), cacheKeyFor('bm_daniel', `  ${line.toUpperCase()}  `));
  assert.equal(cacheKeyFor('bm_daniel', 'a  b'), cacheKeyFor('bm_daniel', 'a b'));

  assert.notEqual(cacheKeyFor('bm_daniel', 'Good evening.'), cacheKeyFor('bm_daniel', 'Good morning.'));

  // Must be safe as a filename: it is used directly as one.
  assert.match(cacheKeyFor('bm_daniel', line), /^[a-z0-9_]+-[a-f0-9]{16}$/);
});

test('speakableText strips markdown that would otherwise be read aloud', () => {
  assert.equal(speakableText('**All** systems are *online*.'), 'All systems are online .');
  assert.equal(speakableText('See [the report](https://example.com/x) now.'), 'See the report now.');
  assert.equal(speakableText('  spread   out  '), 'spread out');
  assert.equal(speakableText(''), '');
  assert.equal(speakableText(null), '');
  assert.equal(speakableText(undefined), '');
});
