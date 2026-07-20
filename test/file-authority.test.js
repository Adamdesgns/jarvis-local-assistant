const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DocumentService } = require('../core/document-service');

function makeDocs(roots) {
  return new DocumentService({
    config: { getSettings: () => ({ searchRoots: roots, projects: {} }) },
    shell: { trashItem: async () => {} },
    emit: () => {}
  });
}

test('canRecycle: allows a normal file on a bin-backed volume', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-bin-'));
  const file = path.join(dir, 'note.txt');
  fs.writeFileSync(file, 'hello');
  const docs = makeDocs([dir]);
  // The temp dir lives on the system volume, which has a Recycle Bin.
  assert.deepEqual(docs.canRecycle(file), { ok: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('canRecycle: refuses a UNC/network path', () => {
  const docs = makeDocs(['\\\\server\\share']);
  const out = docs.canRecycle('\\\\server\\share\\report.docx');
  assert.equal(out.ok, false);
  assert.match(out.reason, /network drive/i);
});

test('canRecycle: refuses an item outside the approved folders', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-bin-'));
  const docs = makeDocs([dir]);
  const out = docs.canRecycle(path.join(os.tmpdir(), 'elsewhere.txt'));
  assert.equal(out.ok, false);
  assert.match(out.reason, /approved folders/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('canRecycle: refuses a file bigger than the Recycle Bin will hold', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-bin-'));
  const file = path.join(dir, 'huge.bin');
  fs.writeFileSync(file, 'x');
  const docs = makeDocs([dir]);
  const realStat = fs.statSync;
  // Pretend it is 3 GB without writing 3 GB to disk.
  fs.statSync = (p, ...rest) => {
    const s = realStat(p, ...rest);
    if (path.resolve(p) === path.resolve(file)) return { ...s, size: 3 * 1024 * 1024 * 1024, isFile: () => true };
    return s;
  };
  try {
    const out = docs.canRecycle(file);
    assert.equal(out.ok, false);
    assert.match(out.reason, /too big/i);
  } finally {
    fs.statSync = realStat;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('canRecycle: a directory skips the size test but still needs a bin-backed volume', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-bin-'));
  const sub = path.join(dir, 'folder');
  fs.mkdirSync(sub);
  const docs = makeDocs([dir]);
  assert.deepEqual(docs.canRecycle(sub), { ok: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('applyOrganization: renames instead of overwriting a same-named file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-org-'));
  const destination = path.join(dir, 'Documents');
  fs.mkdirSync(destination);
  fs.writeFileSync(path.join(destination, 'notes.txt'), 'ORIGINAL');
  const source = path.join(dir, 'notes.txt');
  fs.writeFileSync(source, 'INCOMING');
  const docs = makeDocs([dir]);

  const out = await docs.applyOrganization({ directory: dir, moves: [{ source, destination, category: 'Documents' }] });

  assert.equal(out.ok, true);
  // The file that was already there must survive untouched.
  assert.equal(fs.readFileSync(path.join(destination, 'notes.txt'), 'utf8'), 'ORIGINAL');
  // The incoming one lands beside it under a new name.
  assert.equal(fs.readFileSync(path.join(destination, 'notes 2.txt'), 'utf8'), 'INCOMING');
  fs.rmSync(dir, { recursive: true, force: true });
});
