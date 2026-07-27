const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ConfigStore, mergeSettings } = require('../core/config-store');
const { DEFAULT_SETTINGS } = require('../core/defaults');
const { makePinRecord } = require('../core/parental-controls');

// The 'parental' object rides settings.json but follows the 'license'
// discipline: written only by ConfigStore.setParentalState from the main
// process, never through the renderer-reachable settings:save allowlist.

function freshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-parental-store-'));
  return { dir, store: new ConfigStore(dir, null) };
}

test('parental defaults arrive on a fresh install and survive a merge', () => {
  const merged = mergeSettings(DEFAULT_SETTINGS, { settingsVersion: 10 });
  assert.equal(merged.parental.dailyLimitMinutes, 0);
  assert.equal(merged.parental.cloudAllowed, false);
  assert.equal(merged.parental.quietStart, 21);
});

test('updateSettings cannot touch parental — the allowlist holds', () => {
  const { dir, store } = freshStore();
  try {
    store.updateSettings({ parental: { pinHash: 'forged', pinSalt: 'forged', dailyLimitMinutes: 999 } });
    assert.equal(store.getSettings().parental.pinHash, '');
    assert.equal(store.getSettings().parental.dailyLimitMinutes, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('setParentalState persists, types its fields, and survives a reload', () => {
  const { dir, store } = freshStore();
  try {
    const record = makePinRecord('1234');
    store.setParentalState({ ...record, dailyLimitMinutes: '60', quietEnabled: 'yes', cloudAllowed: true });
    const reloaded = new ConfigStore(dir, null);
    const parental = reloaded.getSettings().parental;
    assert.equal(parental.pinHash, record.pinHash);
    assert.equal(parental.dailyLimitMinutes, 60);
    // 'yes' is not true — booleans are booleans on this path.
    assert.equal(parental.quietEnabled, false);
    assert.equal(parental.cloudAllowed, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('setParentalState with a partial patch keeps the PIN it was not given', () => {
  const { dir, store } = freshStore();
  try {
    const record = makePinRecord('1234');
    store.setParentalState(record);
    store.setParentalState({ dailyLimitMinutes: 90 });
    const parental = store.getSettings().parental;
    assert.equal(parental.pinHash, record.pinHash, 'the PIN must survive a knobs-only save');
    assert.equal(parental.dailyLimitMinutes, 90);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('publicSettings never leaks hash material to the renderer', () => {
  const { dir, store } = freshStore();
  try {
    store.setParentalState(makePinRecord('1234'));
    const view = store.publicSettings().parental;
    assert.equal(view.pinSet, true);
    assert.ok(!('pinHash' in view));
    assert.ok(!('pinSalt' in view));
    // getSettings (main-process only) still carries the real record.
    assert.ok(store.getSettings().parental.pinHash);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
