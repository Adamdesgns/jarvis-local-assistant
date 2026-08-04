const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { VaultService, slugify, extractWikilinks } = require('../core/vault-service');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-vault-'));
}

test('slugify strips path separators and traversal so titles cannot escape the vault', () => {
  assert.equal(slugify('../../evil'), 'evil');
  assert.equal(slugify('..\\..\\windows\\system32'), 'windows-system32');
  assert.equal(slugify(''), 'note');
  assert.equal(slugify('Hello, World!'), 'hello-world');
});

test('capture writes a markdown note under vault/raw with frontmatter', () => {
  const dir = tmpDir();
  try {
    const vault = new VaultService(dir);
    const saved = vault.capture('Ship the HUD reveal video', { title: 'HUD reveal', tags: ['video'] });
    assert.ok(saved.path.startsWith(path.join(dir, 'vault', 'raw')));
    const content = fs.readFileSync(saved.path, 'utf8');
    assert.match(content, /^---\n/);
    assert.match(content, /source: voice/);
    assert.match(content, /tags: \[video\]/);
    assert.match(content, /Ship the HUD reveal video/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('capture refuses empty text', () => {
  const dir = tmpDir();
  try {
    const vault = new VaultService(dir);
    assert.throws(() => vault.capture('   '), /nothing to capture/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('same-day same-title captures get numbered, never overwritten', () => {
  const dir = tmpDir();
  try {
    const vault = new VaultService(dir);
    const first = vault.capture('idea one', { title: 'idea' });
    const second = vault.capture('idea two', { title: 'idea' });
    assert.notEqual(first.path, second.path);
    assert.match(fs.readFileSync(first.path, 'utf8'), /idea one/);
    assert.match(fs.readFileSync(second.path, 'utf8'), /idea two/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('appendDaily creates the daily note once and appends sections in order', () => {
  const dir = tmpDir();
  try {
    const vault = new VaultService(dir);
    vault.appendDaily('Inbox Brief', '- [ ] pay invoice');
    const saved = vault.appendDaily('Plan', '- [ ] 1. ship it');
    const content = fs.readFileSync(saved.path, 'utf8');
    assert.match(content, /^# \d{4}-\d{2}-\d{2}\n/);
    assert.ok(content.indexOf('## Inbox Brief') < content.indexOf('## Plan'));
    assert.match(content, /pay invoice/);
    assert.match(content, /ship it/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writeWiki overwrites the same title in place — distilled knowledge updates', () => {
  const dir = tmpDir();
  try {
    const vault = new VaultService(dir);
    vault.writeWiki('Editing Workflow', 'v1');
    const saved = vault.writeWiki('Editing Workflow', 'v2');
    assert.equal(fs.readFileSync(saved.path, 'utf8'), 'v2\n');
    assert.equal(vault.stats().wiki, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('search finds notes across folders and returns a snippet', () => {
  const dir = tmpDir();
  try {
    const vault = new VaultService(dir);
    vault.capture('the compressor needs draining every morning', { title: 'compressor' });
    vault.writeOutput('metrics-pull', '# Metrics\ncompressor uptime nominal');
    const hits = vault.search('compressor');
    assert.equal(hits.length, 2);
    assert.ok(hits[0].snippet.length > 0);
    assert.deepEqual(vault.search(''), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('extractWikilinks reads plain, aliased, and heading links', () => {
  assert.deepEqual(
    extractWikilinks('See [[Editing Workflow]] and [[Metrics|the numbers]] plus [[Vault#stats]].'),
    ['Editing Workflow', 'Metrics', 'Vault']
  );
});

test('graph counts wikilink edges and ranks most-linked notes', () => {
  const dir = tmpDir();
  try {
    const vault = new VaultService(dir);
    vault.capture('working on [[HUD]] today', { title: 'log one' });
    vault.capture('the [[HUD]] needs a [[Vault]] feed', { title: 'log two' });
    const graph = vault.graph();
    assert.equal(graph.links.length, 3);
    assert.equal(graph.mostLinked[0].name, 'HUD');
    assert.equal(graph.mostLinked[0].count, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('stats reports counts per folder plus link total, and an empty vault reads zero', () => {
  const dir = tmpDir();
  try {
    const vault = new VaultService(dir);
    assert.deepEqual(vault.stats(), { raw: 0, wiki: 0, outputs: 0, total: 0, links: 0 });
    vault.capture('raw note');
    vault.writeWiki('topic', 'body');
    vault.writeOutput('report', 'body');
    vault.appendDaily('Log', 'entry');
    const stats = vault.stats();
    assert.equal(stats.raw, 2); // capture + daily note live under raw/
    assert.equal(stats.wiki, 1);
    assert.equal(stats.outputs, 1);
    assert.equal(stats.total, 4);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('recent returns newest first and readNote finds by name', () => {
  const dir = tmpDir();
  try {
    const vault = new VaultService(dir);
    const first = vault.capture('older', { title: 'older-note' });
    const second = vault.capture('newer', { title: 'newer-note' });
    // mtime resolution can collapse same-instant writes; nudge the second.
    fs.utimesSync(second.path, new Date(), new Date(Date.now() + 2000));
    const recent = vault.recent(2);
    assert.equal(recent[0].name, second.name);
    assert.match(vault.readNote(first.name).content, /older/);
    assert.equal(vault.readNote('no-such-note'), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
