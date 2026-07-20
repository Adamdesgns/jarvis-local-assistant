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
  const realStat = fs.statSync;
  // Pretend the directory reports as 3 GB, far above the recycle-size cap.
  // If the isFile() guard were ever removed, this would trip the "too big"
  // refusal instead of returning ok: true.
  fs.statSync = (p, ...rest) => {
    if (path.resolve(p) === path.resolve(sub)) return { isFile: () => false, size: 3 * 1024 * 1024 * 1024 };
    return realStat(p, ...rest);
  };
  try {
    assert.deepEqual(docs.canRecycle(sub), { ok: true });
  } finally {
    fs.statSync = realStat;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('canRecycle: refuses a volume with no Recycle Bin', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-bin-'));
  const file = path.join(dir, 'note.txt');
  fs.writeFileSync(file, 'hello');
  const docs = makeDocs([dir]);
  const realExistsSync = fs.existsSync;
  const root = path.parse(path.resolve(file)).root;
  const binPath = path.resolve(path.join(root, '$Recycle.Bin'));
  // Pretend this volume's root has no $Recycle.Bin folder (e.g. a USB stick),
  // while leaving every other existsSync check (including approvedRoots())
  // working against the real filesystem.
  fs.existsSync = (p, ...rest) => {
    if (path.resolve(p) === binPath) return false;
    return realExistsSync(p, ...rest);
  };
  try {
    const out = docs.canRecycle(file);
    assert.equal(out.ok, false);
    assert.match(out.reason, /Recycle Bin/i);
  } finally {
    fs.existsSync = realExistsSync;
    fs.rmSync(dir, { recursive: true, force: true });
  }
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

const { CommandRouter } = require('../core/router');

function makeRouter(documentCalls) {
  return new CommandRouter({
    config: { getSettings: () => ({ searchRoots: [], projects: {}, assistantName: 'JARVIS' }) },
    tools: { searchFiles: async () => [{ path: 'C:\\Approved\\report.pdf', name: 'report.pdf' }] },
    documents: {
      resolveLocation: () => 'C:\\Approved\\Archive',
      planOrganization: async () => ({ directory: 'C:\\Approved', moves: [{ source: 'C:\\Approved\\a.txt', destination: 'C:\\Approved\\Documents', category: 'Documents' }] }),
      canRecycle: () => ({ ok: true }),
      copyItem: async (...a) => { documentCalls.push(['copy', ...a]); return { ok: true, message: 'Copied report.pdf.' }; },
      moveItem: async (...a) => { documentCalls.push(['move', ...a]); return { ok: true, message: 'Moved report.pdf.' }; },
      renameItem: async (...a) => { documentCalls.push(['rename', ...a]); return { ok: true, message: 'Renamed it to final.pdf.' }; },
      applyOrganization: async (...a) => { documentCalls.push(['organize', ...a]); return { ok: true, message: 'Organized 1 file into labeled folders.' }; },
      trashItem: async (...a) => { documentCalls.push(['trash', ...a]); return { ok: true, message: 'Moved report.pdf to the Recycle Bin.' }; }
    },
    ai: { reply: async () => ({ ok: true, text: 'ok' }) },
    memory: { search: () => [], add: () => {}, forget: () => {} },
    tasks: { list: () => [], add: () => {}, update: () => {}, summary: () => ({ open: 0, overdue: 0, tasks: [] }) },
    log: { write: () => {} },
    cameras: null
  });
}

test('attended move executes at once with no approval card', async () => {
  const calls = [];
  const router = makeRouter(calls);
  const result = await router.handle('move report to archive');
  assert.equal(result.approval, undefined, 'no approval card should be raised');
  assert.equal(router.pending.size, 0, 'nothing should be queued');
  assert.equal(calls[0][0], 'move');
  assert.match(result.response, /Moved/);
});

test('attended rename and organize execute at once', async () => {
  const calls = [];
  const router = makeRouter(calls);
  const renamed = await router.handle('rename report to final.pdf');
  assert.equal(renamed.approval, undefined);
  assert.equal(calls[0][0], 'rename');

  const organized = await router.handle('organize my downloads');
  assert.equal(organized.approval, undefined);
  assert.equal(calls[1][0], 'organize');
  assert.equal(router.pending.size, 0);
});

test('a failing file operation reports the reason instead of throwing', async () => {
  const calls = [];
  const router = makeRouter(calls);
  router.documents.moveItem = async () => { throw new Error('report.pdf already exists at the destination.'); };
  const result = await router.handle('move report to archive');
  assert.equal(result.success, false);
  assert.match(result.response, /already exists/);
});

test('delete moves the file to the Recycle Bin with no approval card', async () => {
  const calls = [];
  const router = makeRouter(calls);
  const result = await router.handle('delete report');
  assert.equal(result.approval, undefined, 'delete must not raise an approval card any more');
  assert.equal(router.pending.size, 0);
  assert.equal(calls[0][0], 'trash');
  assert.match(result.response, /Recycle Bin/i);
});

test('delete is refused when the Recycle Bin would not catch it', async () => {
  const calls = [];
  const router = makeRouter(calls);
  router.documents.canRecycle = () => ({ ok: false, reason: "That's on a network drive, which has no Recycle Bin — I'd have to erase it for good. I'd rather you did that one yourself, sir." });
  const result = await router.handle('delete report');
  assert.equal(result.success, false);
  assert.match(result.response, /network drive/i);
  assert.equal(calls.length, 0, 'nothing may be trashed when the bin check fails');
});

test('delete is still refused entirely for unattended runs', async () => {
  const calls = [];
  const router = makeRouter(calls);
  const result = await router.handle('delete report', 'general', { unattended: true });
  assert.match(result.response, /at the desk/i);
  assert.equal(calls.length, 0);
  assert.equal(router.pending.size, 0);
});
