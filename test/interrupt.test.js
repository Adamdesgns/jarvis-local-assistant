const test = require('node:test');
const assert = require('node:assert/strict');
const { isInterrupt, INTERRUPT_PHRASES } = require('../src/renderer');

test('isInterrupt: bare interrupt words and phrases are recognized', () => {
  for (const phrase of INTERRUPT_PHRASES) {
    assert.equal(isInterrupt(phrase), true, `expected "${phrase}" to interrupt`);
  }
});

test('isInterrupt: addressing him by name still counts', () => {
  assert.equal(isInterrupt('jarvis stop'), true);
  assert.equal(isInterrupt('Jarvis, stop'), true);
  assert.equal(isInterrupt('hey jarvis stop'), true);
  assert.equal(isInterrupt('Jarvis shut up'), true);
  assert.equal(isInterrupt('jarvis quiet'), true);
  assert.equal(isInterrupt('jarvis nevermind'), true);
  assert.equal(isInterrupt('jarvis never mind'), true);
  assert.equal(isInterrupt('jarvis cancel that'), true);
});

test('isInterrupt: case, punctuation and stray whitespace do not matter', () => {
  assert.equal(isInterrupt('STOP'), true);
  assert.equal(isInterrupt('Stop!'), true);
  assert.equal(isInterrupt('  stop  '), true);
  assert.equal(isInterrupt('quiet.'), true);
  assert.equal(isInterrupt('Never Mind.'), true);
});

test('isInterrupt: legitimate commands that merely contain "stop" are not swallowed', () => {
  assert.equal(isInterrupt('stop the timer'), false);
  assert.equal(isInterrupt('stop recording in five minutes'), false);
  assert.equal(isInterrupt('can you stop the music at nine'), false);
  assert.equal(isInterrupt('cancel that meeting'), false);
  assert.equal(isInterrupt('cancel that reminder for tomorrow'), false);
  assert.equal(isInterrupt('quiet down the fan schedule'), false);
});

test('isInterrupt: empty, missing, or unrelated transcripts are not interrupts', () => {
  assert.equal(isInterrupt(''), false);
  assert.equal(isInterrupt('   '), false);
  assert.equal(isInterrupt(undefined), false);
  assert.equal(isInterrupt(null), false);
  assert.equal(isInterrupt('what is the weather today'), false);
  assert.equal(isInterrupt('add milk to my shopping list'), false);
});
