'use strict';

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

module.exports = {
  VARIANTS, CONTROL_KEYS, DEFAULT_CONTROLS, STANDARD_PROFILE,
  resolveVariant, isJr, normalizeControls, profileFor
};
