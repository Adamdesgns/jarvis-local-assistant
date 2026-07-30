// test/variant.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  VARIANTS, CONTROL_KEYS, CONTROL_LABELS, DEFAULT_CONTROLS, STANDARD_PROFILE,
  resolveVariant, isJr, normalizeControls, profileFor
} = require('../core/variant');

test('resolveVariant: only an explicit jr stamp or env is jr', () => {
  assert.equal(resolveVariant({}), 'standard');
  assert.equal(resolveVariant({ stamped: 'jr' }), 'jr');
  assert.equal(resolveVariant({ stamped: 'JR ' }), 'jr');
  assert.equal(resolveVariant({ env: 'jr' }), 'jr');
  assert.equal(resolveVariant({ stamped: 'junior' }), 'standard'); // unknown never widens
  assert.equal(resolveVariant(null), 'standard');
});

test('normalizeControls: unknown keys dropped, non-booleans coerced, missing keys take defaults', () => {
  const out = normalizeControls({ files: 1, evil: true, browser: 'yes' });
  assert.equal(out.files, true);
  assert.equal(out.browser, true);
  assert.equal(out.documents, false);      // default off
  assert.equal(out.games, true);           // default on
  assert.equal('evil' in out, false);
  assert.deepEqual(Object.keys(out).sort(), [...CONTROL_KEYS].sort());
});

test('profileFor(standard) grants everything JR gates and no content lock', () => {
  const p = profileFor('standard', null);
  assert.equal(p.contentLock, false);
  assert.equal(p.files, true);
  assert.equal(p.nightShift, true);
});

test('profileFor(jr): the never-block is now exactly one thing — the content lock', () => {
  const allOn = Object.fromEntries(CONTROL_KEYS.map((k) => [k, true]));
  const p = profileFor('jr', allOn);
  assert.equal(p.contentLock, true);
  for (const key of ['files', 'browser', 'terminal', 'cameras',
                     'claudeBridge', 'screenDrive', 'defense',
                     'nightShift', 'schedules', 'autonomy', 'phone']) {
    assert.equal(p[key], true, `${key} must be parent-enablable in jr`);
  }
  assert.equal('cameraConfig' in p, false, 'the dead cameraConfig flag is gone');
  assert.equal('cameraConfig' in STANDARD_PROFILE, false);
});

test('the added keys are kid-reach checklist keys, defaulting OFF', () => {
  for (const key of ['claudeBridge', 'screenDrive', 'defense', 'gameCamera']) {
    assert.ok(CONTROL_KEYS.includes(key), `${key} must be a checklist key`);
    assert.equal(DEFAULT_CONTROLS[key], false, `${key} must default off`);
    assert.equal(profileFor('jr', DEFAULT_CONTROLS)[key], false);
  }
  // The grown-up-only four are NOT kid checklist keys — they are settings.
  for (const key of ['nightShift', 'schedules', 'autonomy', 'phone']) {
    assert.ok(!CONTROL_KEYS.includes(key), `${key} is a parent SETTING, not a checklist key`);
  }
  assert.equal(CONTROL_KEYS.length, 18);
});

test('gameCamera is its own key, never a rider on cameras — the two mean different things', () => {
  // 'cameras' = the kid may VIEW the household cameras. 'gameCamera' = the
  // webcam may READ the kid's hand during rock paper scissors. A parent
  // granting one must never silently grant the other, in either direction.
  const camerasOnly = profileFor('jr', { ...DEFAULT_CONTROLS, cameras: true });
  assert.equal(camerasOnly.cameras, true);
  assert.equal(camerasOnly.gameCamera, false, 'cameras must not drag gameCamera on');
  const gameOnly = profileFor('jr', { ...DEFAULT_CONTROLS, gameCamera: true });
  assert.equal(gameOnly.gameCamera, true);
  assert.equal(gameOnly.cameras, false, 'gameCamera must not drag cameras on');
});

test('CONTROL_LABELS is the single source of display copy and covers every key', () => {
  assert.deepEqual(Object.keys(CONTROL_LABELS).sort(), [...CONTROL_KEYS].sort());
  for (const key of CONTROL_KEYS) assert.ok(String(CONTROL_LABELS[key]).trim().length > 0, key);
});

test('profileFor(jr) with defaults: base on, reach-out features off', () => {
  const p = profileFor('jr', DEFAULT_CONTROLS);
  assert.equal(p.games, true);
  assert.equal(p.tasks, true);
  assert.equal(p.documents, false);
  assert.equal(p.files, false);
  assert.equal(p.power, false);
});

test('a birthday changes no feature: profileFor takes no age argument', () => {
  assert.equal(profileFor.length, 2);
});

// The one surviving never-key. contentLock:true sits AFTER the controls
// spread in profileFor's jr branch, so a hostile/malformed controls object
// carrying its own contentLock key is structurally overwritten — the content
// lock has no off switch, whatever a kid-edited blob claims.
test('the content lock still has no off switch and cannot ride in on a controls object', () => {
  const p = profileFor('jr', { contentLock: false, games: false, defense: true });
  assert.equal(p.contentLock, true);
  assert.equal(p.games, false, 'real checklist keys still map through');
  assert.equal(p.defense, true, 'defense is a checklist key now — the parent may hand it down');
});

void VARIANTS; void isJr;
