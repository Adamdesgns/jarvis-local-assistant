'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const guard = require('../core/screen-guard');
const {
  FINANCIAL_DENY,
  V1_DRIVE_APPS,
  classifyWindow,
  isAllowedApp,
  effectiveDriveAllowlist,
  isDriveAllowed,
  classifyStep,
  redactElements
} = guard;

// ---------------------------------------------------------------------------
// The permanent financial deny. This is the one Adam decided can never be
// turned off. These tests are the enforcement of that promise: if someone
// makes the list editable, or drops an entry, a test here must fail.
// ---------------------------------------------------------------------------

test('the financial denylist is frozen — it cannot be widened or emptied at runtime', () => {
  assert.ok(Object.isFrozen(FINANCIAL_DENY), 'FINANCIAL_DENY must be frozen');
  // In strict mode a mutation throws; assert that it does rather than silently
  // succeeding. This is the "no override, not even by Adam" guarantee.
  assert.throws(() => { FINANCIAL_DENY.push(/anything/); }, TypeError);
  assert.throws(() => { FINANCIAL_DENY.length = 0; }, TypeError);
});

test('a brokerage window is denied as financial', () => {
  const verdict = classifyWindow({ processName: 'chrome.exe', title: 'Robinhood - Investing' });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.category, 'financial');
});

test('a bank window is denied whether the match is in the title or the process', () => {
  assert.equal(classifyWindow({ processName: 'chrome.exe', title: 'Chase Online' }).category, 'financial');
  assert.equal(classifyWindow({ processName: 'Coinbase.exe', title: 'Home' }).category, 'financial');
});

test('crypto and payment surfaces are denied as financial', () => {
  assert.equal(classifyWindow({ title: 'Coinbase' }).category, 'financial');
  assert.equal(classifyWindow({ title: 'PayPal Checkout' }).category, 'financial');
});

// ---------------------------------------------------------------------------
// Credential, system and elevated surfaces.
// ---------------------------------------------------------------------------

test('a sign-in or password window is denied as credential', () => {
  assert.equal(classifyWindow({ title: 'Sign in to your account' }).category, 'credential');
  assert.equal(classifyWindow({ processName: 'Bitwarden.exe', title: 'Bitwarden' }).category, 'credential');
});

test('system and admin windows are denied', () => {
  assert.equal(classifyWindow({ title: 'Registry Editor' }).category, 'system');
  assert.equal(classifyWindow({ title: 'Task Manager' }).category, 'system');
  assert.equal(classifyWindow({ processName: 'SecHealthUI.exe', title: 'Windows Security' }).category, 'system');
});

test('an elevated window is denied on integrity alone, before any title match', () => {
  const verdict = classifyWindow({ processName: 'notepad.exe', title: 'Untitled', integrity: 'High' });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.category, 'elevated');
});

test('an ordinary window is allowed', () => {
  const verdict = classifyWindow({ processName: 'notepad.exe', title: 'shopping list.txt - Notepad', integrity: 'Medium' });
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.category, 'ok');
});

test('a window with no information is treated as ordinary, not crashed on', () => {
  assert.equal(classifyWindow().allowed, true);
  assert.equal(classifyWindow({}).allowed, true);
});

// ---------------------------------------------------------------------------
// The allowlist (scaffolding for the clicking slice).
// ---------------------------------------------------------------------------

test('isAllowedApp matches with or without the .exe suffix', () => {
  assert.equal(isAllowedApp('explorer.exe', ['explorer', 'chrome']), true);
  assert.equal(isAllowedApp('chrome', ['chrome.exe']), true);
});

test('isAllowedApp rejects an app that is not listed', () => {
  assert.equal(isAllowedApp('regedit.exe', ['explorer', 'chrome']), false);
  assert.equal(isAllowedApp('', ['explorer']), false);
  assert.equal(isAllowedApp('notepad.exe', []), false);
});

// ---------------------------------------------------------------------------
// Driving (slice 2). These are mutation-style: each check below is a boundary,
// and deleting the check in screen-guard must fail a test here.
// ---------------------------------------------------------------------------

test('the v1 drive-app list is frozen — settings can never widen it', () => {
  assert.ok(Object.isFrozen(V1_DRIVE_APPS), 'V1_DRIVE_APPS must be frozen');
  assert.throws(() => { V1_DRIVE_APPS.push('chrome'); }, TypeError);
  assert.deepEqual([...V1_DRIVE_APPS], ['explorer', 'notepad']);
});

