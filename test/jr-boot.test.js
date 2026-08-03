'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  jrUserDataPath, jrIpcAllowlist, profileFor, DEFAULT_CONTROLS,
  JR_SETTINGS_ALLOW, filterJrSettingsPatch, STANDARD_PROFILE, moduleAllowedInProfile,
  CONTROL_KEYS
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
  // jr:parent:controls / jr:parent:pin are ADMIN channels now — reachable
  // only through an unlocked parent session, never on the kid surface.
  // Pinned in test/jr-unlock.test.js.
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

// Family calls: on by default (the parent opt-in happened at pairing time —
// pair/unpair channels are never on the kid surface at ANY setting), and the
// whole set vanishes when a parent switches calls off.
test('ipc allowlist: call channels follow the calls flag; pairing is never kid-reachable', () => {
  const on = jrIpcAllowlist(profileFor('jr', DEFAULT_CONTROLS));
  assert.ok(on.has('call:status'));
  assert.ok(on.has('call:ping'));
  assert.ok(on.has('call:dial'));
  assert.ok(on.has('call:answer'));
  assert.ok(on.has('call:ice'));
  assert.ok(on.has('call:hangup'));
  assert.ok(!on.has('call:pair-start'));
  assert.ok(!on.has('call:pair-claim'));
  assert.ok(!on.has('call:unpair'));
  const off = jrIpcAllowlist(profileFor('jr', { ...DEFAULT_CONTROLS, calls: false }));
  assert.ok(!off.has('call:dial'));
  assert.ok(!off.has('call:answer'));
  assert.ok(!off.has('call:status'));
});

test('ipc allowlist: tasks is on by default (matches DEFAULT_CONTROLS.tasks)', () => {
  const off = jrIpcAllowlist(profileFor('jr', DEFAULT_CONTROLS));
  assert.ok(off.has('tasks:list'));
  assert.ok(off.has('tasks:add'));
});

// Task 4 (games): games is on by default (DEFAULT_CONTROLS.games), so the
// move/score channels are reachable out of the box, and vanish the moment a
// parent switches games off — same shape as the tasks test above.
test('ipc allowlist: game channels follow the games flag (on by default)', () => {
  const on = jrIpcAllowlist(profileFor('jr', DEFAULT_CONTROLS));
  assert.ok(on.has('game:move'));
  assert.ok(on.has('game:score'));
  assert.ok(on.has('game:line'));
  const off = jrIpcAllowlist(profileFor('jr', { ...DEFAULT_CONTROLS, games: false }));
  assert.ok(!off.has('game:move'));
  assert.ok(!off.has('game:score'));
  assert.ok(!off.has('game:line'));
});

test('ipc allowlist: never-list channels are absent no matter what is switched on', () => {
  const allOn = jrIpcAllowlist(profileFor('jr', Object.fromEntries(Object.keys(DEFAULT_CONTROLS).map((k) => [k, true]))));
  const never = [
    'mobile:status', 'mobile:pair',
    'defense:zones',
    'schedule:list', 'schedule:add',
    'openai:save-key', 'anthropic:save-key',
    'nightshift:status',
    'update:open',
    'external:openai-keys', 'external:anthropic-keys', 'external:buy-pro',
    'backup:export', 'backup:import',
    'license:activate', 'license:deactivate',
    'transcript:reveal'
  ];
  for (const channel of never) {
    assert.ok(!allOn.has(channel), `${channel} must never be on the KID surface in jr`);
  }
});

