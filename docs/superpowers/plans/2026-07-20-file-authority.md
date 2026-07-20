# File Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Adam asks (desktop or phone), JARVIS moves/copies/renames/organizes files immediately with no approval card, and "delete" means the Recycle Bin — refused outright when the bin won't actually catch the file.

**Architecture:** The approval-card machinery stays for power actions but stops wrapping file work. A new `DocumentService.canRecycle()` gates every trash. `applyOrganization` gains the collision dedupe the other operations already have. The unattended guard is untouched.

**Tech Stack:** Node built-ins (`fs`, `path`), Electron `shell.trashItem`, `node:test`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-20-file-authority-design.md` — read it first.
- Branch `file-authority`. Commit per task. Do not push unless asked.
- `npm test` green after every task. **Baseline 217.**
- **The unattended guard must not weaken.** `stream.unattended === true` still refuses every file operation before anything runs. `test/router-unattended.test.js` must keep passing **unchanged** — if a change there seems necessary, stop and escalate.
- **No permanent-delete path may be introduced.** Deletion goes through `this.shell.trashItem` only. Never `fs.unlink`, never `fs.rm` on a user-named target. (`moveItem`'s existing `EXDEV` fallback is untouched.)
- Approved-folder checks (`isAllowed`) stay on every operation, source and destination.
- Power actions (shutdown/restart) keep their approval card — that machinery stays.
- JARVIS's voice: plain, direct, "sir" where it already appears. Refusals say *why* and hand the job back.

## File Map

| File | Change |
|---|---|
| `core/document-service.js` | new `canRecycle(target)`; `applyOrganization` collision dedupe |
| `core/router.js` | `#fileApproval` → `#runFileAction` (executes); delete branch gains the bin check |
| `core/ai-service.js` | system-prompt wording for the new file rules |
| `test/core.test.js` | replace the trash-approval test; repoint the `/approval card/` assertion |
| `test/file-authority.test.js` | **new** — `canRecycle`, organize dedupe, attended execution |
| `docs/FILE-AUTHORITY-CHECKLIST.md` | **new** — manual checklist |
| `package.json`, `CHANGELOG.md` | version 0.15.0 |

---

### Task 1: `canRecycle` + organize collision dedupe

**Files:**
- Modify: `core/document-service.js`
- Test: `test/file-authority.test.js` (create)

**Interfaces:**
- Produces (used by Task 3): `canRecycle(target)` → `{ ok: true }` | `{ ok: false, reason: string }`.

- [ ] **Step 1: Write the failing tests** — create `test/file-authority.test.js`:

```js
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
```

- [ ] **Step 2: Run and watch them fail**

Run: `node --test test/file-authority.test.js`
Expected: FAIL — `docs.canRecycle is not a function`, and the organize test fails because the original file is overwritten.

- [ ] **Step 3: Implement** — in `core/document-service.js`, add the constant near the top (beside the other module constants):

```js
// Windows permanently erases items the Recycle Bin can't hold, so JARVIS
// refuses those rather than destroying something he was asked to "delete".
const RECYCLE_MAX_BYTES = 2 * 1024 * 1024 * 1024;
```

Add `canRecycle` as a method on `DocumentService`, immediately above `trashItem`:

```js
  // Is this item one the Recycle Bin will actually catch? Windows silently
  // erases for good on network shares, on volumes without a bin (most USB
  // sticks), and for items over the bin's quota. JARVIS refuses those.
  canRecycle(target) {
    if (!this.isAllowed(target)) return { ok: false, reason: 'That item is outside your approved folders.' };
    const resolved = path.resolve(target);
    if (resolved.startsWith('\\\\')) {
      return { ok: false, reason: "That's on a network drive, which has no Recycle Bin — I'd have to erase it for good. I'd rather you did that one yourself, sir." };
    }
    const root = path.parse(resolved).root;
    if (!root || !fs.existsSync(path.join(root, '$Recycle.Bin'))) {
      return { ok: false, reason: "That drive has no Recycle Bin, so deleting would erase it for good. I'd rather you did that one yourself, sir." };
    }
    let stats;
    try { stats = fs.statSync(resolved); } catch { return { ok: false, reason: "I couldn't find that item." }; }
    if (stats.isFile() && stats.size > RECYCLE_MAX_BYTES) {
      return { ok: false, reason: "That file is too big for the Recycle Bin — Windows would erase it for good. I'd rather you did that one yourself, sir." };
    }
    return { ok: true };
  }
```

