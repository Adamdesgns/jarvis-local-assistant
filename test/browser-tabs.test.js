const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAddress, createTabList } = require('../src/browser-tabs');

// --- normalizeAddress ---

test('full web URLs pass through untouched', () => {
  assert.deepEqual(normalizeAddress('https://www.wlox.com/weather/'), { url: 'https://www.wlox.com/weather/' });
  assert.deepEqual(normalizeAddress('http://example.com'), { url: 'http://example.com' });
});

test('bare domains get https', () => {
  assert.deepEqual(normalizeAddress('wlox.com'), { url: 'https://wlox.com' });
  assert.deepEqual(normalizeAddress('www.sunherald.com/news'), { url: 'https://www.sunherald.com/news' });
  assert.deepEqual(normalizeAddress('duckduckgo.com/?q=x'), { url: 'https://duckduckgo.com/?q=x' });
});

test('anything else becomes a DuckDuckGo search', () => {
  assert.deepEqual(normalizeAddress('what is a webview'), { url: 'https://duckduckgo.com/?q=what%20is%20a%20webview' });
  assert.deepEqual(normalizeAddress('gulfport weather radar'), { url: 'https://duckduckgo.com/?q=gulfport%20weather%20radar' });
});

test('dangerous schemes are treated as search text, never as URLs', () => {
  assert.equal(normalizeAddress('file:///C:/Windows/system32').url.startsWith('https://duckduckgo.com/'), true);
  assert.equal(normalizeAddress('javascript:alert(1)').url.startsWith('https://duckduckgo.com/'), true);
  assert.equal(normalizeAddress('chrome://settings').url.startsWith('https://duckduckgo.com/'), true);
});

test('empty input is null', () => {
  assert.equal(normalizeAddress(''), null);
  assert.equal(normalizeAddress('   '), null);
  assert.equal(normalizeAddress(null), null);
});

// --- createTabList ---

test('opens tabs up to the cap, then refuses', () => {
  const tabs = createTabList({ max: 5 });
  for (let i = 0; i < 5; i += 1) assert.ok(tabs.open(`https://site${i}.test`));
  assert.equal(tabs.open('https://one-too-many.test'), null);
  assert.equal(tabs.list().length, 5);
});

test('opening activates the new tab; ids are stable strings', () => {
  const tabs = createTabList({});
  const first = tabs.open('https://a.test');
  const second = tabs.open('https://b.test');
  assert.equal(typeof first.id, 'string');
  assert.notEqual(first.id, second.id);
  assert.equal(tabs.active().id, second.id);
});

test('closing the active tab activates its neighbor', () => {
  const tabs = createTabList({});
  const a = tabs.open('https://a.test');
  const b = tabs.open('https://b.test');
  const c = tabs.open('https://c.test');
  tabs.activate(b.id);
  const next = tabs.close(b.id);
  assert.equal(next, c.id, 'the tab to the right takes over');
  tabs.close(c.id);
  assert.equal(tabs.active().id, a.id);
});

test('closing the last tab empties the list', () => {
  const tabs = createTabList({});
  const only = tabs.open('https://a.test');
  assert.equal(tabs.close(only.id), null);
  assert.equal(tabs.list().length, 0);
  assert.equal(tabs.active(), null);
});

test('closing an inactive tab keeps the active one', () => {
  const tabs = createTabList({});
  const a = tabs.open('https://a.test');
  const b = tabs.open('https://b.test');
  assert.equal(tabs.close(a.id), b.id);
  assert.equal(tabs.active().id, b.id);
});

test('update patches title, url, and loading', () => {
  const tabs = createTabList({});
  const tab = tabs.open('https://a.test');
  tabs.update(tab.id, { title: 'WLOX Weather', loading: true });
  assert.equal(tabs.active().title, 'WLOX Weather');
  assert.equal(tabs.active().loading, true);
  tabs.update(tab.id, { url: 'https://a.test/page2', loading: false });
  assert.equal(tabs.active().url, 'https://a.test/page2');
  assert.equal(tabs.active().title, 'WLOX Weather', 'patch does not clobber siblings');
});
