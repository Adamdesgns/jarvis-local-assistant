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

// The parent checklist, in display order: what the KID can reach. Every key
// is a real capability with a kid-facing surface (a router branch, a module
// card, or an IPC set), decided ONLY behind the parent PIN. Grown-up-only
// machinery (night shift, schedules, autonomy, the phone bridge) is NOT here
// — those have no kid-facing surface, so they are ordinary settings the
// parent flips in the real settings dialog, like the standard build.
const CONTROL_KEYS = Object.freeze([
  // The base experience — on by default; a parent may still switch any off.
  'games', 'battle', 'quips', 'homework', 'tasks', 'timers',
  // Reach-out features — off until a parent turns them on. gameCamera is
  // "the webcam watches the kid's hand during rock paper scissors" and is
  // deliberately its OWN key, not a rider on 'cameras': that key means "the
  // kid may view the household cameras", and conflating the two would let
  // one checkbox silently mean both.
  'cameras', 'gameCamera', 'documents', 'files', 'apps', 'browser', 'terminal', 'screenRead', 'power',
  // Family calls: dialing and answering the ONE paired PC (Dad's). On by
  // default because the parent opt-in already happened at pairing time — the
  // pair/unpair channels themselves are admin-only, so an unpaired JR has no
  // line no matter what this says. Its own key for the same reason gameCamera
  // is: "may use the webcam to call Dad" must never ride on "may view the
  // household cameras".
  'calls',
  // Grown-up-power features a parent may hand down. All default off.
  'claudeBridge', 'screenDrive', 'defense'
]);

// The single source of display copy for the checklist. The renderer reads it
// off window.JrVariant (this file is a classic <script> in index.html), so
// the old hand-maintained mirror in jr-parent-ui.js is gone for good.
const CONTROL_LABELS = Object.freeze({
  games: 'Games',
  battle: 'Battle mode',
  quips: 'Jokes & quips',
  homework: 'Homework hints',
  tasks: 'Tasks',
  timers: 'Timers',
  cameras: 'Cameras (view only)',
  gameCamera: 'Rock paper scissors camera (webcam reads their hand, on this PC only)',
  documents: 'Documents — read & summarize',
  files: 'File search (their own folder)',
  apps: 'Open apps (parent allowlist)',
  browser: 'The browser',
  terminal: 'The terminal',
  screenRead: 'Screen reading',
  power: 'Power (restart/shutdown)',
  calls: 'Family calls (call Dad & answer Dad — the paired PC only)',
  claudeBridge: 'Ask Claude (cloud AI — costs money)',
  screenDrive: 'Let JARVIS click and type on the PC',
  defense: 'Defense mode'
});

const DEFAULT_CONTROLS = Object.freeze({
  games: true, battle: true, quips: true, homework: true, tasks: true, timers: true,
  cameras: false, gameCamera: false, documents: false, files: false, apps: false,
  browser: false, terminal: false, screenRead: false, power: false, calls: true,
  claudeBridge: false, screenDrive: false, defense: false
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
  cameras: true, gameCamera: true, documents: true, files: true, apps: true,
  browser: true, terminal: true, screenRead: true, power: true, calls: true,
  screenDrive: true, claudeBridge: true, defense: true,
  nightShift: true, schedules: true, autonomy: true, phone: true
});

