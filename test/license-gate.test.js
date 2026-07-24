const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PRO_FEATURES,
  PRO_FLAG_KEYS,
  isPro,
  gateSettingsPatch,
  applyLicenseToSettings,
  featureAllowed
} = require('../core/license-gate');

const LICENSED = { status: 'active' };
const UNLICENSED = { status: 'none' };

// The exact boolean keys the gate must cover. If a Pro feature's key is ever
// removed from PRO_FEATURES, the named assertion below fails — a deleted gate
// entry must never pass silently (same discipline as the claude-bridge tests).
const EXPECTED_FLAG_KEYS = [
  'mobileEnabled', 'schedulesEnabled', 'autonomyEnabled',
  'screenControlEnabled', 'screenDriveEnabled', 'nightShiftEnabled'
];

test('PRO_FEATURES is frozen and covers every Pro flag', () => {
  assert.ok(Object.isFrozen(PRO_FEATURES), 'the feature list must be frozen');
  for (const feature of PRO_FEATURES) assert.ok(Object.isFrozen(feature), `${feature.id} entry must be frozen`);
  for (const key of EXPECTED_FLAG_KEYS) {
    assert.ok(PRO_FLAG_KEYS.includes(key), `${key} must be gated — removing it from PRO_FEATURES silently gives the feature away`);
  }
  assert.ok(PRO_FEATURES.some((feature) => feature.id === 'camera' && feature.kind === 'accounts'), 'cameras must be listed');
});

test('isPro: only an explicit active status counts', () => {
  assert.equal(isPro({ status: 'active' }), true);
  assert.equal(isPro({ status: 'none' }), false);
  assert.equal(isPro({ status: 'disabled' }), false);
  assert.equal(isPro({ status: 'expired' }), false);
  assert.equal(isPro(null), false);
  assert.equal(isPro(undefined), false);
});

for (const key of EXPECTED_FLAG_KEYS) {
  test(`an unlicensed enable of ${key} is stripped and reported`, () => {
    const previous = { [key]: false };
    const { patch, refused } = gateSettingsPatch(previous, { [key]: true, profileName: 'Adam' }, UNLICENSED);
    assert.equal(Object.prototype.hasOwnProperty.call(patch, key), false, `${key} must be stripped from the patch`);
    assert.equal(patch.profileName, 'Adam', 'free settings in the same patch must pass');
    assert.equal(refused.length, 1);
    assert.ok(refused[0].label, 'the refusal must carry a human label for the toast');
  });
}

test('unlicensed disables always pass — you can always turn things OFF', () => {
  const previous = { mobileEnabled: true };
  const { patch, refused } = gateSettingsPatch(previous, { mobileEnabled: false }, UNLICENSED);
  assert.equal(patch.mobileEnabled, false);
  assert.equal(refused.length, 0);
});

test('unlicensed true→true passes — migrated flags stay written, seams refuse instead', () => {
  const previous = { schedulesEnabled: true };
  const { patch, refused } = gateSettingsPatch(previous, { schedulesEnabled: true }, UNLICENSED);
  assert.equal(patch.schedulesEnabled, true);
  assert.equal(refused.length, 0);
});

test('licensed patches pass through untouched', () => {
  const input = { mobileEnabled: true, schedulesEnabled: true, autonomyEnabled: true };
  const { patch, refused } = gateSettingsPatch({}, input, LICENSED);
  assert.deepEqual(patch, input);
  assert.equal(refused.length, 0);
});

test('applyLicenseToSettings forces exactly the Pro flags false when unlicensed', () => {
  const settings = {
    mobileEnabled: true, schedulesEnabled: true, autonomyEnabled: true,
    screenControlEnabled: true, screenDriveEnabled: true, nightShiftEnabled: true,
    voiceEnabled: true, aiMode: 'local'
  };
  const view = applyLicenseToSettings(settings, UNLICENSED);
  for (const key of EXPECTED_FLAG_KEYS) assert.equal(view[key], false, `${key} must read false unlicensed`);
  assert.equal(view.voiceEnabled, true, 'free settings must survive the view');
  assert.equal(view.aiMode, 'local');
  assert.equal(settings.mobileEnabled, true, 'the original settings object must never be mutated');
});

test('applyLicenseToSettings is identity when licensed', () => {
  const settings = { mobileEnabled: true, nightShiftEnabled: true };
  assert.equal(applyLicenseToSettings(settings, LICENSED), settings);
});

// The clobber guard: CameraService read-modify-writes cameraAccounts, so a
// gated view that blanked the array would destroy saved cameras on the next
// write. The view must always show the real array.
test('applyLicenseToSettings never touches cameraAccounts', () => {
  const accounts = [{ id: 'ring-1' }, { id: 'rtsp-2' }];
  const view = applyLicenseToSettings({ cameraAccounts: accounts, mobileEnabled: true }, UNLICENSED);
  assert.equal(view.cameraAccounts, accounts);
  assert.equal(view.cameraAccounts.length, 2);
});

test('featureAllowed truth table', () => {
  const on = { mobileEnabled: true, cameraAccounts: [] };
  const off = { mobileEnabled: false, cameraAccounts: [] };
  // Flag features need BOTH a license and the toggle.
  assert.equal(featureAllowed('mobile', on, LICENSED), true);
  assert.equal(featureAllowed('mobile', off, LICENSED), false);
  assert.equal(featureAllowed('mobile', on, UNLICENSED), false);
  assert.equal(featureAllowed('mobile', on, { status: 'disabled' }), false);
  assert.equal(featureAllowed('mobile', on, null), false);
  // Cameras are allowed by license alone — accounts are data, not permission.
  assert.equal(featureAllowed('camera', off, LICENSED), true);
  assert.equal(featureAllowed('camera', off, UNLICENSED), false);
  // Anything not in the Pro list is free.
  assert.equal(featureAllowed('not-a-feature', off, UNLICENSED), true);
});
