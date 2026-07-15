const test = require('node:test');
const assert = require('node:assert/strict');
const { TIERS, isWithinWindow, evaluateAlert, shouldNotify, decideAct } = require('../core/autonomy-rules');

function at(hour, minute = 0) {
  return new Date(2026, 6, 15, hour, minute, 0);
}

function settingsWith(overrides = {}, rules = {}) {
  return {
    autonomyEnabled: true,
    autonomyRules: { speakDoorbell: false, nightMotionOnly: false, someoneHereCard: false, speakMotion: false, ...rules },
    autonomyNightStart: 21,
    autonomyNightEnd: 7,
    ...overrides
  };
}

test('autonomy window: handles windows that cross midnight', () => {
  assert.equal(isWithinWindow(at(22), 21, 7), true, '10 PM is night');
  assert.equal(isWithinWindow(at(3), 21, 7), true, '3 AM is night');
  assert.equal(isWithinWindow(at(21), 21, 7), true, 'start hour is inclusive');
  assert.equal(isWithinWindow(at(7), 21, 7), false, 'end hour is exclusive');
  assert.equal(isWithinWindow(at(12), 21, 7), false, 'noon is day');
  // Non-crossing window too.
  assert.equal(isWithinWindow(at(10), 9, 17), true);
  assert.equal(isWithinWindow(at(18), 9, 17), false);
  // start === end means always.
  assert.equal(isWithinWindow(at(4), 8, 8), true);
});

test('autonomy: master switch off produces nothing', () => {
  const settings = settingsWith({ autonomyEnabled: false }, { speakDoorbell: true, speakMotion: true, someoneHereCard: true });
  const actions = evaluateAlert(settings, { kind: 'doorbell', name: 'Front Door', body: 'Front Door: a courier.' }, at(12));
  assert.deepEqual(actions, []);
  assert.equal(shouldNotify(settings, { kind: 'motion' }, at(12)), true, 'gate stays open when autonomy is off');
});

test('autonomy: each rule contributes only when enabled', () => {
  const none = evaluateAlert(settingsWith(), { kind: 'doorbell', name: 'Front Door', body: 'ding' }, at(12));
  assert.deepEqual(none, []);

  const spoken = evaluateAlert(settingsWith({}, { speakDoorbell: true }), { kind: 'doorbell', name: 'Front Door', body: 'Front Door: a courier.' }, at(12));
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].rule, 'speakDoorbell');
  assert.equal(spoken[0].tier, TIERS.ANNOUNCE);
  assert.equal(spoken[0].speak, 'Front Door: a courier.');

  const carded = evaluateAlert(settingsWith({}, { someoneHereCard: true }), { kind: 'doorbell', name: 'Front Door', body: 'ding', jpegBase64: 'abc' }, at(12));
  assert.equal(carded.length, 1);
  assert.equal(carded[0].tier, TIERS.PREPARE);
  assert.deepEqual(carded[0].card, { title: "SOMEONE'S HERE", body: 'ding', jpegBase64: 'abc' });

  const motion = evaluateAlert(settingsWith({}, { speakMotion: true }), { kind: 'motion', name: 'Yard', body: 'Motion at Yard.' }, at(12));
  assert.equal(motion.length, 1);
  assert.equal(motion[0].rule, 'speakMotion');
  assert.equal(motion[0].speak, 'Motion at Yard.');
});

test('autonomy: doorbell rules ignore motion and vice versa', () => {
  const settings = settingsWith({}, { speakDoorbell: true, someoneHereCard: true, speakMotion: true });
  const motionActions = evaluateAlert(settings, { kind: 'motion', name: 'Yard', body: 'Motion at Yard.' }, at(12));
  assert.deepEqual(motionActions.map((a) => a.rule), ['speakMotion'], 'motion never speaks the doorbell rule or raises the card');
  const doorbellActions = evaluateAlert(settings, { kind: 'doorbell', name: 'Front Door', body: 'ding' }, at(12));
  assert.deepEqual(doorbellActions.map((a) => a.rule).sort(), ['someoneHereCard', 'speakDoorbell'], 'doorbell never triggers the motion summary');
});

test('autonomy: night-only rule silences daytime motion but never the doorbell', () => {
  const settings = settingsWith({}, { nightMotionOnly: true, speakMotion: true });
  // Daytime: notification gated AND spoken summary suppressed.
  assert.equal(shouldNotify(settings, { kind: 'motion' }, at(14)), false);
  assert.deepEqual(evaluateAlert(settings, { kind: 'motion', name: 'Yard', body: 'Motion.' }, at(14)), []);
  // Night: both flow.
  assert.equal(shouldNotify(settings, { kind: 'motion' }, at(23)), true);
  assert.equal(evaluateAlert(settings, { kind: 'motion', name: 'Yard', body: 'Motion.' }, at(23)).length, 1);
  // Doorbell is never gated, day or night.
  assert.equal(shouldNotify(settings, { kind: 'doorbell' }, at(14)), true);
  // Rule off: daytime motion notifies as today.
  assert.equal(shouldNotify(settingsWith(), { kind: 'motion' }, at(14)), true);
});

test('autonomy: act tier never self-approves', () => {
  assert.deepEqual(decideAct('safe'), { allowed: true });
  assert.deepEqual(decideAct('confirm'), { allowed: false, requiresApproval: true });
  assert.deepEqual(decideAct('blocked'), { allowed: false, log: true });
  assert.equal(decideAct('anything-unknown').allowed, false, 'unknown classifications are refused');
});

const { mergeSettings } = require('../core/config-store');
const { DEFAULT_SETTINGS } = require('../core/defaults');

test('autonomy settings: everything defaults OFF and old saves merge safely', () => {
  assert.equal(DEFAULT_SETTINGS.autonomyEnabled, false);
  assert.deepEqual(DEFAULT_SETTINGS.autonomyRules, {
    speakDoorbell: false, nightMotionOnly: false, someoneHereCard: false, speakMotion: false
  });
  assert.equal(DEFAULT_SETTINGS.autonomyNightStart, 21);
  assert.equal(DEFAULT_SETTINGS.autonomyNightEnd, 7);

  // An old save with no autonomy keys gets the defaults.
  const old = mergeSettings(DEFAULT_SETTINGS, { settingsVersion: 6 });
  assert.equal(old.autonomyEnabled, false);
  assert.equal(old.autonomyRules.speakDoorbell, false);

  // A partial saved rules object keeps unknown-at-save-time rules at default.
  const partial = mergeSettings(DEFAULT_SETTINGS, { settingsVersion: 6, autonomyRules: { speakDoorbell: true } });
  assert.equal(partial.autonomyRules.speakDoorbell, true);
  assert.equal(partial.autonomyRules.speakMotion, false, 'missing rules fall back to defaults');
});