Replace `applyOrganization`'s body with the deduping version:

```js
  async applyOrganization(plan) {
    let moved = 0;
    for (const item of plan.moves || []) {
      if (!this.isAllowed(item.source) || !this.isAllowed(item.destination)) continue;
      await fs.promises.mkdir(item.destination, { recursive: true });
      // Organizing runs without an approval card now, so a name collision must
      // never destroy the file already sitting there.
      const extension = path.extname(item.source);
      const base = path.basename(item.source, extension);
      let target = path.join(item.destination, path.basename(item.source));
      let count = 2;
      while (fs.existsSync(target)) target = path.join(item.destination, `${base} ${count++}${extension}`);
      await fs.promises.rename(item.source, target);
      moved += 1;
    }
    return { ok: true, message: `Organized ${moved} file${moved === 1 ? '' : 's'} into labeled folders.` };
  }
```

- [ ] **Step 4: Run tests**

Run: `node --test test/file-authority.test.js` — expect PASS (6 tests). Then `npm test` — expect 223 passing.

- [ ] **Step 5: Commit**

```bash
git add core/document-service.js test/file-authority.test.js
git commit -m "feat(files): canRecycle guard and collision-safe organize"
```

---

### Task 2: Move/copy/rename/organize execute immediately

**Files:**
- Modify: `core/router.js`
- Test: `test/file-authority.test.js` (extend)

**Interfaces:**
- Consumes: `documents.copyItem/moveItem/renameItem/applyOrganization` (existing).
- Produces: private `async #runFileAction(operation, source, extra, stream)` on `CommandRouter`.

- [ ] **Step 1: Write the failing tests** — append to `test/file-authority.test.js`:

```js
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
```

- [ ] **Step 2: Run and watch them fail**

Run: `node --test test/file-authority.test.js`
Expected: FAIL — the results still carry an `approval` object and `pending.size` is 1.

- [ ] **Step 3: Implement** — in `core/router.js`, replace the whole `#fileApproval` method with:

```js
  // Owner-issued file work runs immediately: the approved-folder boundary and
  // the no-overwrite guards are the safety, not the dialog. Unattended runs
  // (scheduled tasks) are still refused before anything touches disk.
  async #runFileAction(operation, source, extra, stream = {}) {
    if (stream.unattended) {
      return this.#result(`This file action needs you at the desk, sir — I've left it for you.`, 'safety', { success: false });
    }
    try {
      let outcome;
      if (operation === 'copy') outcome = await this.documents.copyItem(source, extra.destination);
      else if (operation === 'move') outcome = await this.documents.moveItem(source, extra.destination);
      else if (operation === 'rename') outcome = await this.documents.renameItem(source, extra.newName);
      else if (operation === 'organize') outcome = await this.documents.applyOrganization(extra.plan);
      else return this.#result('I do not know that file action.', 'documents', { success: false });
      return this.#result(outcome.message, 'documents', { success: Boolean(outcome && outcome.ok) });
    } catch (error) {
      return this.#result(error.message, 'documents', { success: false });
    }
  }
```

Update the four call sites (copy/move ~line 290, rename ~line 295, organize ~line 310) to await the new method and drop the now-unused title/detail arguments:

```js
      else result = await this.#runFileAction(operation.toLowerCase(), source.path, { destination }, stream);
```

```js
      result = source
        ? await this.#runFileAction('rename', source.path, { newName }, stream)
        : this.#result(`I couldn't find “${query}.”`, 'documents', { success: false });
```

```js
          result = await this.#runFileAction('organize', plan.directory, { plan }, stream);
