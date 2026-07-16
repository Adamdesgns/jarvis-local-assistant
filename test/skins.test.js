const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeSettings } = require('../core/config-store');
const { DEFAULT_SETTINGS } = require('../core/defaults');

test('skin setting: defaults to classic and old saves keep a valid skin', () => {
  assert.equal(DEFAULT_SETTINGS.skin, 'classic');
  const old = mergeSettings(DEFAULT_SETTINGS, { settingsVersion: 6 });
  assert.equal(old.skin, 'classic');
  const kept = mergeSettings(DEFAULT_SETTINGS, { settingsVersion: 6, skin: 'command-center' });
  assert.equal(kept.skin, 'command-center');
});

const { SKINS, resolveSkin, mapState } = require('../src/skins');

test('resolveSkin: valid names pass through, unknown falls back to classic', () => {
  assert.deepEqual(SKINS, ['classic', 'command-center']);
  assert.deepEqual(resolveSkin('command-center'), { dataSkin: 'command-center', pauseCanvas: true });
  assert.deepEqual(resolveSkin('classic'), { dataSkin: 'classic', pauseCanvas: false });
  assert.deepEqual(resolveSkin('nonsense'), { dataSkin: 'classic', pauseCanvas: false });
  assert.deepEqual(resolveSkin(undefined), { dataSkin: 'classic', pauseCanvas: false });
});

test('mapState: every real state maps to a command-center state, colour and message', () => {
  assert.equal(mapState('ready').ccState, 'STANDBY');
  assert.equal(mapState('ready').color, '#58d8ff');
  assert.equal(mapState('listening').ccState, 'LISTENING');
  assert.equal(mapState('processing').ccState, 'THINKING');
  assert.equal(mapState('speaking').ccState, 'SPEAKING');
  assert.equal(mapState('exploding').ccState, 'WORKING');
  assert.equal(mapState('error').ccState, 'ERROR');
  assert.equal(mapState('offline').ccState, 'OFFLINE');
  // Unknown states fail safe to OFFLINE, never throw.
  assert.equal(mapState('who-knows').ccState, 'OFFLINE');
  for (const s of ['ready', 'listening', 'processing', 'speaking', 'exploding', 'error', 'offline', 'x']) {
    const m = mapState(s);
    assert.match(m.color, /^#[0-9a-f]{6}$/i);
    assert.ok(typeof m.message === 'string' && m.message.length);
  }
});
