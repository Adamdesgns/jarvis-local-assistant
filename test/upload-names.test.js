const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DocumentService, isMeaninglessName, smartUploadName } = require('../core/document-service');

// --- isMeaninglessName: the pure decision function, tested directly ---

test('isMeaninglessName: a bare GUID (with dashes) is meaningless', () => {
  assert.equal(isMeaninglessName('9F4B5160-A908-4DEA-8D5F-76EFFBB43118'), true);
});

test('isMeaninglessName: a GUID wrapped in braces is meaningless', () => {
  assert.equal(isMeaninglessName('{9F4B5160-A908-4DEA-8D5F-76EFFBB43118}'), true);
});

test('isMeaninglessName: a GUID with no dashes at all is meaningless (all hex)', () => {
  assert.equal(isMeaninglessName('9F4B5160A9084DEA8D5F76EFFBB43118'), true);
});

test('isMeaninglessName: a lowercase content hash / all-hex string is meaningless', () => {
  assert.equal(isMeaninglessName('d41d8cd98f00b204e9800998ecf8427e'), true);
});

test('isMeaninglessName: a bare numeric name (no letters at all) is meaningless', () => {
  assert.equal(isMeaninglessName('20260720121600'), true);
});

test('isMeaninglessName: empty or whitespace-only is meaningless', () => {
  assert.equal(isMeaninglessName(''), true);
  assert.equal(isMeaninglessName('   '), true);
  assert.equal(isMeaninglessName(undefined), true);
});

test('isMeaninglessName: a genuinely meaningful name is left alone', () => {
  assert.equal(isMeaninglessName('invoice-march'), false);
  assert.equal(isMeaninglessName('photo'), false);
  assert.equal(isMeaninglessName('Vacation Photo'), false);
  assert.equal(isMeaninglessName('IMG_1234'), false); // has non-hex letters (I, M, G)
});

// --- smartUploadName: the fallback name generator ---

test('smartUploadName: image extensions get a "Phone photo" prefix with a real, dated timestamp', () => {
  const now = new Date(2026, 6, 20, 12, 16); // July is month index 6
  assert.equal(smartUploadName('.png', now), 'Phone photo 2026-07-20 12-16');
  assert.equal(smartUploadName('.HEIC', now), 'Phone photo 2026-07-20 12-16');
});

test('smartUploadName: non-image extensions get a "Phone file" prefix', () => {
  const now = new Date(2026, 6, 20, 12, 16);
  assert.equal(smartUploadName('.pdf', now), 'Phone file 2026-07-20 12-16');
});

// --- createBinaryFile: end-to-end through the real write path ---

test('createBinaryFile: a bare GUID filename is renamed to a findable, dated name, extension preserved', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-upload-names-'));
  try {
    const docs = new DocumentService({ config: { getSettings: () => ({ searchRoots: [dir], projects: {} }) }, shell: {}, emit: () => {} });
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const now = new Date(2026, 6, 20, 12, 16);

    const result = await docs.createBinaryFile(dir, '9F4B5160-A908-4DEA-8D5F-76EFFBB43118.png', buffer, now);
    assert.equal(result.ok, true);
    assert.equal(path.basename(result.path), 'Phone photo 2026-07-20 12-16.png');
    assert.equal(path.extname(result.path), '.png', 'original extension must be preserved');
    assert.ok(fs.readFileSync(result.path).equals(buffer));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('createBinaryFile: a GUID wrapped in braces is also renamed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-upload-names-braces-'));
  try {
    const docs = new DocumentService({ config: { getSettings: () => ({ searchRoots: [dir], projects: {} }) }, shell: {}, emit: () => {} });
    const buffer = Buffer.from('bytes');
    const now = new Date(2026, 6, 20, 8, 5);

    const result = await docs.createBinaryFile(dir, '{DFE176DD-D283-461B-B0D4-2BD575904524}.jpg', buffer, now);
    assert.equal(result.ok, true);
    assert.equal(path.basename(result.path), 'Phone photo 2026-07-20 08-05.jpg');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('createBinaryFile: a genuinely meaningful name arrives completely untouched', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-upload-names-meaningful-'));
  try {
    const docs = new DocumentService({ config: { getSettings: () => ({ searchRoots: [dir], projects: {} }) }, shell: {}, emit: () => {} });
    const buffer = Buffer.from('pdf bytes');

    const result = await docs.createBinaryFile(dir, 'invoice-march.pdf', buffer);
    assert.equal(result.ok, true);
    assert.equal(path.basename(result.path), 'invoice-march.pdf');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('createBinaryFile: a meaningless name with no recognized image extension gets the "Phone file" prefix, extension still preserved', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-upload-names-doc-'));
  try {
    const docs = new DocumentService({ config: { getSettings: () => ({ searchRoots: [dir], projects: {} }) }, shell: {}, emit: () => {} });
    const buffer = Buffer.from('bytes');
    const now = new Date(2026, 6, 20, 12, 16);

    const result = await docs.createBinaryFile(dir, '9F4B5160-A908-4DEA-8D5F-76EFFBB43118.pdf', buffer, now);
    assert.equal(path.basename(result.path), 'Phone file 2026-07-20 12-16.pdf');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('createBinaryFile: a traversal-style filename still cannot escape the destination, even when it happens to be meaningless', async () => {
  // Nested two levels inside a sandbox we own, matching the pattern used in
  // test/mobile-server.test.js's own namejail test, so "../../evil" resolves
  // to somewhere inside the sandbox we can safely assert on and clean up.
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-upload-names-namejail-'));
  const dir = path.join(sandbox, 'nested', 'dest');
  fs.mkdirSync(dir, { recursive: true });
  try {
    const docs = new DocumentService({ config: { getSettings: () => ({ searchRoots: [dir], projects: {} }) }, shell: {}, emit: () => {} });
    const buffer = Buffer.from('payload');

    // An all-hex traversal-shaped name: meaningless AND traversal-shaped at once.
    const result = await docs.createBinaryFile(dir, '../../deadbeef.png', buffer);
    assert.equal(result.ok, true);
    assert.equal(path.dirname(result.path), dir, 'must resolve inside the destination, never above it');

    const escapeTarget = path.join(dir, '..', '..', 'deadbeef.png');
    assert.ok(!fs.existsSync(escapeTarget), 'traversal must not have escaped above the destination');
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('createBinaryFile: extension is always preserved, whatever the extension is', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-upload-names-ext-'));
  try {
    const docs = new DocumentService({ config: { getSettings: () => ({ searchRoots: [dir], projects: {} }) }, shell: {}, emit: () => {} });
    const buffer = Buffer.from('bytes');
    const now = new Date(2026, 6, 20, 12, 16);

    for (const ext of ['.png', '.jpg', '.heic', '.mov', '.pdf']) {
      const result = await docs.createBinaryFile(dir, `ABCDEF1234567890ABCDEF1234567890${ext}`, buffer, now);
      assert.equal(path.extname(result.path), ext, `extension ${ext} must survive the rename`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