test('the new feature sets follow their new checklist keys', () => {
  const off = jrIpcAllowlist(profileFor('jr', DEFAULT_CONTROLS));
  for (const c of ['defense:status', 'defense:enter', 'defense:exit', 'defense:wave-off', 'screen:drive-stop']) {
    assert.ok(!off.has(c), `${c} must be absent with the key off`);
  }
  const defenceOn = jrIpcAllowlist(profileFor('jr', { ...DEFAULT_CONTROLS, defense: true }));
  assert.ok(defenceOn.has('defense:status'));
  assert.ok(defenceOn.has('defense:wave-off'));
  // County-zone configuration is settings work, not kid work.
  assert.ok(!defenceOn.has('defense:zones'));
  const driveOn = jrIpcAllowlist(profileFor('jr', { ...DEFAULT_CONTROLS, screenDrive: true }));
  assert.ok(driveOn.has('screen:drive-stop'));
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
  // The multiplexer is GONE — the real camera-config channels are admin
  // surface now, reachable only while the parent session is unlocked.
  assert.ok(!on.has('jr:parent:cameras'));
  const off = jrIpcAllowlist(profileFor('jr', DEFAULT_CONTROLS));
  assert.ok(!off.has('jr:parent:cameras'));
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

// Task 9: module cards follow the profile. A module the checklist denies
// must have no card in JR and must never be re-showable from the layout UI —
// this is the pure, testable half of that guarantee. moduleAllowedInProfile
// is the single source of truth the renderer consults for both halves.
test('module cards follow the profile', () => {
  const off = profileFor('jr', DEFAULT_CONTROLS);
  assert.equal(moduleAllowedInProfile('tasks', off), true);
  assert.equal(moduleAllowedInProfile('cameras', off), false);
  assert.equal(moduleAllowedInProfile('file-explorer', off), false);
  assert.equal(moduleAllowedInProfile('night-shift', off), false);   // follows documents, off by default
  assert.equal(moduleAllowedInProfile('terminal', off), false);
  const filesOn = profileFor('jr', { ...DEFAULT_CONTROLS, files: true, cameras: true });
  assert.equal(moduleAllowedInProfile('file-explorer', filesOn), true);
  assert.equal(moduleAllowedInProfile('cameras', filesOn), true);
  assert.equal(moduleAllowedInProfile('anything', STANDARD_PROFILE), true);
});

// Risk 2 of the full-settings plan: nightShift is a parent SETTING now (the
// profile grants it), but the night-shift module card shows the night crew's
// document summaries — kid-visible content. So the CARD follows the kid's
// documents permission, not the parent's night-shift setting.
test('the night-shift card follows the kid documents key, not the parent night-shift setting', () => {
  const off = profileFor('jr', DEFAULT_CONTROLS);
  assert.equal(moduleAllowedInProfile('night-shift', off), false);
  const docsOn = profileFor('jr', { ...DEFAULT_CONTROLS, documents: true });
  assert.equal(moduleAllowedInProfile('night-shift', docsOn), true);
});

test('module cards follow the profile: the full src/index.html module map', () => {
  const off = profileFor('jr', DEFAULT_CONTROLS);
  // On by default under the checklist's base experience.
  assert.equal(moduleAllowedInProfile('tasks', off), true);
  // Harmless stats/notes cards ride along at every checklist setting.
  assert.equal(moduleAllowedInProfile('performance', off), true);
  assert.equal(moduleAllowedInProfile('memory', off), true);
  assert.equal(moduleAllowedInProfile('activity', off), true);
  // timers is on in the base experience (DEFAULT_CONTROLS), so its card
  // (quick-commands) is already allowed with no checklist changes.
  assert.equal(moduleAllowedInProfile('quick-commands', off), true); // -> timers
  // Reach-out features off by default.
  assert.equal(moduleAllowedInProfile('projects', off), false);       // -> files
  assert.equal(moduleAllowedInProfile('document-viewer', off), false); // -> documents
  assert.equal(moduleAllowedInProfile('browser', off), false);
  // Flipping the nearest checklist key changes the card's fate: timers off
  // takes quick-commands with it, and turning on files/documents/browser
  // turns on projects/document-viewer/browser respectively.
  const flipped = profileFor('jr', {
    ...DEFAULT_CONTROLS, timers: false, files: true, documents: true, browser: true
  });
  assert.equal(moduleAllowedInProfile('quick-commands', flipped), false);
  assert.equal(moduleAllowedInProfile('projects', flipped), true);
  assert.equal(moduleAllowedInProfile('document-viewer', flipped), true);
  assert.equal(moduleAllowedInProfile('browser', flipped), true);
  // Unknown module name under the content lock: deny by default, not
  // allow-by-accident — nobody should be able to smuggle a card past the
  // checklist just by giving it a name this map has never heard of.
  assert.equal(moduleAllowedInProfile('some-future-module', off), false);
  // Outside the lock, an unmapped name is not denied — standard has nothing
  // to withhold.
  assert.equal(moduleAllowedInProfile('some-future-module', STANDARD_PROFILE), true);
});

// The old ROLLUP-11 regex test died with the hand-mirror it guarded:
// CONTROL_LABELS now lives in core/variant.js next to CONTROL_KEYS, and
// test/variant.test.js asserts the two cover each other key for key.
void fs; void path; void CONTROL_KEYS;

// ---- Task 2 (full-settings plan): main.js wiring, pinned as source text ----
// main.js pulls in electron, so it cannot be required under node:test. These
// read it as text — the same seam test/ipc-contract.test.js checks — and pin
// the wiring facts that would otherwise be invisible until a manual run.
const MAIN = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const PRELOAD = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');

test('main.js: JR constructs the whole app — no service is profile-gated any more', () => {
  for (const flag of ['autonomy', 'documents', 'cameras', 'claudeBridge', 'screenRead',
                      'screenDrive', 'defense', 'schedules', 'nightShift', 'phone']) {
    assert.ok(!new RegExp(`PROFILE\\.${flag}\\s*\\?`).test(MAIN),
      `PROFILE.${flag} must no longer decide construction — the parent owns that now`);
  }
  assert.ok(!/if \(PROFILE\.cameras\)/.test(MAIN), 'the camera construction block must be unconditional');
});

test('main.js: the IPC gate is consulted per call, through the pure helper', () => {
  assert.ok(/jrChannelAllowed\(/.test(MAIN), 'the wrap must use the tested pure gate');
  assert.ok(/parentSession\.admit\(\)/.test(MAIN), 'the gate must be handed the session heartbeat');
  assert.ok(!/const ALLOWED = jrIpcAllowlist\(PROFILE\);/.test(MAIN),
    'the static boot-time allowlist Set is gone — it cannot be widened at runtime');
});

test('main.js: only a verified PIN opens the session; lock and status exist', () => {
  assert.ok(/parentSession\.unlock\(\)/.test(MAIN));
  assert.ok(/ipcMain\.handle\('jr:parent:lock'/.test(MAIN));
  assert.ok(/ipcMain\.handle\('jr:parent:session'/.test(MAIN));
  // Exactly one unlock call site, and it must be inside jr:parent:verify.
  assert.equal((MAIN.match(/parentSession\.unlock\(\)/g) || []).length, 1);
  const verify = MAIN.slice(MAIN.indexOf("ipcMain.handle('jr:parent:verify'"));
  assert.ok(verify.slice(0, 500).includes('parentSession.unlock()'));
});

test('main.js: settings:save is filtered by the session, not by the variant alone', () => {
  assert.ok(/jrSettingsPatch\(/.test(MAIN));
  assert.ok(!/JR \? filterJrSettingsPatch\(/.test(MAIN), 'the old unconditional JR filter is gone');
});

test('main.js: the camera multiplexer and the relaunch dance are both gone', () => {
  assert.ok(!/jr:parent:cameras/.test(MAIN));
  assert.ok(!/jrParentCameras/.test(PRELOAD));
  assert.ok(!/app\.relaunch\(\)/.test(MAIN), 'a checklist change hot-applies now');
  assert.ok(/function applyProfile\(/.test(MAIN));
  assert.ok(/router\.profile = PROFILE/.test(MAIN));
  assert.ok(/ai\.profile = PROFILE/.test(MAIN));
});

test('preload.js: the parent surface is lock/session/profile-events, no PIN plumbing', () => {
  assert.ok(/jrParentLock:/.test(PRELOAD));
  assert.ok(/jrParentSession:/.test(PRELOAD));
  assert.ok(/onJrProfile:/.test(PRELOAD));
});

// ---- JR's own voice engine ------------------------------------------------
// JR is a standalone product: it must never depend on the grown-up build being
// installed, or on that build's OPTIONAL ~500 MB engine download having been
// run. Borrowing hid the gap on any machine that happened to have the standard
// engine — a developer's PC — and produced a JR with no speech at all, and no
// stated reason, on the machines families actually install it on.
test('voice engine: JR uses its own engine when it has one', () => {
  const { resolveVoiceEngineRoot } = require('../core/variant');
  const has = (p) => p === 'JRROOT';
  assert.equal(resolveVoiceEngineRoot({ ownRoot: 'JRROOT', sharedRoot: 'STDROOT', hasEngine: has }), 'JRROOT');
});

test('voice engine: JR NEVER borrows the grown-up build engine, even when only that one exists', () => {
  const { resolveVoiceEngineRoot } = require('../core/variant');
  const has = (p) => p === 'STDROOT';
  // The old behaviour returned STDROOT here. That made JR silently dependent
  // on a second product; main.js now installs an engine into JR's own root.
  assert.equal(resolveVoiceEngineRoot({ ownRoot: 'JRROOT', sharedRoot: 'STDROOT', hasEngine: has }), 'JRROOT');
});

test('voice engine: with neither installed it stays on its OWN root, so Repair installs locally', () => {
  const { resolveVoiceEngineRoot } = require('../core/variant');
  assert.equal(resolveVoiceEngineRoot({ ownRoot: 'JRROOT', sharedRoot: 'STDROOT', hasEngine: () => false }), 'JRROOT');
});

test('voice engine: own root always wins — a shared engine never overrides a local one', () => {
  const { resolveVoiceEngineRoot } = require('../core/variant');
  assert.equal(resolveVoiceEngineRoot({ ownRoot: 'JRROOT', sharedRoot: 'STDROOT', hasEngine: () => true }), 'JRROOT');
  // No shared root offered (the standard build): own root, always.
  assert.equal(resolveVoiceEngineRoot({ ownRoot: 'OWN', sharedRoot: null, hasEngine: () => false }), 'OWN');
});

test('voice engine: the shared root points at the grown-up build voice folder', () => {
  const { standardVoiceRoot } = require('../core/variant');
  const p = standardVoiceRoot('C:\Users\kid\AppData\Roaming');
  assert.match(p, /jarvis-local-assistant/);
  assert.match(p, /voice$/);
});
