const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { classifyCommand } = require('../core/security');
const { mergeSettings, ConfigStore } = require('../core/config-store');
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

test('opening a folder dispatches Explorer without waiting for shell completion', async () => {
  const { EventEmitter } = require('node:events');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-explorer-open-'));
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  let platformOverridden = false;
  try {
    if (process.platform !== 'win32') {
      try {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        platformOverridden = true;
      } catch {
        return;
      }
    }
    let saved = {};
    let shellCalled = false;
    let launched = null;
    const svc = new ToolService({
      config: {
        getSettings: () => ({ recentFiles: saved.recentFiles || [] }),
        updateSettings: (patch) => { saved = { ...saved, ...patch }; }
      },
      shell: { openPath: async () => { shellCalled = true; return new Promise(() => {}); } },
      app: null,
      launchProcess: (command, args, options) => {
        launched = { command, args, options };
        const child = new EventEmitter();
        child.unref = () => { child.unrefCalled = true; };
        return child;
      }
    });
    const start = Date.now();
    const result = await svc.openPath(dir);
    assert.equal(result.ok, true);
    assert.ok(Date.now() - start < 200);
    assert.equal(shellCalled, false);
    assert.equal(launched.command, 'explorer.exe');
    assert.deepEqual(launched.args, [dir]);
    assert.equal(launched.options.detached, true);
    assert.equal(saved.recentFiles, undefined);
  } finally {
    if (platformOverridden) Object.defineProperty(process, 'platform', platformDescriptor);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('folder watch notifies once for a burst of matching changes', async () => {
  const { FolderWatchService, matchesPattern } = require('../core/folder-watch');
  assert.ok(matchesPattern('report.pdf', '*.pdf'));
  assert.ok(!matchesPattern('report.docx', '*.pdf'));
  assert.ok(matchesPattern('anything.txt', '*'));
  assert.ok(matchesPattern('Invoice-July.xlsx', 'invoice'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-watch-'));
  try {
    const notifications = [];
    const svc = new FolderWatchService({
      config: { getSettings: () => ({ watchedFolders: [{ path: dir, pattern: '*' }] }) },
      notify: (title, body) => notifications.push(body),
      emit: () => {}
    });
    assert.equal(svc.start(), 1);
    fs.writeFileSync(path.join(dir, 'new-drawing.pdf'), 'x');
    fs.writeFileSync(path.join(dir, 'second.pdf'), 'x');
    await new Promise((resolve) => setTimeout(resolve, 600));
    svc.stop();
    assert.equal(notifications.length, 1);
    assert.match(notifications[0], /changed in/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('document Q&A gathers relevant passages and answers with citations', async () => {
  const { DocumentService } = require('../core/document-service');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-docqa-'));
  try {
    fs.writeFileSync(path.join(dir, 'compressor.txt'),
      'The Ingersoll Rand compressor requires SAE 30 oil. '.repeat(3) +
      '\n\nDrain the tank weekly to prevent rust. Torque the head bolts to 25 foot pounds.');
    fs.writeFileSync(path.join(dir, 'unrelated.txt'), 'Grocery list: milk, eggs, bread.');
    const docs = new DocumentService({ config: { getSettings: () => ({ searchRoots: [dir], projects: {} }) }, shell: {}, emit: () => {} });

    const passages = await docs.gatherPassages('what oil does the compressor take');
    assert.ok(passages.length >= 1);
    assert.match(passages[0].text, /SAE 30/);
    assert.equal(passages[0].name, 'compressor.txt');
    assert.equal(passages[0].section, 1); // text file cites by section

    // answerFromDocuments must pass sources through and label them for citation.
    const ai = new AIService({ getSettings: () => ({ aiMode: 'local' }), getSecret: () => '' });
    let capturedSystem = '';
    ai.localReply = async (question, ctx) => { capturedSystem = ctx.systemOverride; return { ok: true, source: 'ollama', text: 'It takes SAE 30 oil [1].' }; };
    const answer = await ai.answerFromDocuments('what oil?', passages);
    assert.match(capturedSystem, /\[1\] compressor\.txt/);
    assert.match(capturedSystem, /only the passages/i);
    assert.equal(answer.sources[0].name, 'compressor.txt');
    assert.match(answer.text, /\[1\]/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('createBinaryFile writes a Buffer verbatim, sanitises the name, dedupes collisions, and refuses unapproved locations', async () => {
  const { DocumentService } = require('../core/document-service');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-binfile-'));
  try {
    const docs = new DocumentService({ config: { getSettings: () => ({ searchRoots: [dir], projects: {} }) }, shell: {}, emit: () => {} });
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x01]); // binary bytes, not valid utf8 text

    const result = await docs.createBinaryFile(dir, 'photo.png', buffer);
    assert.equal(result.ok, true);
    assert.equal(result.path, path.join(dir, 'photo.png'));
    const written = fs.readFileSync(result.path);
    assert.ok(written.equals(buffer), 'buffer must be written byte-for-byte, not stringified');

    // Collisions dedupe the same way createTextFile does.
    const again = await docs.createBinaryFile(dir, 'photo.png', buffer);
    assert.equal(again.path, path.join(dir, 'photo 2.png'));

    // A destination outside approved roots must be refused, matching createTextFile's guard.
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-binfile-outside-'));
    try {
      await assert.rejects(() => docs.createBinaryFile(outsideDir, 'x.png', buffer), /approve/i);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }

    // Path separators and traversal sequences in the filename must not escape the destination.
    const traversal = await docs.createBinaryFile(dir, '../../evil.png', buffer);
    assert.ok(traversal.path.startsWith(dir + path.sep) || traversal.path === dir);
    assert.equal(path.dirname(traversal.path), dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('project dashboard summarizes that project only', async () => {
  const router = new CommandRouter({
    config: { getSettings: () => ({ projects: { anvil: 'C:\\Anvil', 'the bench': '' } }) },
    tools: { listDirectory: async () => [{ name: 'plan.pdf', path: 'C:\\Anvil\\plan.pdf', type: 'file' }] },
    ai: { reply: async () => ({ ok: true, text: 'x' }) },
    memory: { list: () => [{ text: 'Anvil invoices Fridays', project: 'anvil' }, { text: 'unrelated', project: 'general' }], search: () => [] },
    tasks: { list: ({ project }) => project === 'anvil' ? [{ title: 'ship order', project: 'anvil', status: 'open' }] : [] },
    log: { write: () => {} }
  });
  const result = await router.handle('show my anvil dashboard');
  assert.match(result.response, /ANVIL dashboard/);
  assert.match(result.response, /ship order/);
  assert.match(result.response, /invoices Fridays/);
  assert.equal(result.files[0].name, 'plan.pdf');
  // Only the anvil project's tasks come back, not general.
  assert.ok(result.tasks.every((t) => t.project === 'anvil'));
});

test('update check compares versions and reads the latest release', async () => {
  const { compareVersions, checkForUpdate } = require('../core/update-check');
  assert.equal(compareVersions('0.11.0', '0.10.0'), 1);
  assert.equal(compareVersions('v0.10.0', '0.10.0'), 0);   // v-prefix tolerated
  assert.equal(compareVersions('0.9', '0.9.1'), -1);        // uneven segment counts
  assert.equal(compareVersions('1.0.0', '0.99.99'), 1);

  const stub = async () => ({ ok: true, json: async () => ({ tag_name: 'v0.12.0', html_url: 'https://github.com/a/b/releases/tag/v0.12.0' }) });
  const newer = await checkForUpdate('0.11.0', 'a/b', stub);
  assert.equal(newer.updateAvailable, true);
  assert.equal(newer.latest, '0.12.0');
  assert.match(newer.url, /releases/);

  const same = await checkForUpdate('0.12.0', 'a/b', stub);
  assert.equal(same.updateAvailable, false);

  // A network failure must fail soft, never throw.
  const boom = await checkForUpdate('0.11.0', 'a/b', async () => { throw new Error('offline'); });
  assert.equal(boom.updateAvailable, false);

  // An unconfigured repo returns no update without even calling fetch.
  const unset = await checkForUpdate('0.11.0', 'OWNER/REPO', async () => { throw new Error('should not be called'); });
  assert.equal(unset.updateAvailable, false);
});

test('screen vision refuses without a cloud key', async () => {
  const ai = new AIService({ getSettings: () => ({ aiMode: 'local' }), getSecret: () => '' });
  await assert.rejects(() => ai.describeImage('AAAA', 'what is this?'), /No Cloud Brain key/);
});

test('backup import merges tasks and notes without duplicating', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-backup-'));
  try {
    const { MemoryStore } = require('../core/memory-store');
    const tasks = new TaskStore(dir);
    const memory = new MemoryStore(dir);
    tasks.add({ title: 'existing task' });
    memory.add('existing note');

    const addedTasks = tasks.importTasks([
      { title: 'existing task', status: 'open' },       // duplicate → skipped
      { title: 'imported task', dueAt: null, priority: 'high' }
    ]);
    const addedMemories = memory.importMemories([
      { text: 'existing note' },                          // duplicate → skipped
      { text: 'imported note' }
    ]);
    assert.equal(addedTasks, 1);
    assert.equal(addedMemories, 1);
    assert.equal(tasks.list().length, 2);
    assert.equal(memory.list(10).length, 2);
    assert.equal(tasks.list().find((t) => t.title === 'imported task').priority, 'high');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cloud provider selection honors preference then falls back to available key', () => {
  const make = (provider, keys) => new AIService({
    getSettings: () => ({ cloudProvider: provider }),
    getSecret: (name) => (keys[name] ? 'x' : '')
  });
  // Preference wins when its key exists.
  assert.equal(make('anthropic', { anthropicKey: true, openaiKey: true }).cloudProvider(), 'anthropic');
  assert.equal(make('openai', { anthropicKey: true, openaiKey: true }).cloudProvider(), 'openai');
  // Falls back to whichever key is present when the preferred one is missing.
  assert.equal(make('anthropic', { openaiKey: true }).cloudProvider(), 'openai');
  assert.equal(make('openai', { anthropicKey: true }).cloudProvider(), 'anthropic');
  // No keys → no cloud.
  assert.equal(make('anthropic', {}).cloudProvider(), null);
  assert.equal(make('anthropic', {}).hasCloudKey(), false);
});

test('brain that adds a task via a tool returns the fresh list to redraw', async () => {
  const open = [{ id: '1', title: 'buy pipe dope', project: 'general', status: 'open' }];
  const router = new CommandRouter({
    config: { getSettings: () => ({ projects: {} }) },
    tools: {},
    // Simulate the model deciding to call add_task for a compound sentence.
    ai: { reply: async () => ({ ok: true, source: 'ollama', text: 'Added buy pipe dope.', usedTools: ['add_task'] }) },
    memory: { search: () => [], list: () => [] },
    tasks: { list: () => open },
    log: { write: () => {} }
  });
  const result = await router.handle('add buying pipe dope to my list and then tell me everything on my list');
  // The result must carry the tasks so the module redraws instead of showing stale "0 OPEN".
  assert.ok(Array.isArray(result.tasks));
  assert.equal(result.tasks[0].title, 'buy pipe dope');
});

test('router answers simple small talk locally without invoking AI', async () => {
  let aiCalled = false;
  const router = new CommandRouter({
    config: { getSettings: () => ({ projects: {} }) },
    tools: {},
    ai: { reply: async () => { aiCalled = true; return { ok: true, source: 'test', text: 'wrong path' }; } },
    memory: { search: () => [], list: () => [] },
    tasks: { list: () => [] },
    log: { write: () => {} }
  });
  const result = await router.handle('How are you doing?');
  assert.equal(result.source, 'local-core');
  assert.equal(aiCalled, false);
  assert.doesNotMatch(result.response, /what do you want|what needs doing|today/i);
});

test('saved routines open their apps and folders', async () => {
  const opened = [];
  const router = new CommandRouter({
    config: {
      getSettings: () => ({
        projects: { anvil: 'C:\\Anvil' },
        routines: { 'start work': { apps: ['chrome'], folders: ['anvil'] } }
      })
    },
    tools: {
      openApplication: async (name) => { opened.push(name); return { ok: true, message: 'ok' }; },
      openPath: async (target) => { opened.push(target); return { ok: true, message: 'ok' }; },
      resolveApplication: () => null
    },
    ai: {},
    memory: { search: () => [] },
    tasks: {},
    log: { write: () => {} }
  });
  const result = await router.handle('Start work');
  assert.match(result.response, /start work routine/i);
  assert.deepEqual(opened, ['chrome', 'C:\\Anvil']);
  const alias = await router.handle('Run my start work routine');
  assert.match(alias.response, /opened/i);
});

test('tool registry exposes only safe tools and executes them', async () => {
  const { buildToolRegistry, toolSpecs, executeToolCall } = require('../core/tool-registry');
  const added = [];
  const registry = buildToolRegistry({
    tools: { searchFiles: async () => [{ name: 'a.pdf', path: 'C:\\a.pdf', score: 5 }], openApplication: async (name) => ({ ok: true, message: `Opening ${name}.` }) },
    tasks: { add: (input) => { added.push(input); return input; }, list: () => [] },
    memory: { add: (text) => ({ text }), search: () => [] },
    config: {}
  });
  const names = registry.map((tool) => tool.name);
  // Destructive or approval-gated actions must never be model-callable.
  for (const banned of ['delete', 'trash', 'move', 'rename', 'organize', 'shutdown', 'power', 'shell', 'exec']) {
    assert.ok(!names.some((name) => name.includes(banned)), `registry must not expose ${banned}`);
  }
  assert.equal(new Set(names).size, names.length);
  const specs = toolSpecs(registry);
  assert.ok(specs.every((spec) => spec.type === 'function' && spec.function.name && spec.function.parameters));
  const result = await executeToolCall(registry, { function: { name: 'add_task', arguments: '{"title":"Order fittings"}' } });
  assert.equal(result.ok, true);
  assert.equal(added[0].title, 'Order fittings');
  const unknown = await executeToolCall(registry, { function: { name: 'run_shell', arguments: '{}' } });
  assert.equal(unknown.ok, false);
});

test('tool registry returns an error when a tool call times out', async () => {
  const { executeToolCall } = require('../core/tool-registry');
  const result = await executeToolCall([{
    name: 'slow_tool',
    timeoutMs: 20,
    execute: async () => new Promise(() => {})
  }], { function: { name: 'slow_tool', arguments: '{}' } });
  assert.equal(result.ok, false);
  assert.match(result.error, /timed out/);
});

test('AI service keeps per-project sessions and resets them', () => {
  const { AIService } = require('../core/ai-service');
  const ai = new AIService({ getSettings: () => ({}), getSecret: () => '' });
  ai.resetSession('anvil');
  const history = (project) => ai.sessions.get(project) || [];
  ai.sessions.set('anvil', [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }]);
  assert.equal(history('anvil').length, 2);
  ai.resetSession('anvil');
  assert.equal(history('anvil').length, 0);
  const prompt = ai.prompt({ personality: 'calm' }, { project: 'anvil', memories: [], tasks: [] });
  assert.match(prompt, /anvil project/);
  // The Fable-style behavior rules must stay in the brain prompt.
  assert.match(prompt, /Lead with the answer/);
  assert.match(prompt, /Never claim a computer action happened/);
  assert.match(prompt, /Never invent file names/);
  assert.match(prompt, /Casual greetings and "how are you" are small talk/);
  assert.match(prompt, /approval card/);
});

test('stream accumulator collects text and tool calls; cancel is safe when idle', () => {
  const { accumulateStreamChunk, AIService } = require('../core/ai-service');
  const state = { content: '', toolCalls: [] };
  accumulateStreamChunk(state, { message: { content: 'Hel' } });
  accumulateStreamChunk(state, { message: { content: 'lo' } });
  accumulateStreamChunk(state, { message: { tool_calls: [{ function: { name: 'add_task', arguments: '{}' } }] } });
  accumulateStreamChunk(state, {});
  assert.equal(state.content, 'Hello');
  assert.equal(state.toolCalls.length, 1);
  const ai = new AIService({ getSettings: () => ({}), getSecret: () => '' });
  ai.cancel(); // no active request: must not throw
  assert.equal(ai.cancelledByUser, true);
});

test('ask my documents retrieves passages and demands cited answers', async () => {
  const passages = [{ name: 'weld-specs.pdf', path: 'C:\\Docs\\weld-specs.pdf', page: 3, score: 4, text: 'Preheat to 250F before welding P91 pipe.' }];
  let receivedPassages = null;
  const router = new CommandRouter({
    config: { getSettings: () => ({ projects: {} }) },
    tools: {},
    documents: { gatherPassages: async () => passages },
    ai: {
      answerFromDocuments: async (question, given) => {
        receivedPassages = given;
        return { ok: true, source: 'documents', text: 'Preheat to 250F [1].', sources: given.map((p, i) => ({ n: i + 1, name: p.name, path: p.path, page: p.page })) };
      }
    },
    memory: { search: () => [] },
    tasks: {},
    log: { write: () => {} }
  });
  const result = await router.handle('Ask my documents: what preheat does P91 need?');
  assert.equal(receivedPassages[0].name, 'weld-specs.pdf');
  assert.equal(result.files[0].name, 'weld-specs.pdf');
  assert.equal(result.sources[0].page, 3);
  assert.match(result.response, /\[1\]/);
  // The "according to my documents" phrasing routes the same way.
  const alt = await router.handle('according to my documents, what preheat does P91 need?');
  assert.match(alt.response, /\[1\]/);
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

test('voice service reports a failed spawn instead of "starting" forever', async () => {
  const { LocalVoiceService } = require('../core/local-voice-service');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-voice-spawn-'));
  try {
    // A python.exe that exists but is not a real executable makes spawn fail.
    fs.mkdirSync(path.join(dir, '.venv', 'Scripts'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.venv', 'Scripts', 'python.exe'), 'not a program');
    const statuses = [];
    const svc = new LocalVoiceService({
      voiceRoot: dir,
      scriptPath: 'x.py',
      config: { getSettings: () => ({}) },
      emit: (channel, payload) => { if (channel === 'voice:status') statuses.push(payload); }
    });
    svc.start();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const status = svc.getStatus();
    assert.equal(status.running, false);
    assert.match(status.message, /could not start|stopped/i);
    assert.ok(statuses.length >= 1); // the UI heard about it
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
  assert.equal(mergeSettings(DEFAULT_SETTINGS, {}).mobileEnabled, false);
  assert.equal(mergeSettings(DEFAULT_SETTINGS, {}).mobilePort, 27183);
  assert.equal(mergeSettings(DEFAULT_SETTINGS, {}).mobilePublicUrl, '');
  assert.equal(mergeSettings(DEFAULT_SETTINGS, {}).schedulesEnabled, false);
});

test('config store persists mobile settings through updateSettings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-config-'));
  try {
    const store = new ConfigStore(dir);
    const updated = store.updateSettings({ mobileEnabled: true, mobilePort: 27200 });
    assert.equal(updated.mobileEnabled, true);
    assert.equal(updated.mobilePort, 27200);
    // Reload from disk to confirm the whitelist didn't silently drop the write.
    const reloaded = new ConfigStore(dir);
    assert.equal(reloaded.getSettings().mobileEnabled, true);
    assert.equal(reloaded.getSettings().mobilePort, 27200);
    store.updateSettings({ schedulesEnabled: true });
    assert.equal(new ConfigStore(dir).getSettings().schedulesEnabled, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('config store persists mobilePublicUrl through updateSettings (whitelist regression guard)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-config-'));
  try {
    const store = new ConfigStore(dir);
    const updated = store.updateSettings({ mobilePublicUrl: 'https://alienadam.taile7c34c.ts.net' });
    assert.equal(updated.mobilePublicUrl, 'https://alienadam.taile7c34c.ts.net');
    // Reload from disk to confirm the whitelist didn't silently drop the write.
    const reloaded = new ConfigStore(dir);
    assert.equal(reloaded.getSettings().mobilePublicUrl, 'https://alienadam.taile7c34c.ts.net');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
