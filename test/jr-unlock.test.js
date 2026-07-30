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

// ---- The security properties this whole refactor rests on ---------------
// The parent's unlocked window widens the IPC surface and settings:save.
// It must NOT widen the content lock, the kid's router branches, or the
// tool belt — those follow PROFILE, which the session never touches.

const { ParentSession } = require('../core/parent-session');
const { profileFor: profile2, CONTROL_KEYS } = require('../core/variant');
const { filterRegistryForProfile } = require('../core/tool-registry');
const { buildToolRegistry } = require('../core/tool-registry');

test('an unlocked session does not touch the profile: the content lock stays on', () => {
  const session = new ParentSession();
  session.unlock();
  // Whatever the session says, the profile is computed from the checklist
  // alone — there is no seam by which "unlocked" reaches profileFor.
  const p = profile2('jr', Object.fromEntries(CONTROL_KEYS.map((k) => [k, true])));
  assert.equal(p.contentLock, true);
  assert.equal(profileFor.length, 2, 'profileFor takes (variant, controls) — no session argument');
});

test('an unlocked session does not widen the tool belt', () => {
  const registry = buildToolRegistry({
    tools: {}, tasks: {}, memory: {}, config: {}, documents: {},
    getCameras: () => null, getAi: () => null
  });
  const kidProfile = profile2('jr', DEFAULT_CONTROLS);
  const names = filterRegistryForProfile(registry, kidProfile).map((t) => t.name);
  // documents/files are off in DEFAULT_CONTROLS, so their tools are gone —
  // and no session state can put them back, because the filter only ever
  // sees a profile.
  assert.ok(!names.includes('read_file'));
  assert.ok(!names.includes('search_files'));
  assert.ok(names.includes('add_task'));
  assert.equal(filterRegistryForProfile.length, 2, 'the filter takes (registry, profile) only');
});

test('a locked kid cannot reach the admin channels at ANY checklist setting', () => {
  const everything = jrIpcAllowlist(profileFor('jr', Object.fromEntries(CONTROL_KEYS.map((k) => [k, true]))));
  const locked = () => false;
  for (const channel of [
    'jr:parent:controls', 'jr:parent:pin',
    'cameras:add-rtsp', 'cameras:remove-account', 'cameras:set-armed',
    'openai:save-key', 'anthropic:save-key',
    'mobile:pair', 'schedule:add', 'backup:import', 'transcript:reveal',
    'defense:zones', 'update:open', 'license:activate'
  ]) {
    assert.equal(jrChannelAllowed(channel, everything, locked), false, `${channel} must stay shut for a kid`);
  }
});

test('the session is the ONLY thing that opens the admin surface, and it expires', () => {
  const clock = { t: 0 };
  const session = new ParentSession({ now: () => clock.t, idleMs: 1000, ceilingMs: 10000 });
  const admit = () => session.admit();
  assert.equal(jrChannelAllowed('cameras:add-rtsp', KID, admit), false, 'locked by default');
  session.unlock();
  assert.equal(jrChannelAllowed('cameras:add-rtsp', KID, admit), true, 'a verified PIN opens it');
  clock.t += 5000;                                    // past the idle cap
  assert.equal(jrChannelAllowed('cameras:add-rtsp', KID, admit), false, 'expiry re-blocks on the very next call');
  session.unlock();
  assert.equal(jrChannelAllowed('cameras:add-rtsp', KID, admit), true, 're-entering the PIN reopens it');
  session.lock();
  assert.equal(jrChannelAllowed('cameras:add-rtsp', KID, admit), false, 'closing the dialog shuts it');
});

test('kid settings stay cosmetic even with every checklist item on', () => {
  const everythingOn = { jr: true, unlocked: false };
  const hostile = {
    orbSkin: 'nebula',
    searchRoots: ['C:\\'], applications: { evil: 'cmd.exe' }, routines: {},
    screenControlEnabled: true, nightShiftEnabled: true, mobileEnabled: true,
    aiMode: 'cloud', cameraAccounts: [{ brand: 'blink' }]
  };
  assert.deepEqual(jrSettingsPatch(hostile, everythingOn), { orbSkin: 'nebula' });
});
