'use strict';

// K.O.R.I. — the edition split. Two artefacts from one tree:
//
//   master — Adam's personal copy. No naming prompt, no licence gate, full
//            Pro. Unsigned, never distributed. The assistant is JARVIS,
//            forever — that's his name, not the product's.
//   retail — what a buyer installs. Names the assistant on first run
//            (core/onboarding.js), and the Pro gate is real.
//
// THE LOAD-BEARING PROPERTY: the edition is decided at BUILD time — a stamp
// electron-builder bakes into the packaged app — never by a setting. A
// settings toggle would make the paywall decorative: anyone could flip it.
// Pure policy in the license-gate.js mold; main.js consults it at the seams.
//
// Fail-closed direction: a PACKAGED build with no stamp (or a mangled one) is
// RETAIL. If the build script breaks, the failure mode is a buyer copy that
// asks for a licence — annoying, visible, fixable — never a free full-Pro
// build quietly handed to everyone. Running unpackaged from source is master,
// because gating a developer who already has the code protects nothing.

const EDITIONS = Object.freeze(['master', 'retail']);

// The one licence state master ever reports. Frozen: nothing downstream may
// decorate it, because it never persists — see effectiveLicenseState.
const MASTER_LICENSE = Object.freeze({
  status: 'active',
  productName: 'KORI Master',
  customerName: 'Master build',
  activatedAt: '',
  instanceId: 'master-build',
  lastValidatedAt: ''
});

// packaged: app.isPackaged from Electron. stamped: the build-time stamp, read
// from the packaged app's own resources (see main.js) — NOT from settings.
//
// packaged must be EXPLICITLY false to mean "running from source". A caller
// that passes nothing hasn't told us anything, and not knowing must land on
// retail — ignorance is not a licence.
function resolveEdition(context) {
  if (context?.packaged === false) return 'master';
  if (context?.packaged !== true) return 'retail';
  return String(context.stamped || '').trim().toLowerCase() === 'master' ? 'master' : 'retail';
}

function isMaster(edition) {
  return edition === 'master';
}

// Anything that isn't explicitly master is retail — same direction as
// resolveEdition, so an unrecognised value can never widen access.
function isRetail(edition) {
  return !isMaster(edition);
}

// What the licence seams should treat as the current state. Master is always
// Pro regardless of settings.json; retail passes the stored state through
// untouched. NEVER persist the master view — settings.json must keep the real
// state so a copied file can't seed "active" into a retail install.
function effectiveLicenseState(edition, storedState) {
  if (isMaster(edition)) return MASTER_LICENSE;
  return storedState;
}

// The name he answers to before anyone chooses one. Master is JARVIS —
// Adam's call, permanent. Retail defaults to the product name until the buyer
// names him on first run.
function defaultAssistantName(edition) {
  return isMaster(edition) ? 'JARVIS' : 'Kori';
}

module.exports = {
  EDITIONS,
  MASTER_LICENSE,
  resolveEdition,
  isMaster,
  isRetail,
  effectiveLicenseState,
  defaultAssistantName,
};
