const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { classifyCommand } = require('../core/security');
const { mergeSettings } = require('../core/config-store');
const { DEFAULT_SETTINGS } = require('../core/defaults');
const { CommandRouter, cleanTarget, parseDueDate, extractFileQuery } = require('../core/router');
const { ToolService } = require('../core/tool-service');
const { AIService } = require('../core/ai-service');
const { buildDiagnosticReport } = require('../core/local-voice-service');
const layoutEngine = require('../src/layout-engine.js');
const { TaskStore, nextDueDate } = require('../core/task-store');

test('completing a repeating task schedules the next occurrence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-tasks-'));
  try {
    const store = new TaskStore(dir);
    const due = new Date(Date.now() - 3 * 86400000).toISOString(); // 3 days overdue
    const task = store.add({ title: 'Check the compressor', repeat: 'daily', dueAt: due });
    store.update(task.id, { status: 'done' });
    const open = store.list({ status: 'open' });
    assert.equal(open.length, 1);
    assert.equal(open[0].title, 'Check the compressor');
    assert.equal(open[0].repeat, 'daily');
    // The next occurrence is in the future, not stacked up in the past.
    assert.ok(new Date(open[0].dueAt) > new Date());
    // The completed copy no longer repeats, so it cannot double-spawn.
    const done = store.list({ status: 'done' });
    assert.equal(done[0].repeat, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('morning briefing reports tasks, notes, and PC status without AI', async () => {
  const router = new CommandRouter({
    config: { getSettings: () => ({ projects: {} }) },
    tools: {},
    ai: {},
    memory: { list: () => [{ text: 'Bench articles need a dek' }], search: () => [] },
    tasks: {
      summary: () => ({ open: 2, overdue: 1, tasks: [{ title: 'Call supplier', dueAt: new Date().toISOString() }] }),
      list: () => []
    },
    log: { write: () => {} }
  });
  const briefing = await router.handle('Morning briefing');
  assert.match(briefing.response, /2 open tasks, 1 overdue/);
  assert.match(briefing.response, /Call supplier/);
  assert.match(briefing.response, /Bench articles need a dek/);
  assert.match(briefing.response, /PC status/);
});

test('memory supports edit and forget', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-memory-'));
  try {
    const { MemoryStore } = require('../core/memory-store');
    const store = new MemoryStore(dir);
    const saved = store.add('Bench articles need a dek');
    store.add('Anvil invoices go out on Fridays');
    assert.ok(store.update(saved.id, 'Bench articles need a dek and a companion post'));
    const forgotten = store.forget('invoices Fridays');
    assert.match(forgotten.text, /invoices/);
    assert.equal(store.list(10).length, 1);
    assert.match(store.list(10)[0].text, /companion post/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('opening a file records it in recent files, folders are not recorded', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-recent-'));
  try {
    const filePath = path.join(dir, 'report.pdf');
    fs.writeFileSync(filePath, 'x');
    let saved = {};
    const svc = new ToolService({
      config: {
        getSettings: () => ({ recentFiles: saved.recentFiles || [] }),
        updateSettings: (patch) => { saved = { ...saved, ...patch }; }
      },
      shell: { openPath: async () => '' },
      app: null
    });
    await svc.openPath(filePath);
    await svc.openPath(dir);
    assert.equal(saved.recentFiles.length, 1);
    assert.equal(saved.recentFiles[0].name, 'report.pdf');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('nextDueDate rolls weekly and monthly forward past today', () => {
  const from = new Date('2026-07-13T09:00:00Z');
  assert.equal(nextDueDate('2026-07-06T09:00:00Z', 'weekly', from), new Date('2026-07-20T09:00:00Z').toISOString());
  assert.ok(new Date(nextDueDate(null, 'monthly', from)) > from);
  assert.equal(nextDueDate('2026-07-06T09:00:00Z', 'yearly', from), null);
});

test('file explorer hides broken junctions it can never open', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-explorer-'));
  try {
    fs.writeFileSync(path.join(base, 'notes.txt'), 'hello');
    const target = path.join(base, 'doomed');
    fs.mkdirSync(target);
    fs.symlinkSync(target, path.join(base, 'broken-junction'), 'junction');
    fs.rmdirSync(target);
    const svc = new ToolService({ config: { getSettings: () => ({}) }, shell: null, app: null });
    const items = await svc.listDirectory(base);
    assert.ok(items.some((item) => item.name === 'notes.txt'));
    assert.ok(!items.some((item) => item.name === 'broken-junction'));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('layout engine keeps modules inside the workspace at any size', () => {
  const { clampRect, resizeRect, findOpenSpace, nextZ } = layoutEngine;
  // Dragged past every boundary → pulled back inside.
  assert.deepEqual(clampRect({ x: -20, y: 130, w: 30, h: 40 }), { x: 0, y: 60, w: 30, h: 40 });
  // Resizing from the west edge cannot shrink below minimum or walk the module.
  const shrunk = resizeRect({ x: 40, y: 10, w: 30, h: 40 }, 'w', 25, 0);
  assert.equal(shrunk.w, layoutEngine.MIN_W);
  assert.equal(shrunk.x + shrunk.w, 70);
  // Resizing from the north-east corner grows both axes.
  const grown = resizeRect({ x: 10, y: 30, w: 30, h: 40 }, 'ne', 10, -10);
  assert.deepEqual({ w: grown.w, h: grown.h, y: grown.y }, { w: 40, h: 50, y: 20 });
  // A new module lands in empty space instead of on top of an existing one.
  const spot = findOpenSpace({ w: 24, h: 30 }, [{ x: 0, y: 0, w: 50, h: 100 }]);
  assert.ok(spot.x >= 50);
  // Bring-to-front always yields a higher stacking order.
  assert.equal(nextZ({ a: { z: 3 }, b: { z: 7 } }), 8);
});

test('voice diagnostic report states every check and omits secrets', () => {
  const report = buildDiagnosticReport({
    installed: true,
    running: true,
    wakeReady: false,
    python: '3.12.10',
    micPermission: 'granted',
    statusMessage: 'Local voice ready',
    whisperModel: 'small.en',
    checks: {
      microphone: { ok: true, detail: 'Realtek Audio' },
      speechModel: { ok: true, detail: 'small.en is ready' },
      wakeModel: { ok: false, detail: 'The hey_jarvis model files are not downloaded yet' }
    }
  });
  assert.match(report, /\[PASS\] Microphone permission/);
  assert.match(report, /\[PASS\] Python voice environment — Python 3\.12\.10/);
  assert.match(report, /\[FAIL\] Wake-word model/);
  assert.match(report, /\[FAIL\] Wake word listening/);
  // The report is safe to share: no keys, no paths into the user profile.
  assert.doesNotMatch(report, /sk-|api[_ ]?key/i);
});

test('security classifies safe, confirmation, and blocked commands', () => {
  assert.equal(classifyCommand('open Chrome').level, 'safe');
  assert.equal(classifyCommand('restart my computer').level, 'confirm');
  // Deletion is approval-gated in the router (Recycle Bin), not blocked here.
  assert.equal(classifyCommand('delete every old file').level, 'safe');
  assert.equal(classifyCommand('send the email').level, 'blocked');
});

test('router requires approval before moving a file to the Recycle Bin', async () => {
  let trashed = '';
  const router = new CommandRouter({
    config: { getSettings: () => ({ projects: {} }) },
    tools: {
      searchFiles: async () => [{ name: 'old-notes.txt', path: 'C:\\Docs\\old-notes.txt', score: 10 }]
    },
    documents: {
      trashItem: async (source) => { trashed = source; return { ok: true, message: 'Moved to Recycle Bin.' }; }
    },
    ai: {},
    memory: {},
    tasks: {},
    log: { write: () => {} }
  });

  const pending = await router.handle('Delete old notes');
  assert.ok(pending.approval?.id);
  assert.equal(pending.approval.risk, 'HIGH');
  assert.equal(trashed, '');

  const denied = await router.resolveApproval(pending.approval.id, false);
  assert.match(denied.response, /cancelled/i);
  assert.equal(trashed, '');

  const again = await router.handle('Delete old notes');
  const approved = await router.resolveApproval(again.approval.id, true);
  assert.equal(approved.success, true);
  assert.equal(trashed, 'C:\\Docs\\old-notes.txt');
});

test('settings merge preserves nested defaults', () => {
  const merged = mergeSettings(DEFAULT_SETTINGS, {
    aiMode: 'local',
    projects: { anvil: 'C:\\Anvil' }
  });
  assert.equal(merged.aiMode, 'local');
  assert.equal(merged.projects.anvil, 'C:\\Anvil');
  assert.equal(merged.projects.adamscraft, '');
  assert.ok(merged.applications.chrome);
  assert.ok(merged.moduleLayout['file-explorer']);
  assert.equal(mergeSettings(DEFAULT_SETTINGS, { ollamaUrl: 'http://bad-old-address:9999' }).ollamaUrl, 'http://127.0.0.1:11434');
});

test('local AI adopts an installed Ollama model when the configured model is absent', async () => {
  const originalFetch = global.fetch;
  let usedModel = '';
  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/api/tags')) {
      return new Response(JSON.stringify({ models: [{ name: 'llama3.2:3b' }] }), { status: 200 });
    }
    usedModel = JSON.parse(options.body).model;
    return new Response(JSON.stringify({ message: { content: 'Local response.' } }), { status: 200 });
  };
  try {
    const service = new AIService({ getSettings: () => ({ ollamaModel: 'qwen3:8b', assistantName: 'JARVIS', personality: 'Concise.' }) });
    const result = await service.reply('Hello');
    assert.equal(result.ok, true);
    assert.equal(usedModel, 'llama3.2:3b');
  } finally {
    global.fetch = originalFetch;
  }
});

test('local command helpers understand dates and file requests', () => {
  assert.ok(parseDueDate('tomorrow at 8 am'));
  assert.equal(parseDueDate('sometime later'), null);
  assert.equal(extractFileQuery('Locate and open the latest Anvil proposal'), 'the latest Anvil proposal');
});

test('command cleaning removes courtesy filler and trailing punctuation', () => {
  assert.equal(cleanTarget('Open Chrome for me, please.'), 'Open Chrome');
});

test('router handles memory and app commands without cloud AI', async () => {
  const calls = [];
  const memories = [];
  const router = new CommandRouter({
    config: { getSettings: () => ({ projects: {} }) },
    tools: {
      resolveApplication: (name) => name.toLowerCase().includes('chrome') ? { canonical: 'chrome' } : null,
      openApplication: async (name) => { calls.push(name); return { ok: true, message: `Opening ${name}.` }; },
      openFocusMode: async () => ({ ok: true, message: 'Focus mode active.' }),
      searchFiles: async () => [],
      openPath: async () => ({ ok: true, message: 'Opened.' }),
      executePowerAction: async () => ({ ok: true, message: 'Scheduled.' })
    },
    ai: { reply: async () => ({ ok: true, source: 'test', text: 'AI reply' }) },
    memory: {
      add: (text) => memories.push({ text }),
      search: (query) => memories.filter((item) => item.text.includes(query))
    },
    tasks: { list: () => [] },
    log: { write: () => {} }
  });

  const remembered = await router.handle('Remember that Bench articles need a dek');
  assert.match(remembered.response, /Remembered/);
  assert.equal(memories.length, 1);

  const opened = await router.handle('Open Chrome');
  assert.equal(opened.source, 'windows');
  assert.deepEqual(calls, ['Chrome']);
});

test('router requires approval before power action', async () => {
  let executed = false;
  const router = new CommandRouter({
    config: { getSettings: () => ({ projects: {} }) },
    tools: {
      executePowerAction: async () => { executed = true; return { ok: true, message: 'Scheduled.' }; }
    },
    ai: {},
    memory: {},
    tasks: {},
    log: { write: () => {} }
  });
  const pending = await router.handle('Restart my computer');
  assert.ok(pending.approval?.id);
  assert.equal(executed, false);
  const cancelled = await router.resolveApproval(pending.approval.id, false);
  assert.match(cancelled.response, /cancelled/i);
  assert.equal(executed, false);
});

test('router adds and returns local tasks', async () => {
  const stored = [];
  const router = new CommandRouter({
    config: { getSettings: () => ({ projects: { anvil: 'C:\\Anvil' } }) },
    tools: {},
    ai: {},
    memory: {},
    tasks: {
      add: (input) => { const task = { id: '1', status: 'open', ...input }; stored.push(task); return task; },
      list: () => stored,
      find: () => stored[0],
      update: () => stored[0]
    },
    log: { write: () => {} }
  });
  const result = await router.handle('Add task finish the Anvil landing page tomorrow');
  assert.equal(result.source, 'tasks');
  assert.equal(stored[0].project, 'anvil');
  assert.ok(stored[0].dueAt);
});

test('file locate command opens one confident local result', async () => {
  let opened = '';
  const router = new CommandRouter({
    config: { getSettings: () => ({ projects: {} }) },
    tools: {
      searchFiles: async () => [{ name: 'proposal.pdf', path: 'C:\\Docs\\proposal.pdf', score: 9 }],
      openPath: async (target) => { opened = target; return { ok: true }; }
    },
    ai: {}, memory: {}, tasks: {}, log: { write: () => {} }
  });
  const result = await router.handle('Locate proposal');
  assert.equal(result.source, 'files');
  assert.equal(opened, 'C:\\Docs\\proposal.pdf');
  assert.equal(result.openedFile.name, 'proposal.pdf');
});

test('local file search ranks content matches instead of every project file', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-search-'));
  const project = path.join(root, 'Anvil');
  fs.mkdirSync(path.join(project, 'Proposals'), { recursive: true });
  fs.writeFileSync(path.join(project, 'Proposals', 'Anvil_Proposal_FINAL.pdf'), 'proposal');
  fs.writeFileSync(path.join(project, 'Anvil_Logo.png'), 'logo');
  const service = new ToolService({
    config: { getSettings: () => ({ searchRoots: [root], projects: { anvil: project } }) },
    shell: {}, app: {}, emit: () => {}
  });
  const results = await service.searchFiles('latest Anvil proposal');
  assert.equal(results[0].name, 'Anvil_Proposal_FINAL.pdf');
  assert.equal(results.some((item) => item.name === 'Anvil_Logo.png'), false);
  fs.rmSync(root, { recursive: true, force: true });
});
