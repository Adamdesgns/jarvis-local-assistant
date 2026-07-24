'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const guard = require('../core/screen-guard');
const {
  FINANCIAL_DENY,
  classifyWindow,
  isAllowedApp,
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