// The capability profile: what the KID can reach — and nothing else. JR
// constructs exactly what the standard build constructs (main.js gates no
// service on this any more); the parent's PIN session decides which IPC
// channels are reachable beyond the kid surface. The never-block is down to
// ONE entry: the content lock, which has no off switch at any setting.
// nightShift/schedules/autonomy/phone are granted true — the variant
// withholds nothing from the PARENT; those four are ordinary settings with
// no kid-facing surface (no router branch, no kid channel set).
function profileFor(variant, controls) {
  if (!isJr(variant)) return { ...STANDARD_PROFILE };
  const on = normalizeControls(controls);
  return {
    variant: 'jr',
    productName: 'JARVIS JR',
    ...on,
    // AFTER the spread, so a hostile/malformed controls object carrying its
    // own contentLock key is structurally overwritten — not merely dropped
    // because normalizeControls happens to ignore unknown keys today.
    contentLock: true,
    nightShift: true,
    schedules: true,
    autonomy: true,
    phone: true
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

// The grown-up build's voice folder. Kept ONLY so a machine that already has
// the standard build can be recognised — JR no longer runs anything out of it.
// See resolveVoiceEngineRoot below for why the borrowing was removed.
function standardVoiceRoot(appDataDir) {
  return path.join(String(appDataDir || ''), 'jarvis-local-assistant', 'voice');
}

// Which folder holds the python interpreter JR should RUN: ALWAYS its own.
//
// JR used to borrow the grown-up build's engine when it had none of its own,
// to save a second ~500 MB download. That optimisation made JR silently
// dependent on a second product being installed: on a PC with no standard
// JARVIS there was nothing to borrow and nothing of its own, so JR came up
// with no speech at all and no way for the user to tell why. It looked fine on
// any machine that happened to have the grown-up build — which is exactly the
// machine a developer tests on, and never the machine a family installs on.
//
// JR is a standalone product and must be 100% self-sufficient. It resolves to
// its own root unconditionally; when that root has no engine, main.js installs
// one there (runLocalVoiceSetup already targets voiceDataRoot). sharedRoot and
// hasEngine are still accepted so callers need not change, but neither can
// route JR at another product's runtime.
function resolveVoiceEngineRoot({ ownRoot } = {}) {
  return ownRoot;
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
  // — a kid cannot write controls through this channel. ConfigStore's own
  // allowlist was written for a single-variant app, so it still admits keys
  // that WOULD widen capability in a kid's hands (searchRoots, cameraAccounts,
  // screenControlEnabled, autonomyRules, routines, aiMode). Admitting the
  // channel here is therefore not the whole story: in JR every patch is first
  // narrowed to JR_SETTINGS_ALLOW by filterJrSettingsPatch (below, and applied
  // at the top of main.js's settings:save handler), which keeps cosmetic and
  // voice state only and silently drops the rest.
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
  // game:rps-outcome/camera-failed/expired belong to the voice RPS round —
  // outcome fails closed in the router (no session or no locked throw =
  // nothing judged), so the widest thing this admits is telling the router
  // a shape it then compares against an already-locked throw.
  games: ['game:move', 'game:score', 'game:line', 'game:rps-outcome', 'game:rps-camera-failed', 'game:rps-expired'],
  // The grown-up-power checklist keys. defense:zones stays OUT — county
  // configuration is settings work, admin surface only.
  defense: ['defense:status', 'defense:enter', 'defense:exit', 'defense:wave-off'],
  screenDrive: ['screen:drive-stop'],
  // Family calls: the kid may check the line, dial Dad, answer, and hang up.
  // call:pair-start / call:pair-claim / call:unpair are deliberately absent —
  // choosing WHO this PC is bound to is parental territory (see the "never
  // admitted" list below), so they stay admin-only behind the PIN session.
  calls: ['call:status', 'call:ping', 'call:dial', 'call:answer', 'call:ice', 'call:hangup']
  // documents/apps/browser/power/claudeBridge gate no dedicated IPC channel
  // today — they run through command:submit, gated inside CommandRouter.
  // timers has no IPC surface yet in main.js. Nothing to list here until one
  // ships; add it to this set (not BASE_IPC) when it does.
});

// The parent-lock surface a KID may reach: the setup gate, the PIN prompt,
// and the session's own read/close. jr:parent:controls and jr:parent:pin are
// deliberately NOT here any more — they are admin channels, reachable only
// while the parent session is unlocked, so a kid cannot even reach the
// handler that edits his checklist. jr:parent:cameras is gone entirely: the
// real cameras:add-* channels are the admin surface now.
const JR_IPC = Object.freeze([
  'jr:status', 'jr:setup:complete', 'jr:parent:verify', 'jr:parent:lock', 'jr:parent:session'
]);

// NOT on the KID surface — reachable only while the parent session is
// unlocked (the call-time gate in main.js consults ParentSession.admit() for
// any channel outside jrIpcAllowlist). Deliberately left OUT of every set
// above rather than subtracted, so there is nothing to bypass:
//   transcript:reveal, backup:export/import              — raw disk surface
//   mobile:*, schedule:*, nightshift:status              — grown-up machinery
//   openai:*/anthropic:* key channels, external:*        — money and accounts
//   license:*                                            — purchase management
//   update:open                                          — shell.openExternal
//   defense:zones                                        — county configuration
//   cameras:add-blink/blink-pin/add-ring/add-nest/       — camera CONFIG:
//     add-rtsp/remove-account/set-armed                     credentials + arming
//   call:pair-start, call:pair-claim, call:unpair        — who this PC is bound to
//   jr:parent:controls, jr:parent:pin                    — the checklist and PIN

// The KID surface for a given profile. What this Set does NOT contain is not
// dead any more — it is the admin surface, opened per call by the parent
// session (see jrChannelAllowed below).
function jrIpcAllowlist(profile) {
  const allowed = new Set([...BASE_IPC, ...JR_IPC]);
  for (const [flag, channels] of Object.entries(FEATURE_IPC)) {
    if (profile && profile[flag]) {
      for (const channel of channels) allowed.add(channel);
    }
  }
  return allowed;
}

// The JR IPC gate, as a pure decision. Kid channels short-circuit BEFORE the
// session is consulted — admitParent() is the idle-timer heartbeat, and a kid
// playing tic-tac-toe must not keep a parent's settings session alive. Called
// per invocation (not per registration), which is the whole reason an expired
// unlock re-blocks without any timer to fire.
function jrChannelAllowed(channel, kidAllowlist, admitParent) {
  if (kidAllowlist && kidAllowlist.has(channel)) return true;
  return typeof admitParent === 'function' ? Boolean(admitParent()) : Boolean(admitParent);
}

// settings:save's own gate. A locked JR renderer writes cosmetics and nothing
// else, exactly as before; an unlocked one is a parent at the real settings
// dialog, so the patch goes through untouched and ConfigStore's own allowlist
// (core/config-store.js) is the only filter left, same as the standard build.
function jrSettingsPatch(patch, { jr, unlocked } = {}) {
  if (!jr || unlocked) return patch || {};
  return filterJrSettingsPatch(patch || {});
}

// settings:save's own ConfigStore.updateSettings allowlist (core/config-store.js)
// was written for a single-variant app: it happily writes searchRoots,
// routines, cameraAccounts, screenControlEnabled, autonomyRules, aiMode and
// more — every one of them capability-adjacent state that belongs to the
// PIN-locked parent checklist, not to a renderer-reachable channel a kid's UI
// can call freely. That list is the reason this narrower one exists; it is
// enumerated in core/config-store.js's own allowlist, which is the live
// source of truth rather than a doc that can drift away from it.
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
  // The night-shift CARD shows the night crew's document summaries —
  // kid-visible content — so it follows the kid's documents permission, not
  // the parent's nightShift setting (which the jr profile now always grants).
  'night-shift': 'documents',
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
  VARIANTS, CONTROL_KEYS, CONTROL_LABELS, DEFAULT_CONTROLS, STANDARD_PROFILE,
  resolveVariant, isJr, normalizeControls, profileFor,
  jrUserDataPath, standardVoiceRoot, resolveVoiceEngineRoot,
  jrIpcAllowlist, jrChannelAllowed, jrSettingsPatch,
  JR_IPC, FEATURE_IPC, JR_SETTINGS_ALLOW, filterJrSettingsPatch,
  MODULE_PROFILE_KEY, moduleAllowedInProfile
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.JrVariant = api;
})();
