// test/variant.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  VARIANTS, CONTROL_KEYS, DEFAULT_CONTROLS,
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

test('profileFor(jr): checklist maps through; never-in-JR stays false with EVERYTHING on', () => {
  const allOn = Object.fromEntries(CONTROL_KEYS.map((k) => [k, true]));
  const p = profileFor('jr', allOn);
  assert.equal(p.contentLock, true);
  assert.equal(p.files, true);
  assert.equal(p.browser, true);
  // The spine of the build — no combination of controls reaches these:
  for (const never of ['cameraConfig', 'screenDrive', 'claudeBridge', 'nightShift', 'schedules', 'autonomy', 'phone', 'defense']) {
    assert.equal(p[never], false, `${never} must be false in jr`);
  }
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

void VARIANTS; void isJr;
