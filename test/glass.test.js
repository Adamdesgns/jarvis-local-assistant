const test = require('node:test');
const assert = require('node:assert/strict');
const { GLASS_LEVELS, normalizeGlass } = require('../src/glass');

test('GLASS_LEVELS: three named levels, unique ids, all labelled', () => {
  assert.equal(GLASS_LEVELS.length, 3);
  const ids = GLASS_LEVELS.map((level) => level.id);
  assert.deepEqual(ids, ['solid', 'glass', 'ghost']);
  assert.equal(new Set(ids).size, ids.length);
  for (const level of GLASS_LEVELS) {
    assert.ok(level.label && typeof level.label === 'string');
  }
});

test('normalizeGlass: known levels pass through, anything else lands on glass', () => {
  assert.equal(normalizeGlass('solid'), 'solid');
  assert.equal(normalizeGlass('ghost'), 'ghost');
  // 'glass' is the shipped default — the middle setting, readable everywhere.
  assert.equal(normalizeGlass('glass'), 'glass');
  assert.equal(normalizeGlass('see-through'), 'glass');
  assert.equal(normalizeGlass(undefined), 'glass');
  assert.equal(normalizeGlass(''), 'glass');
  assert.equal(normalizeGlass(null), 'glass');
});
