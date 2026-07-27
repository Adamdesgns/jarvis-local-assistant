const test = require('node:test');
const assert = require('node:assert/strict');

const {
  EDITIONS,
  resolveEdition,
  isMaster,
  isRetail,
  effectiveLicenseState,
  defaultAssistantName,
} = require('../core/edition');

// The app ships as two artefacts from one tree:
//   master — Adam's personal copy. No naming prompt, no licence gate, full Pro.
//            Unsigned, never distributed.
//   retail — what a buyer installs. Names the assistant on first run, and the
//            Pro gate is real.
//
// THE LOAD-BEARING PROPERTY: this is decided at BUILD time, never in settings.
// A settings toggle would make the paywall decorative — anyone could flip it.

test('EDITIONS: exactly two, and no third slips in', () => {
  assert.deepEqual([...EDITIONS], ['master', 'retail']);
  assert.throws(() => { EDITIONS.push('trial'); }, 'EDITIONS must be frozen');
});

test('running from source is master — you already have the code', () => {
  // Gating a developer running `npm start` from the repo protects nothing.
  assert.equal(resolveEdition({ packaged: false }), 'master');
  assert.equal(resolveEdition({ packaged: false, stamped: 'retail' }), 'master');
});

test('a packaged build with NO stamp is retail — fail closed', () => {
  // The direction of this default is the whole point. If an unstamped build
  // fell back to master, a broken build script would ship a free, ungated,
  // full-Pro copy to every buyer and nothing would look wrong.
  assert.equal(resolveEdition({ packaged: true }), 'retail');
  assert.equal(resolveEdition({ packaged: true, stamped: '' }), 'retail');
  assert.equal(resolveEdition({ packaged: true, stamped: null }), 'retail');
});

test('a packaged build is master only when explicitly stamped so', () => {
  assert.equal(resolveEdition({ packaged: true, stamped: 'master' }), 'master');
  assert.equal(resolveEdition({ packaged: true, stamped: 'MASTER' }), 'master');
});

test('an unrecognised stamp is retail, not an error', () => {
  // A typo in the build script must not produce a free build, and must not
  // crash the app either.
  assert.equal(resolveEdition({ packaged: true, stamped: 'mastr' }), 'retail');
  assert.equal(resolveEdition({ packaged: true, stamped: 'pro' }), 'retail');
  assert.equal(resolveEdition({}), 'retail');
  assert.equal(resolveEdition(), 'retail');
});

test('isMaster / isRetail are exact opposites', () => {
  assert.equal(isMaster('master'), true);
  assert.equal(isRetail('master'), false);
  assert.equal(isMaster('retail'), false);
  assert.equal(isRetail('retail'), true);
  // Anything unrecognised is treated as retail, same fail-closed direction.
  assert.equal(isMaster('nonsense'), false);
  assert.equal(isRetail('nonsense'), true);
});

test('master is always Pro, whatever settings.json says', () => {
  const state = effectiveLicenseState('master', { status: 'none' });
  assert.equal(state.status, 'active');
});

test('master stays Pro even with no licence object at all', () => {
  assert.equal(effectiveLicenseState('master', null).status, 'active');
  assert.equal(effectiveLicenseState('master', undefined).status, 'active');
});

test('retail is Pro too — JARVIS is free, everything included', () => {
  // Adam, 2026-07-26: JARVIS is completely free, permanently — the demo of
  // what he builds for customers. Every edition reports an active licence,
  // whatever settings.json says, so every gate downstream stays open.
  assert.equal(effectiveLicenseState('retail', { status: 'none' }).status, 'active');
  assert.equal(effectiveLicenseState('retail', null).status, 'active');
  assert.equal(effectiveLicenseState('retail', undefined).status, 'active');
  assert.equal(effectiveLicenseState('retail', { status: 'expired' }).status, 'active');
});

test('an unrecognised edition is free as well — there is no locked tier left', () => {
  assert.equal(effectiveLicenseState('nonsense', { status: 'none' }).status, 'active');
});

test('the free licence view is frozen and never the stored object', () => {
  // Same rule as the master view: the effective state is never persisted, so
  // a copied settings.json can't carry a forged shape, and nothing downstream
  // may decorate it.
  const stored = { status: 'none' };
  const state = effectiveLicenseState('retail', stored);
  assert.notEqual(state, stored, 'must not hand back the stored object');
  assert.ok(Object.isFrozen(state), 'the free view must be frozen');
});

test('the assistant default is JARVIS in every edition', () => {
  // While the product stays free under the JARVIS name (Adam, 2026-07-26),
  // both editions default to it; a retail buyer still renames on first run.
  // Revisit alongside the paid product-name decision — a PAID retail default
  // must not carry Marvel's mark.
  assert.equal(defaultAssistantName('master'), 'JARVIS');
  assert.equal(defaultAssistantName('retail'), 'JARVIS');
  assert.equal(defaultAssistantName('nonsense'), 'JARVIS');
});
