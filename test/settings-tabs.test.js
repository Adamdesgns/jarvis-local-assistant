const test = require('node:test');
const assert = require('node:assert/strict');
const { TABS, normalizeTab, sectionHidden } = require('../src/settings-tabs');

test('TABS: seven tabs, unique ids, GENERAL first, PRO present, every tab labelled', () => {
  assert.equal(TABS.length, 7);
  assert.equal(TABS[0].id, 'general');
  assert.ok(TABS.some((tab) => tab.id === 'pro'), 'the PRO tab must exist or licensing has no UI');
  const ids = TABS.map((tab) => tab.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const tab of TABS) {
    assert.ok(tab.id && typeof tab.id === 'string');
    assert.ok(tab.label && typeof tab.label === 'string');
  }
});

test('normalizeTab: known ids pass through, anything else lands on general', () => {
  assert.equal(normalizeTab('phone'), 'phone');
  assert.equal(normalizeTab('system'), 'system');
  assert.equal(normalizeTab('does-not-exist'), 'general');
  assert.equal(normalizeTab(undefined), 'general');
  assert.equal(normalizeTab(''), 'general');
});

test('sectionHidden: a section is visible only under its own tab', () => {
  assert.equal(sectionHidden('brains', 'brains'), false);
  assert.equal(sectionHidden('brains', 'general'), true);
  // An untagged section must never vanish on every tab — it shows under general.
  assert.equal(sectionHidden(undefined, 'general'), false);
  assert.equal(sectionHidden(undefined, 'phone'), true);
});
