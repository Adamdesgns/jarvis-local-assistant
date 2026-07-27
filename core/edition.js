'use strict';

// The edition split. Three artefacts from one tree:
//
//   master — Adam's personal copy. No naming prompt. Unsigned, never
//            distributed. The assistant is JARVIS, forever — that's his
//            name, not the product's.
//   retail — what anyone else installs. Names the assistant on first run
//            (core/onboarding.js).
//   kids   — JARVIS Jr., the children's build. A separate download with its
//            own installer and its own settings folder. Everything the kids
//            edition takes AWAY (cameras, defense mode, night shift,
//            autonomy, phone companion, Claude bridge) and everything it
//            ADDS (parent PIN, screen-time limits, the content filter, the
//            gaming-coach brain) is policy in core/kids-mode.js and
//            core/parental-controls.js — this module only names the split.
//
// Since 2026-07-26 the product is COMPLETELY FREE — both editions report an
// active licence (see effectiveLicenseState), so the split now only decides
// the naming prompt. The edition is still stamped at BUILD time, and the
// licence-gate machinery underneath is kept intact and dormant, because the
// business is paid CUSTOM CLIENT BUILDS — a future paid artefact re-arms the
// gate by changing effectiveLicenseState, not by rebuilding the plumbing.
// Pure policy in the license-gate.js mold; main.js consults it at the seams.
//
// Unstamped/mangled packaged builds still resolve to retail — that direction
// now only costs a naming prompt, and keeping it means the paid-era tests and
// reasoning stay true if the gate ever re-arms.

const EDITIONS = Object.freeze(['master', 'retail', 'kids']);

// The one licence state master ever reports. Frozen: nothing downstream may
// decorate it, because it never persists — see effectiveLicenseState.
const MASTER_LICENSE = Object.freeze({
  status: 'active',
  productName: 'Master build',
  customerName: 'Master build',
  activatedAt: '',
  instanceId: 'master-build',
  lastValidatedAt: ''
});

// What every other build reports. JARVIS is completely free (Adam,
// 2026-07-26) — it's the demo of what he builds for customers; the paid
// product is custom client builds. Same rules as the master view: frozen,
// never persisted. The gate machinery underneath stays intact so a future
// paid client build re-arms by changing effectiveLicenseState alone.
const FREE_LICENSE = Object.freeze({
  status: 'active',
  productName: 'Free for everyone',
  customerName: '',
  activatedAt: '',
  instanceId: 'free-build',
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
  const stamped = String(context.stamped || '').trim().toLowerCase();
  if (stamped === 'master') return 'master';
  if (stamped === 'kids') return 'kids';
  return 'retail';
}

function isMaster(edition) {
  return edition === 'master';
}

// Anything that isn't explicitly master is retail — same direction as
// resolveEdition, so an unrecognised value can never widen access. The kids
// edition counts as retail here on purpose: retail semantics (first-run
// naming, free licence) all apply to kids too; the kids CLAMPS are a
// separate, narrowing-only layer keyed off isKids.
function isRetail(edition) {
  return !isMaster(edition);
}

// The kids build. Only ever used to NARROW what the app does (kids-mode.js
// clamps, parental-controls.js gates) — an unrecognised edition reading
// false here therefore fails open to the ADULT feature set, which is the
// safe direction for adults and unreachable for kids: a kids installer that
// lost its stamp resolves to retail and simply looks like plain JARVIS,
// it never becomes a kids build with the parent gates missing.
function isKids(edition) {
  return edition === 'kids';
}

// What the licence seams should treat as the current state. Master keeps its
// own identity; everything else is FREE_LICENSE — active, always, whatever
// settings.json says, because the product is free. The stored state is
// deliberately ignored (a stale 'expired'/'disabled' from the paid era must
// not lock a free user out). NEVER persist either view — settings.json keeps
// the real state so this stays a one-line revert if a paid build ever returns.
function effectiveLicenseState(edition, _storedState) {
  if (isMaster(edition)) return MASTER_LICENSE;
  return FREE_LICENSE;
}

// The name he answers to before anyone chooses one. JARVIS in both editions
// while the product stays free under that name (Adam, 2026-07-26: "leave
// JARVIS for free while we decide") — a retail buyer still names their own
// on first run, and a paid product name is a later decision. Bonus: a
// Jarvis-sounding default keeps the instant pre-trained wake path.
function defaultAssistantName(_edition) {
  return 'JARVIS';
}

module.exports = {
  EDITIONS,
  MASTER_LICENSE,
  FREE_LICENSE,
  resolveEdition,
  isMaster,
  isRetail,
  isKids,
  effectiveLicenseState,
  defaultAssistantName,
};
