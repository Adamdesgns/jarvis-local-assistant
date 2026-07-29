// Dual export, same pattern as src/orbs/orb-engine.js: node (main.js, the
// test suite) requires this file via module.exports; the renderer loads it
// as a classic <script> (src/index.html, before renderer.js) and reads
// window.JrVariant. The renderer only ever needs the pure, data-only pieces
// (moduleAllowedInProfile, STANDARD_PROFILE, PROFILE shape) — jrUserDataPath
// touches node:path and is never called from there, so `require` itself is
// guarded rather than assumed: real in Node, undefined in a browser window.
(function () {
'use strict';

const path = typeof require === 'function' ? require('node:path') : null;

// Which PRODUCT VARIANT this build is: 'standard' (the JARVIS that has always
// shipped) or 'jr' (JARVIS JR — the parental-controls build for kids, spec:
// docs/superpowers/specs/2026-07-28-jarvis-jr-design.md).
//
// This is a DIFFERENT AXIS from core/edition.js (master/retail), which decides
// licensing view and the naming prompt. The variant decides WHAT GETS BUILT:
// main.js constructs only what profileFor() names, so an off feature has no
// instance to reach — the JUNIOR principle, applied per feature.
//
// Stamped at build time (electron-builder --config.extraMetadata.jarvisVariant=jr)
// and forced with JARVIS_VARIANT=jr for `npm run start:jr`. Unknown values
// resolve to 'standard' — but standard is the FULL build, so main.js must only
// ever trust a stamp read from the packaged app's own resources, never from
// settings. (A kid cannot stamp a build; a kid can edit a JSON file.)

const VARIANTS = Object.freeze(['standard', 'jr']);

// The parent checklist, in panel display order. Every key is a real
// capability, decided ONLY in the PIN-locked panel.
const CONTROL_KEYS = Object.freeze([
  // The base experience — on by default; a parent may still switch any off.
  'games', 'battle', 'quips', 'homework', 'tasks', 'timers',
  // Reach-out features — off until a parent turns them on.
  'cameras', 'documents', 'files', 'apps', 'browser', 'terminal', 'screenRead', 'power'
]);

const DEFAULT_CONTROLS = Object.freeze({
  games: true, battle: true, quips: true, homework: true, tasks: true, timers: true,
  cameras: false, documents: false, files: false, apps: false,
  browser: false, terminal: false, screenRead: false, power: false
});

function resolveVariant(context) {
  const stamped = String(context?.stamped || context?.env || '').trim().toLowerCase();
  return stamped === 'jr' ? 'jr' : 'standard';
}

function isJr(variant) {
  return variant === 'jr';
}

// Unknown keys dropped, values coerced to boolean, missing keys defaulted —
// so a mangled or hostile controls object can never smuggle a capability.
function normalizeControls(raw) {
  const out = {};
  for (const key of CONTROL_KEYS) {
    out[key] = Object.prototype.hasOwnProperty.call(raw || {}, key)
      ? Boolean(raw[key])
      : DEFAULT_CONTROLS[key];
  }
  return out;
}

// The standard profile: everything JR gates, granted. main.js's existing
// seams (settings toggles, license gate) still apply downstream — this
// profile only says the variant does not withhold anything.
const STANDARD_PROFILE = Object.freeze({
  variant: 'standard',
  productName: 'JARVIS',
  contentLock: false,
  games: true, battle: true, quips: true, homework: true, tasks: true, timers: true,
  cameras: true, documents: true, files: true, apps: true,
  browser: true, terminal: true, screenRead: true, power: true,
  cameraConfig: true, screenDrive: true, claudeBridge: true,
  nightShift: true, schedules: true, autonomy: true, phone: true, defense: true
});

// The capability profile main.js builds from. A pure function and an
// ALLOWLIST. In jr, the trailing block is the spine of the build: never
// constructed at ANY checklist setting — wanting these is what the adult
// JARVIS is for.
function profileFor(variant, controls) {
  if (!isJr(variant)) return { ...STANDARD_PROFILE };
  const on = normalizeControls(controls);
  return {
    variant: 'jr',
    productName: 'JARVIS JR',
    contentLock: true,   // no control key reaches this — see the tests
    ...on,
    cameraConfig: false,
    screenDrive: false,
    claudeBridge: false,
    nightShift: false,
    schedules: false,
    autonomy: false,
    phone: false,
    defense: false
  };
}

// JR's userData folder, kept separate from the grown-up build's — DEV MODE
// INCLUDED. This is the fix for the JUNIOR dev-mode leak found 2026-07-28:
// running the jr variant unpackaged used to still write into
// jarvis-local-assistant's own userData because the repoint only fired for
// packaged builds. A kid's settings/secrets/logs must never land in the
// grown-up folder, in dev or in prod, so main.js calls this unconditionally
// whenever isJr(VARIANT) is true, before any service reads app.getPath
// ('userData').
function jrUserDataPath(appDataDir) {
  return path.join(String(appDataDir || ''), 'jarvis-jr');
}

// Base channels: reachable in JR at every checklist setting. None of these
// grant a capability the parent checklist gates — they are the app's own
// pulse (bootstrap, the command loop, voice in/out, memory, cosmetic
// window/orb chrome) or a channel whose handler already refuses/no-ops on
// its own. Real channel names, taken from main.js's ipcMain.handle/on calls.
const BASE_IPC = Object.freeze([
  // Core loop
  'bootstrap', 'telemetry', 'onboarding:name', 'onboarding:heard', 'command:submit',
  'transcript:read', 'approval:resolve', 'activity:recent',
  // Voice in/out
  'tts:speak', 'tts:voices', 'tts:status',
  'voice:transcribe', 'voice:status', 'voice:diagnose', 'voice:setup', 'voice:restart',
  // Local AI backend status/connect — no key entry, no billing, local only
  'ollama:connect', 'ollama:status',
  // The assistant's own notes (not a checklist-gated "reach out" feature)
  'memory:list', 'memory:add', 'memory:update', 'memory:remove',
  // Renderer-reachable settings surface. ConfigStore.updateSettings has its
  // OWN allowlist (core/config-store.js) and parental state (PIN, birthdate,
  // controls) lives in the separate 'jrParent' secret, never in settings.json
  // — a kid cannot write controls through this channel. Some settings keys
  // this allowlist still admits DO widen capability if a kid can reach them
  // (searchRoots, cameraAccounts, screenControlEnabled, autonomyRules, etc.)
  // — see task-6-report.md, "Settings keys a JR kid can still write", for the
  // full list. Not redesigned here; flagged for review adjudication.
  'settings:save', 'orb:prefs', 'update:check',
  'clipboard:read', 'clipboard:write',
  // Window chrome / orb widget — cosmetic, no capability
  'ai:cancel', 'widget:show', 'widget:restore', 'widget:drag-start', 'widget:drag-move',
  'widget:drag-end', 'widget:resize', 'widget:zoom-abort', 'ui:state', 'ui:skin',
  'window:control',
  // Registered before app.whenReady (module load), so it is never actually
  // routed through the wrapped ipcMain.on below — listed anyway so this set
  // documents the full reachable surface.
  'crash:renderer-error'
]);

// Per-feature channel sets, keyed to the same flags profileFor() puts on
// PROFILE. A set is admitted only when its flag is on. Kept out of BASE_IPC
// on purpose — when a control is off, main.js never constructs the service
// behind it, so the handler would throw/reach a null; the allowlist keeps
// the renderer from even reaching that handler.
const FEATURE_IPC = Object.freeze({
  // View-only: listing what is already configured, snapshotting, and
  // watching a live stream. Every channel that ADDS/REMOVES an account or
  // ARMS/DISARMS a system is deliberately absent — see the "never admitted"
  // list below. Those are parental territory, same family as the jrParent
  // secret itself, and are reachable only through the PIN-gated
  // jr:parent:cameras channel (JR_IPC, below).
  cameras: [
    'cameras:bootstrap', 'cameras:systems', 'cameras:list', 'cameras:snapshot',
    'cameras:describe', 'cameras:live-start', 'cameras:live-stop', 'cameras:live-answer',
    'cameras:discover'
  ],
  terminal: ['terminal:classify', 'terminal:run', 'terminal:cwd'],
  screenRead: ['screen:describe'],
  files: ['files:roots', 'files:home', 'files:list', 'path:open', 'dialog:folder'],
  tasks: ['tasks:list', 'tasks:add', 'tasks:update', 'tasks:remove'],
  // The board's moves and the scoreboard. Gated on 'games' like every other
  // FEATURE_IPC set — main.js constructs GameScores unconditionally (it is
  // harmless in the standard build, same as MemoryStore/TaskStore), so this
  // is the only place "games off" actually withholds anything in JR: the
  // router's own branch (core/router.js) never calls detectGame either.
  games: ['game:move', 'game:score']
  // documents/apps/browser/power gate no dedicated IPC channel today — they
  // run through command:submit, gated inside CommandRouter (Task 5) instead.
  // timers has no IPC surface yet in main.js. Nothing to list here until one
  // ships; add it to this set (not BASE_IPC) when it does.
});

// The parent-lock surface (Task 8's setup gate, this task's IPC channels).
// Registered unconditionally by main.js — each handler itself returns
// {ok:false} when !JR — but only ADMITTED into the allowlist here. Every
// jr:parent:* mutation still demands the PIN in the same call; the renderer
// never holds an unlocked session token.
const JR_IPC = Object.freeze([
  'jr:status', 'jr:setup:complete', 'jr:parent:verify', 'jr:parent:controls', 'jr:parent:pin',
  // Camera CONFIG's one doorway: {pin, action, payload}. main.js verifies the
  // PIN first (same PinGate lockout as every other jr:parent:* mutation),
  // then dispatches `action` to the same CameraService methods the standard
  // build's cameras:add-blink/add-ring/add-nest/add-rtsp/remove-account/
  // set-armed/blink-pin channels call directly — no separate credential path.
  'jr:parent:cameras'
]);

// NEVER admitted, at any checklist setting — deliberately left OUT of every
// set above rather than subtracted here, so there is nothing to bypass. This
// list exists only so a reviewer can see the reasoning in one place:
//   transcript:reveal                                  — opens raw Explorer
//   mobile:status/devices/revoke/pair                  — phone is always off in jr (profileFor)
//   schedule:list/add/update/remove/runNow             — schedules is always off in jr
//   openai:save-key/remove-key/test                    — cloud API key entry + billing
//   anthropic:save-key/remove-key/test                 — cloud API key entry + billing
//   nightshift:status                                  — nightShift is always off in jr
//   update:open                                        — shell.openExternal(renderer-supplied url)
//   external:ollama/openai-billing/openai-keys/         — arbitrary external-browser opens,
//     anthropic-keys/nest-console/buy-pro                 account/billing pages
//   backup:export/import                               — native OS file dialogs, bypasses
//                                                          approved-roots entirely
//   license:status/activate/validate/deactivate         — purchase/license management
//   defense:status/enter/exit/wave-off/zones            — defense is always off in jr
//   screen:drive-stop                                   — screenDrive is always off in jr
//   cameras:add-blink/blink-pin/add-ring/add-nest/       — camera CONFIG: account credentials
//     add-rtsp/remove-account/set-armed                    and arm/disarm. Never admitted under
//                                                          their own names, cameras on or off —
//                                                          reachable only through the PIN-gated
//                                                          jr:parent:cameras multiplexer (JR_IPC).

function jrIpcAllowlist(profile) {
  const allowed = new Set([...BASE_IPC, ...JR_IPC]);
  for (const [flag, channels] of Object.entries(FEATURE_IPC)) {
    if (profile && profile[flag]) {
      for (const channel of channels) allowed.add(channel);
    }
  }
  return allowed;
}

// settings:save's own ConfigStore.updateSettings allowlist (core/config-store.js)
// was written for a single-variant app: it happily writes searchRoots,
// routines, cameraAccounts, screenControlEnabled, autonomyRules, and more —
// every one of them capability-adjacent state that belongs to the PIN-locked
// parent checklist, not to a renderer-reachable channel a kid's UI can call
// freely (see task-6-report.md, "Settings keys a JR kid can still write").
// JR_SETTINGS_ALLOW is the narrower list main.js filters every JR
// settings:save patch through — cosmetic/voice state only. Everything else is
// silently dropped: the parent panel's PIN-gated channels are the only route
// to anything that widens what JR can do.
const JR_SETTINGS_ALLOW = Object.freeze([
  'skin', 'orbSkin', 'orbColor', 'windowGlass', 'motionMode', 'moduleLayout',
  'hiddenModules', 'orbBounds', 'voiceName', 'voiceEnabled', 'localVoiceEnabled',
  'localVoiceModel', 'wakeWordEnabled', 'wakeSensitivity', 'ttsEngine',
  'kokoroVoice', 'kokoroDevice', 'minimizeToOrb'
]);

// Pure and side-effect-free so it is trivial to test on its own: keeps only
// the allowed keys actually present in the patch, drops everything else.
function filterJrSettingsPatch(patch) {
  const out = {};
  for (const key of JR_SETTINGS_ALLOW) {
    if (Object.prototype.hasOwnProperty.call(patch || {}, key)) out[key] = patch[key];
  }
  return out;
}

// Module cards (src/index.html's data-module names) -> the profile flag that
// gates them. 'true' means the card is harmless at every checklist setting
// (stats/notes displays with no reach-out capability behind them) — it rides
// along without a dedicated checklist key. Real names, taken straight off
// src/index.html's <article data-module="..."> list; 'command' (the docked
// input bar, not a module card) is deliberately absent — it is never gated,
// see src/renderer.js.
const MODULE_PROFILE_KEY = Object.freeze({
  tasks: 'tasks',
  'file-explorer': 'files',
  'night-shift': 'nightShift',
  terminal: 'terminal',
  cameras: 'cameras',
  browser: 'browser',
  'document-viewer': 'documents',
  'quick-commands': 'timers',
  projects: 'files',
  performance: true,
  memory: true,
  activity: true
});

// Whether a module's card may exist at all, given the profile main.js built
// (the same PROFILE the renderer already receives via jr:status). Outside
// the content lock (standard, or any profile that doesn't declare one) this
// withholds nothing — profileFor('standard', ...) already grants everything.
// Under the lock, a module name this map has never heard of is deny-by-
// default, not allow-by-accident: a future module that forgets to add itself
// here should fail closed, the same JUNIOR principle profileFor() itself
// runs on.
function moduleAllowedInProfile(moduleName, profile) {
  if (!profile || !profile.contentLock) return true;
  const key = MODULE_PROFILE_KEY[moduleName];
  if (key === true) return true;
  if (key === undefined) return false;
  return Boolean(profile[key]);
}

const api = {
  VARIANTS, CONTROL_KEYS, DEFAULT_CONTROLS, STANDARD_PROFILE,
  resolveVariant, isJr, normalizeControls, profileFor,
  jrUserDataPath, jrIpcAllowlist, JR_SETTINGS_ALLOW, filterJrSettingsPatch,
  MODULE_PROFILE_KEY, moduleAllowedInProfile
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.JrVariant = api;
})();
