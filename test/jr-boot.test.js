'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  jrUserDataPath, jrIpcAllowlist, profileFor, DEFAULT_CONTROLS,
  JR_SETTINGS_ALLOW, filterJrSettingsPatch
} = require('../core/variant');

test('jrUserDataPath: own folder, never the grown-up one', () => {
  const p = jrUserDataPath('C:\\Users\\kid\\AppData\\Roaming');
  assert.match(p, /jarvis-jr$/);
  assert.doesNotMatch(p, /jarvis-local-assistant/);
});

test('jrUserDataPath: joins under whatever appData dir it is given', () => {
  const p = jrUserDataPath('/home/kid/.config');
  assert.match(p, /jarvis-jr$/);
});

test('ipc allowlist: base channels always present, at every checklist setting', () => {
  const off = jrIpcAllowlist(profileFor('jr', DEFAULT_CONTROLS));
  assert.ok(off.has('bootstrap'));
  assert.ok(off.has('command:submit'));
  assert.ok(off.has('transcript:read'));
  assert.ok(off.has('approval:resolve'));
  assert.ok(off.has('activity:recent'));
  assert.ok(off.has('tts:speak'));
  assert.ok(off.has('voice:transcribe'));
  assert.ok(off.has('memory:list'));
  assert.ok(off.has('settings:save'));
  assert.ok(off.has('window:control'));
  assert.ok(off.has('jr:status'));
  assert.ok(off.has('jr:setup:complete'));
  assert.ok(off.has('jr:parent:verify'));
  assert.ok(off.has('jr:parent:controls'));
  assert.ok(off.has('jr:parent:pin'));
});

test('ipc allowlist: feature channels absent when the control is off, present when on', () => {
  const off = jrIpcAllowlist(profileFor('jr', DEFAULT_CONTROLS));
  assert.ok(!off.has('cameras:snapshot'));
  assert.ok(!off.has('terminal:run'));
  assert.ok(!off.has('screen:describe'));
  assert.ok(!off.has('files:list'));

  const on = jrIpcAllowlist(profileFor('jr', { ...DEFAULT_CONTROLS, cameras: true }));
  assert.ok(on.has('cameras:snapshot'));
  assert.ok(on.has('cameras:bootstrap'));
  // Turning cameras on must not smuggle in an unrelated feature's channels.
  assert.ok(!on.has('terminal:run'));

  const terminalOn = jrIpcAllowlist(profileFor('jr', { ...DEFAULT_CONTROLS, terminal: true }));
  assert.ok(terminalOn.has('terminal:classify'));
  assert.ok(terminalOn.has('terminal:run'));
  assert.ok(terminalOn.has('terminal:cwd'));

  const filesOn = jrIpcAllowlist(profileFor('jr', { ...DEFAULT_CONTROLS, files: true }));
  assert.ok(filesOn.has('files:roots'));
  assert.ok(filesOn.has('files:home'));
  assert.ok(filesOn.has('files:list'));
  assert.ok(filesOn.has('path:open'));
  assert.ok(filesOn.has('dialog:folder'));
});

test('ipc allowlist: tasks is on by default (matches DEFAULT_CONTROLS.tasks)', () => {
  const off = jrIpcAllowlist(profileFor('jr', DEFAULT_CONTROLS));
  assert.ok(off.has('tasks:list'));
  assert.ok(off.has('tasks:add'));
});

test('ipc allowlist: never-list channels are absent no matter what is switched on', () => {
  const allOn = jrIpcAllowlist(profileFor('jr', Object.fromEntries(Object.keys(DEFAULT_CONTROLS).map((k) => [k, true]))));
  const never = [
    'mobile:status', 'mobile:pair',
    'defense:status', 'defense:enter',
    'schedule:list', 'schedule:add',
    'openai:save-key', 'anthropic:save-key',
    'nightshift:status',
    'update:open',
    'external:openai-keys', 'external:anthropic-keys', 'external:buy-pro',
    'backup:export', 'backup:import',
    'license:activate', 'license:deactivate',
    'transcript:reveal',
    'screen:drive-stop'
  ];
  for (const channel of never) {
    assert.ok(!allOn.has(channel), `${channel} must never be exposed in jr`);
  }
});

test('ipc allowlist: standard variant is unaffected (jr helper only meaningful for jr profiles)', () => {
  const standard = jrIpcAllowlist(profileFor('standard', DEFAULT_CONTROLS));
  // Standard's own profile has every checklist flag true, so every feature
  // set is admitted — but the never-list channels are still not part of any
  // FEATURE_IPC set, so they still do not appear via this helper.
  assert.ok(!standard.has('mobile:status'));
  assert.ok(standard.has('cameras:snapshot'));
});