```

Leave the trash branch alone — Task 3 handles it.

- [ ] **Step 4: Run tests**

Run: `node --test test/file-authority.test.js` then `npm test`.
Expected: the three new tests PASS. **`test/router-unattended.test.js` must still pass unchanged** — if its "attended … still queues a pending approval" assertions now fail for move/rename/organize, update only those attended assertions to expect immediate execution; the unattended ones must not change.

- [ ] **Step 5: Commit**

```bash
git add core/router.js test/file-authority.test.js test/router-unattended.test.js
git commit -m "feat(files): owner file moves run without an approval card"
```

---

### Task 3: Delete means the Recycle Bin, bin-checked

**Files:**
- Modify: `core/router.js` (the delete/trash branch, ~line 297)
- Test: `test/file-authority.test.js` (extend)

**Interfaces:**
- Consumes: `documents.canRecycle(target)` from Task 1; `#runFileAction`'s unattended-refusal wording from Task 2.

- [ ] **Step 1: Write the failing tests** — append:

```js
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
```

- [ ] **Step 2: Run and watch them fail**

Run: `node --test test/file-authority.test.js`
Expected: FAIL — delete still returns an approval object.

- [ ] **Step 3: Implement** — replace the delete/trash branch in `core/router.js`:

```js
    } else if (this.documents && /^(?:delete|trash|remove)\s+(.+)$/i.test(text)) {
      const query = text.match(/^(?:delete|trash|remove)\s+(.+)$/i)[1];
      const source = (await this.tools.searchFiles(query))[0];
      if (!source) {
        result = this.#result(`I couldn't find “${query}.”`, 'documents', { success: false });
      } else if (stream.unattended) {
        result = this.#result(`This file action needs you at the desk, sir — I've left it for you.`, 'safety', { success: false });
      } else {
        // "Delete" means the Recycle Bin and nothing more — and only when the
        // bin will really catch it. JARVIS has no permanent-erase capability.
        const check = this.documents.canRecycle(source.path);
        if (!check.ok) {
          result = this.#result(check.reason, 'documents', { success: false });
        } else {
          try {
            const outcome = await this.documents.trashItem(source.path);
            result = this.#result(outcome.message, 'documents', { success: Boolean(outcome && outcome.ok) });
          } catch (error) {
            result = this.#result(error.message, 'documents', { success: false });
          }
        }
      }
    }
```

- [ ] **Step 4: Run tests**

Run: `node --test test/file-authority.test.js` then `npm test`.
The old `test/core.test.js` test `'router requires approval before moving a file to the Recycle Bin'` (~line 661) now describes behaviour that no longer exists — **replace it** with one asserting delete trashes immediately and raises no approval, keeping the power-action approval test beside it untouched.

- [ ] **Step 5: Commit**

```bash
git add core/router.js test/file-authority.test.js test/core.test.js
git commit -m "feat(files): delete goes straight to the Recycle Bin, refused when the bin cannot hold it"
```

---

### Task 4: Tell the model the new rules

**Files:**
- Modify: `core/ai-service.js` (~line 75, inside `prompt()`)
- Test: `test/core.test.js` (~line 519, the `/approval card/` assertion)

- [ ] **Step 1: Read the current line.** In `core/ai-service.js`'s `prompt()`, this line is now wrong twice over — it says deleting is outside his tools *and* tells him to route the user to an approval card that no longer appears for files:

```js
      '- Deleting, sending, buying, and power controls are deliberately outside your tools. If asked, say the direct command (like "delete <file>") so JARVIS can show its approval card.',
```

- [ ] **Step 2: Replace it** with two lines that match reality:

```js
      '- File work he asks for happens directly: moving, copying, renaming and organizing inside his approved folders need no confirmation.',
      '- "Delete" means the Windows Recycle Bin, and JARVIS refuses it when the bin cannot hold the item. Permanently erasing files is not something you can do. Sending, buying, and power controls remain outside your tools.',
```

- [ ] **Step 3: Repoint the stale test.** `test/core.test.js` ~line 519 asserts the prompt matches `/approval card/`. Power actions still use approval cards, so change the assertion to check the surviving behaviour instead:

```js
  assert.match(prompt, /Recycle Bin/);
  assert.match(prompt, /Permanently erasing files is not something you can do/);