test('effectiveDriveAllowlist strips chrome even when settings still list it', () => {
  assert.deepEqual(effectiveDriveAllowlist(['explorer', 'chrome']), ['explorer']);
  assert.deepEqual(effectiveDriveAllowlist(['chrome']), []);
  assert.deepEqual(effectiveDriveAllowlist(['explorer.exe', 'Notepad']), ['explorer', 'notepad']);
});

test('isDriveAllowed is exact-match — notepad++ must NOT ride in on "notepad"', () => {
  assert.equal(isDriveAllowed('notepad.exe', ['notepad']), true);
  assert.equal(isDriveAllowed('notepad++.exe', ['notepad']), false);
  assert.equal(isDriveAllowed('explorer', ['explorer', 'notepad']), true);
  assert.equal(isDriveAllowed('internetexplorer.exe', ['explorer']), false);
  assert.equal(isDriveAllowed('', ['explorer']), false);
  assert.equal(isDriveAllowed('explorer.exe', []), false);
});

test('classifyStep: destructive names are denied outright, no approval card', () => {
  assert.equal(classifyStep({ action: 'invoke', target: { name: 'Delete permanently' } }).tier, 'deny');
  assert.equal(classifyStep({ action: 'invoke', target: { name: 'Empty Recycle Bin' } }).tier, 'deny');
  assert.equal(classifyStep({ action: 'invoke', target: { name: 'Format Local Disk (C:)' } }).tier, 'deny');
  assert.equal(classifyStep({ action: 'invoke', target: { name: 'Reset this PC' } }).tier, 'deny');
});

test('classifyStep: a password field is denied for any action', () => {
  assert.equal(classifyStep({ action: 'setValue', target: { name: 'Password' }, element: { isPassword: true } }).tier, 'deny');
  assert.equal(classifyStep({ action: 'invoke', element: { isPassword: true } }).tier, 'deny');
});

test('classifyStep: anything that writes, sends or ships pauses for approval', () => {
  for (const name of ['Save', 'Send', 'Submit', 'Delete', 'Download', 'Upload', 'Apply', 'Confirm', "Don't Save"]) {
    assert.equal(classifyStep({ action: 'invoke', target: { name } }).tier, 'approve', name);
  }
  assert.equal(classifyStep({ action: 'invoke', target: { name: 'Move to Documents' } }).tier, 'approve');
  assert.equal(classifyStep({ action: 'setValue', target: { name: 'File name' }, kind: 'risky' }).tier, 'approve');
});

test('classifyStep: navigation, menus and plain typing run free', () => {
  assert.equal(classifyStep({ action: 'invoke', target: { name: 'File' } }).tier, 'free');
  assert.equal(classifyStep({ action: 'invoke', target: { name: 'Documents' } }).tier, 'free');
  assert.equal(classifyStep({ action: 'setValue', target: { name: 'Text editor' }, text: 'hello' }).tier, 'free');
  assert.equal(classifyStep({ action: 'focusWindow', target: { app: 'notepad' } }).tier, 'free');
});

test('classifyStep fails closed on junk input without crashing', () => {
  assert.equal(classifyStep().tier, 'free');
  assert.equal(classifyStep({ element: { isPassword: true } }).tier, 'deny');
});

// ---------------------------------------------------------------------------
// Redaction — no secret ever leaves this module.
// ---------------------------------------------------------------------------

test('redactElements never carries a password field name or any value through', () => {
  const cleaned = redactElements([
    { name: 'hunter2', control: 'Edit', isPassword: true, value: 'hunter2' },
    { name: 'Save', control: 'Button', isPassword: false, value: 'ignored' }
  ]);
  assert.equal(cleaned[0].name, '');
  assert.equal(cleaned[0].isPassword, true);
  assert.equal('value' in cleaned[0], false, 'no value field should survive redaction');
  assert.equal(cleaned[1].name, 'Save');
  assert.equal('value' in cleaned[1], false);
});

test('redactElements tolerates junk input', () => {
  assert.deepEqual(redactElements(), []);
  assert.deepEqual(redactElements(null), []);
  assert.deepEqual(redactElements('nope'), []);
});
