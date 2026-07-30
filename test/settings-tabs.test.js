const test = require('node:test');
const assert = require('node:assert/strict');
const { TABS, KID_TABS, normalizeTab, sectionHidden, tabsFor } = require('../src/settings-tabs');

test('TABS: ten tabs, unique ids, GENERAL first, LOOKS and JARVIS JR present', () => {
  assert.equal(TABS.length, 10);
  assert.equal(TABS[0].id, 'general');
  for (const id of ['looks', 'cameras', 'pro', 'jr']) {
    assert.ok(TABS.some((tab) => tab.id === id), `the ${id} tab must exist`);
  }
  const ids = TABS.map((tab) => tab.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const tab of TABS) {
    assert.ok(tab.id && typeof tab.id === 'string');
    assert.ok(tab.label && typeof tab.label === 'string');
  }
});

test('tabsFor: the grown-up build never sees the JARVIS JR tab', () => {
  const { tabs, restricted } = tabsFor({ jr: false });
  assert.equal(restricted, false);
  assert.ok(!tabs.some((tab) => tab.id === 'jr'));
  assert.equal(tabs.length, TABS.length - 1);
});

test('tabsFor: an unlocked JR parent gets the real, complete dialog', () => {
  const { tabs, restricted } = tabsFor({ jr: true, unlocked: true });
  assert.equal(restricted, false);
  assert.deepEqual(tabs.map((t) => t.id), TABS.map((t) => t.id));
});

test('tabsFor: a JR kid gets exactly one tab, and it is cosmetic', () => {
  const { tabs, restricted } = tabsFor({ jr: true, unlocked: false });
  assert.equal(restricted, true);
  assert.deepEqual(tabs.map((t) => t.id), ['looks']);
  assert.deepEqual(KID_TABS.map((t) => t.id), ['looks']);
});

test('a restricted tab set is DENY-BY-DEFAULT — an untagged section never leaks in', () => {
  const kid = tabsFor({ jr: true, unlocked: false });
  assert.equal(sectionHidden('looks', 'looks', kid), false);
  for (const tab of ['brains', 'cameras', 'automation', 'abilities', 'phone', 'system', 'jr', 'general']) {
    assert.equal(sectionHidden(tab, 'looks', kid), true, `${tab} must be hidden from the kid`);
  }
  // The forgiving fallback that keeps an untagged section visible under
  // GENERAL must NOT apply under a restricted set.
  assert.equal(sectionHidden(undefined, 'looks', kid), true);
  // Unrestricted behaviour is unchanged.
  assert.equal(sectionHidden(undefined, 'general'), false);
  assert.equal(sectionHidden('brains', 'general'), true);
  assert.equal(sectionHidden('brains', 'brains'), false);
});

test('normalizeTab honours the tab set it is given', () => {
  assert.equal(normalizeTab('cameras'), 'cameras');
  assert.equal(normalizeTab('does-not-exist'), 'general');
  assert.equal(normalizeTab(undefined), 'general');
  assert.equal(normalizeTab('cameras', KID_TABS), 'looks');
  assert.equal(normalizeTab(undefined, KID_TABS), 'looks');
});
