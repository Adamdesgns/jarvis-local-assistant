'use strict';

// JARVIS Pro — the license gate. Pure policy in the screen-guard mold: the
// rules live here in code, main.js consults them at the enforcement seams,
// and the Settings UI is only ever a mirror, never the lock itself.
//
// The gate reads settings.license.status — persisted locally — not the key.
// That is deliberate: once activated, JARVIS stays licensed fully offline,
// and a later safeStorage hiccup can never brick a paid feature. The flip
// side is that a hand-edited settings.json can forge "active". Accepted by
// design: the gate exists to make the product honest for honest people, not
// to win a DRM arms race. Do not "fix" this by phoning home — the app's
// privacy promise (no network calls the user didn't ask for) outranks it.

const PRO_FEATURES = Object.freeze([
  Object.freeze({ id: 'camera', label: 'Cameras', key: 'cameraAccounts', kind: 'accounts' }),
  Object.freeze({ id: 'mobile', label: 'Phone companion', key: 'mobileEnabled', kind: 'flag' }),
  Object.freeze({ id: 'schedules', label: 'Scheduled tasks', key: 'schedulesEnabled', kind: 'flag' }),
  Object.freeze({ id: 'autonomy', label: 'Autonomy', key: 'autonomyEnabled', kind: 'flag' }),
  Object.freeze({ id: 'screenRead', label: 'Screen reading', key: 'screenControlEnabled', kind: 'flag' }),
  Object.freeze({ id: 'screenDrive', label: 'Screen driving', key: 'screenDriveEnabled', kind: 'flag' }),
  Object.freeze({ id: 'nightShift', label: 'Night shift', key: 'nightShiftEnabled', kind: 'flag' })
]);

const PRO_FLAG_KEYS = Object.freeze(
  PRO_FEATURES.filter((feature) => feature.kind === 'flag').map((feature) => feature.key)
);

function isPro(licenseState) {
  return Boolean(licenseState) && licenseState.status === 'active';
}

// Gate a settings patch before it is applied. Licensed: everything passes.
// Unlicensed: a flag flipping false→true is stripped and reported so the UI
// can explain; disables and already-true flags always pass (an unlicensed
// user must always be able to turn things OFF, and the v8 migration promised
// to leave previously saved flags in the file untouched — the runtime seams
// are what refuse them).
function gateSettingsPatch(previous, patch, licenseState) {
  if (isPro(licenseState)) return { patch, refused: [] };
  const gated = { ...patch };
  const refused = [];
  for (const feature of PRO_FEATURES) {
    if (feature.kind !== 'flag') continue;
    if (gated[feature.key] === true && previous?.[feature.key] !== true) {
      delete gated[feature.key];
      refused.push({ id: feature.id, label: feature.label });
    }
  }
  return { patch: gated, refused };
}

// A read-only view of settings for services: licensed = the settings as they
// are; unlicensed = a clone with every Pro flag forced false. The license can
// narrow settings but never widen them. Never persist this view.
//
// cameraAccounts is deliberately NOT blanked: CameraService read-modify-writes
// that array, so a gated empty read would destroy saved camera accounts on the
// next write. Cameras are gated at their init/IPC seams in main.js instead.
function applyLicenseToSettings(settings, licenseState) {
  if (isPro(licenseState)) return settings;
  const view = { ...settings };
  for (const key of PRO_FLAG_KEYS) view[key] = false;
  return view;
}

function featureAllowed(featureId, settings, licenseState) {
  const feature = PRO_FEATURES.find((item) => item.id === featureId);
  if (!feature) return true; // not a Pro feature — free tier
  if (!isPro(licenseState)) return false;
  if (feature.kind === 'accounts') return true;
  return settings?.[feature.key] === true;
}

module.exports = { PRO_FEATURES, PRO_FLAG_KEYS, isPro, gateSettingsPatch, applyLicenseToSettings, featureAllowed };