// FIX 2 (Critical, task-6 review): camera CONFIG must be PIN-gated in JR.
// Adding/removing a camera account (or arming/disarming a security system) is
// parental territory, same family as the jrParent secret itself — a kid who
// can reach cameras:add-blink could plant a stranger's Blink login on the
// family account with nobody the wiser. Those channels move behind the new
// jr:parent:cameras multiplexer (PIN-verified per call, same as
// jr:parent:controls); only viewing what is already configured stays under
// the plain 'cameras' checklist flag.
test('ipc allowlist: cameras ON exposes only view channels, never account/arm config, plus jr:parent:cameras', () => {
  const on = jrIpcAllowlist(profileFor('jr', { ...DEFAULT_CONTROLS, cameras: true }));
  // view surface: listing, snapshotting, live-viewing what is already set up
  for (const viewChannel of [
    'cameras:bootstrap', 'cameras:systems', 'cameras:list', 'cameras:snapshot',
    'cameras:describe', 'cameras:live-start', 'cameras:live-stop', 'cameras:live-answer',
    'cameras:discover'
  ]) {
    assert.ok(on.has(viewChannel), `${viewChannel} should stay kid-reachable when cameras is on`);
  }
  // config surface: adding/removing accounts, arming/disarming — never admitted directly
  for (const configChannel of [
    'cameras:add-blink', 'cameras:blink-pin', 'cameras:add-ring', 'cameras:add-nest',
    'cameras:add-rtsp', 'cameras:remove-account', 'cameras:set-armed'
  ]) {
    assert.ok(!on.has(configChannel), `${configChannel} must never be directly reachable, even with cameras on`);
  }
  // the PIN-gated doorway is present at every checklist setting, cameras on or off
  assert.ok(on.has('jr:parent:cameras'));
  const off = jrIpcAllowlist(profileFor('jr', DEFAULT_CONTROLS));
  assert.ok(off.has('jr:parent:cameras'));
  assert.ok(!off.has('cameras:add-blink'));
});

// FIX 4 (Important, task-6 review): JR settings allowlist. settings:save's
// existing ConfigStore allowlist was written for a single-variant app — it
// happily writes searchRoots/routines/cameraAccounts/screenControlEnabled/etc
// from a JR renderer patch, none of which any JR UI should ever assemble, but
// nothing stopped a hand-crafted IPC call from doing it anyway. JR_SETTINGS_ALLOW
// is the narrower list main.js's settings:save now filters every JR patch
// through: cosmetic/voice state only, nothing capability-adjacent.
test('JR_SETTINGS_ALLOW: benign UI/voice state only — no capability-adjacent keys', () => {
  for (const benign of [
    'skin', 'orbSkin', 'orbColor', 'windowGlass', 'motionMode', 'moduleLayout',
    'hiddenModules', 'orbBounds', 'voiceName', 'voiceEnabled', 'localVoiceEnabled',
    'localVoiceModel', 'wakeWordEnabled', 'wakeSensitivity', 'ttsEngine',
    'kokoroVoice', 'kokoroDevice', 'minimizeToOrb'
  ]) {
    assert.ok(JR_SETTINGS_ALLOW.includes(benign), `${benign} should be allowed`);
  }
  for (const capabilityAdjacent of [
    'searchRoots', 'projects', 'routines', 'focusApps', 'cameraAccounts',
    'cameraAiDescriptions', 'cameraCloudVision', 'screenControlEnabled',
    'screenControlAllowlist', 'aiMode', 'cloudProvider'
  ]) {
    assert.ok(!JR_SETTINGS_ALLOW.includes(capabilityAdjacent), `${capabilityAdjacent} must never be JR-writable`);
  }
});

test('filterJrSettingsPatch: keeps allowed keys, silently drops everything else', () => {
  const patch = {
    orbSkin: 'nebula', wakeSensitivity: 'high',
    searchRoots: ['C:\\anywhere'], cameraAccounts: [{ brand: 'blink' }],
    aiMode: 'cloud', assistantName: 'Not Jarvis'
  };
  const filtered = filterJrSettingsPatch(patch);
  assert.deepEqual(filtered, { orbSkin: 'nebula', wakeSensitivity: 'high' });
});

test('filterJrSettingsPatch: empty/undefined patch yields an empty object, not a throw', () => {
  assert.deepEqual(filterJrSettingsPatch({}), {});
  assert.deepEqual(filterJrSettingsPatch(undefined), {});
});
