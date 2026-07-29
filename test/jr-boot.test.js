'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { jrUserDataPath, jrIpcAllowlist, profileFor, DEFAULT_CONTROLS } = require('../core/variant');

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
