const test = require('node:test');
const assert = require('node:assert/strict');
const { TABS, normalizeTab, sectionHidden } = require('../src/settings-tabs');

test('TABS: eight tabs, unique ids, GENERAL first, CAMERAS and FEATURES present, every tab labelled', () => {
  assert.equal(TABS.length, 8);
  assert.equal(TABS[0].id, 'general');
  // Camera sign-in lives in Settings, never in the cameras module.
  assert.ok(TABS.some((tab) => tab.id === 'cameras'), 'the CAMERAS tab must exist');
  // Still id 'pro' (the section markup keys off it); labelled FEATURES since
  // the product went completely free and the tab became the feature overview.
  assert.ok(TABS.some((tab) => tab.id === 'pro'), 'the FEATURES tab must exist');
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