```

- [ ] **Step 4: Run** `npm test` — green.

- [ ] **Step 5: Commit**

```bash
git add core/ai-service.js test/core.test.js
git commit -m "docs(brain): system prompt states the new file rules"
```

---

### Task 5: Phone behaviour, checklist, version

**Files:**
- Test: `test/mobile-server.test.js` (extend)
- Create: `docs/FILE-AUTHORITY-CHECKLIST.md`
- Modify: `package.json`, `CHANGELOG.md`

- [ ] **Step 1: Prove the phone now does file work.** `core/mobile-server.js#chat` auto-declines anything with `result.approval`. File operations no longer produce one, so they flow through — add a test asserting it, beside the existing `'#chat: an approval-shaped router result…'` test (~line 125), which must keep passing for power actions:

```js
test('#chat: a file result from the phone comes back as the real outcome, not a desktop redirect', async () => {
  const auth = new MobileAuth({ now: () => 0 });
  const { code } = auth.startPairing();
  const server = new MobileServer({
    auth,
    router: { handle: async () => ({ response: 'Moved report.pdf.', success: true }) },
    transcribe: async () => '', config: { getSettings: () => ({}) }, staticDir: __dirname,
    documents: { approvedRoots: () => [] }
  });
  const pair = fakeRes();
  await server.handleRequest(jsonReq('POST', '/api/pair', { code, name: 'iPhone' }), pair);
  const { key } = JSON.parse(pair.body);

  const res = fakeRes();
  await server.handleRequest(jsonReq('POST', '/api/chat', { text: 'move report to archive' }, { authorization: `Bearer ${key}` }), res);
  assert.equal(JSON.parse(res.body).reply, 'Moved report.pdf.');
  assert.doesNotMatch(JSON.parse(res.body).reply, /at the desktop/i);
});
```

- [ ] **Step 2: Write `docs/FILE-AUTHORITY-CHECKLIST.md`.** Match the tone of `docs/SCHEDULE-TESTING-CHECKLIST.md` (read it first) — numbered, one action per step, and what he should see. Cover: put two files in Downloads and tell JARVIS to organize it, confirm it happens with no dialog; tell him to move a named file to another approved folder; rename one; put a file with a name that already exists in the target category folder and confirm organizing keeps BOTH (the older one untouched, the new one renamed `… 2`); tell him to delete something in Downloads and confirm it lands in the Recycle Bin and can be restored; copy a file to a USB stick, tell him to delete that copy, and confirm he refuses and explains why; ask him to delete something from the **phone** and confirm the same behaviour; confirm a scheduled task still refuses file work.

- [ ] **Step 3: Version.** `package.json` → `0.15.0`. CHANGELOG entry matching the file's existing style: "0.15.0 — File authority: moves, copies, renames and organizing happen on request without an approval card; 'delete' means the Recycle Bin and is refused when the bin cannot hold the item; permanent erasure remains impossible."

- [ ] **Step 4: Run** `npm test` — green. Then a headless boot check: set `JARVIS_CAPTURE_PATH` to a temp png, `npm start`, confirm it writes the png and exits cleanly, delete the png.

- [ ] **Step 5: Commit**

```bash
git add test/mobile-server.test.js docs/FILE-AUTHORITY-CHECKLIST.md package.json CHANGELOG.md
git commit -m "docs(files): phone file-work test, checklist, version 0.15.0"
```

---

## Self-Review

- **Spec coverage:** approval card retires (T2), Recycle-Bin safety check (T1 + T3), organize collision fix (T1), phone executes file work (T5), prompt wording (T4), version/checklist (T5). Unattended guard preserved — asserted in T2 step 4 and T3's third test.
- **Type consistency:** `canRecycle(target) → { ok, reason? }` and `#runFileAction(operation, source, extra, stream)` are used identically across T1-T3.
- **Placeholders:** none — every step carries real code or an exact command.
- **Known risk flagged for the reviewer:** the delete regex `^(?:delete|trash|remove)\s+(.+)$` is broad ("remove the extra spacing from my resume" matches). Behaviour is unchanged by this plan — it already matched — but it now trashes rather than showing a card first. Worth a follow-up ticket to tighten the regex; not in scope here.
