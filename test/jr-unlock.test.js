'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  jrIpcAllowlist, profileFor, DEFAULT_CONTROLS,
  jrChannelAllowed, jrSettingsPatch, JR_IPC
} = require('../core/variant');

const KID = jrIpcAllowlist(profileFor('jr', DEFAULT_CONTROLS));

test('a kid channel is admitted WITHOUT ever asking the parent session', () => {
  let asked = 0;
  const admit = () => { asked += 1; return false; };
  assert.equal(jrChannelAllowed('command:submit', KID, admit), true);
  assert.equal(jrChannelAllowed('settings:save', KID, admit), true);
  assert.equal(jrChannelAllowed('jr:parent:session', KID, admit), true);
  // The thunk IS the idle-timer heartbeat. Kid traffic must never touch it,
  // or a child playing tic-tac-toe keeps a parent session open all afternoon.
  assert.equal(asked, 0);
});

test('an admin channel needs the session, and asks it exactly once per call', () => {
  let asked = 0;
  const locked = () => { asked += 1; return false; };
  assert.equal(jrChannelAllowed('cameras:add-blink', KID, locked), false);
  assert.equal(asked, 1);
  for (const channel of ['cameras:add-blink', 'mobile:pair', 'anthropic:save-key',
                         'schedule:add', 'backup:export', 'transcript:reveal',
                         'jr:parent:controls', 'jr:parent:pin']) {
    assert.equal(jrChannelAllowed(channel, KID, () => true), true, channel);
    assert.equal(jrChannelAllowed(channel, KID, () => false), false, channel);
  }
});

test('an expired session re-blocks: the gate re-asks on every single call', () => {
  let open = true;
  const admit = () => open;
  assert.equal(jrChannelAllowed('schedule:add', KID, admit), true);
  open = false;
  assert.equal(jrChannelAllowed('schedule:add', KID, admit), false);
});

test('the checklist and the PIN are ADMIN channels; the way in stays kid-reachable', () => {
  assert.ok(!KID.has('jr:parent:controls'), 'a kid must not be able to edit his own checklist');
  assert.ok(!KID.has('jr:parent:pin'));
  for (const channel of ['jr:status', 'jr:setup:complete', 'jr:parent:verify',
                         'jr:parent:lock', 'jr:parent:session']) {
    assert.ok(KID.has(channel), `${channel} must be reachable before any unlock exists`);
  }
  assert.ok(!JR_IPC.includes('jr:parent:cameras'), 'the camera multiplexer is gone');
});

test('settings:save is cosmetic-only for the kid and unfiltered for the parent', () => {
  const patch = { orbSkin: 'nebula', searchRoots: ['C:\\anywhere'], aiMode: 'cloud', nightShiftEnabled: true };
  assert.deepEqual(jrSettingsPatch(patch, { jr: true, unlocked: false }), { orbSkin: 'nebula' });
  assert.deepEqual(jrSettingsPatch(patch, { jr: true, unlocked: true }), patch);
  assert.deepEqual(jrSettingsPatch(patch, { jr: false, unlocked: false }), patch);
  assert.deepEqual(jrSettingsPatch(undefined, { jr: true, unlocked: false }), {});
});
