const test = require('node:test');
const assert = require('node:assert/strict');
const { CommandRouter } = require('../core/router');

// Minimal fake collaborators, mirroring the style used in test/core.test.js.
// Only the methods each scenario needs are provided; anything unused stays
// absent so an accidental call surfaces as a loud TypeError instead of
// silently succeeding.

function fakeTools(overrides = {}) {
  const calls = { openApplication: [], openPath: [], openFocusMode: [] };
  return {
    calls,
    resolveApplication: (name) => ({ canonical: name, command: name }),
    openApplication: async (name) => { calls.openApplication.push(name); return { ok: true, message: `Opening ${name}.` }; },
    openPath: async (target) => { calls.openPath.push(target); return { ok: true, message: `Opening ${target}.`, path: target }; },
    openFocusMode: async () => { calls.openFocusMode.push(true); return { ok: true, message: 'Focus mode is active. I opened 2 approved applications.' }; },
    searchFiles: async () => [],
    ...overrides
  };
}

function baseRouter(tools, settings = {}) {
  return new CommandRouter({
    config: { getSettings: () => ({ projects: {}, routines: {}, applications: {}, ...settings }) },
    tools,
    documents: null,
    ai: {},
    memory: { list: () => [], search: () => [] },
    tasks: { list: () => [] },
    log: { write: () => {} },
    cameras: null
  });
}

// ---- (a)/(b) open|launch|start branch: launching an application ----------

test('unattended: "open chrome" does not call tools.openApplication and explains it needs Adam at the desk', async () => {
  const tools = fakeTools();
  const router = baseRouter(tools);
  const result = await router.handle('open chrome', 'general', { unattended: true });
  assert.equal(tools.calls.openApplication.length, 0);
  assert.match(result.response, /at the desk/i);
});

test('attended: "open chrome" calls tools.openApplication (proves attended behavior unchanged)', async () => {
  const tools = fakeTools();
  const router = baseRouter(tools);
  const result = await router.handle('open chrome', 'general');
  assert.deepEqual(tools.calls.openApplication, ['chrome']);
  assert.equal(result.response, 'Opening chrome.');
});

// ---- (c) #matchRoutine branch: launching a saved routine's apps/folders ---

function routineSettings() {
  return { routines: { morning: { apps: ['chrome'], folders: ['reports'] } }, projects: { reports: 'C:\\Projects\\reports' } };
}

test('unattended: "run morning routine" does not open any app or folder and explains it needs Adam at the desk', async () => {
  const tools = fakeTools();
  const router = baseRouter(tools, routineSettings());
  const result = await router.handle('run morning routine', 'general', { unattended: true });
  assert.equal(tools.calls.openApplication.length, 0);
  assert.equal(tools.calls.openPath.length, 0);
  assert.match(result.response, /at the desk/i);
});

test('attended: "run morning routine" opens the routine\'s apps and folders (proves attended behavior unchanged)', async () => {
  const tools = fakeTools();
  const router = baseRouter(tools, routineSettings());
  const result = await router.handle('run morning routine', 'general');
  assert.deepEqual(tools.calls.openApplication, ['chrome']);
  assert.deepEqual(tools.calls.openPath, ['C:\\Projects\\reports']);
  assert.match(result.response, /opened/i);
});

// ---- (d) other actuating branches found in the audit ----------------------

// D1: focus-mode branch (core/router.js ~328-330) — this.tools.openFocusMode()
// opens every app configured for focus mode.
test('unattended: "turn on focus mode" does not call tools.openFocusMode and explains it needs Adam at the desk', async () => {
  const tools = fakeTools();
  const router = baseRouter(tools);
  const result = await router.handle('turn on focus mode', 'general', { unattended: true });
  assert.equal(tools.calls.openFocusMode.length, 0);
  assert.match(result.response, /at the desk/i);
});

test('attended: "turn on focus mode" calls tools.openFocusMode (proves attended behavior unchanged)', async () => {
  const tools = fakeTools();
  const router = baseRouter(tools);
  const result = await router.handle('turn on focus mode', 'general');
  assert.equal(tools.calls.openFocusMode.length, 1);
  assert.match(result.response, /Focus mode is active/);
});

// D2: the "find X and open it" branch (core/router.js ~331-346) —
// this.tools.openPath(top.path) when a single confident match is found.
test('unattended: "find and open report" does not call tools.openPath and explains it needs Adam at the desk', async () => {
  const tools = fakeTools({ searchFiles: async () => [{ name: 'report.pdf', path: 'C:\\Docs\\report.pdf', score: 10, type: 'file' }] });
  const router = baseRouter(tools);
  const result = await router.handle('find and open report', 'general', { unattended: true });
  assert.equal(tools.calls.openPath.length, 0);
  assert.match(result.response, /at the desk/i);
});

test('attended: "find and open report" calls tools.openPath (proves attended behavior unchanged)', async () => {
  const tools = fakeTools({ searchFiles: async () => [{ name: 'report.pdf', path: 'C:\\Docs\\report.pdf', score: 10, type: 'file' }] });
  const router = baseRouter(tools);
  const result = await router.handle('find and open report', 'general');
  assert.deepEqual(tools.calls.openPath, ['C:\\Docs\\report.pdf']);
  assert.match(result.response, /Found it/i);
});

// D3: the "open <project> folder" sub-case of open|launch|start
// (core/router.js ~349-357) — this.tools.openPath(settings.projects[name]).
test('unattended: "open reports project folder" does not call tools.openPath and explains it needs Adam at the desk', async () => {
  const tools = fakeTools();
  const router = baseRouter(tools, { projects: { reports: 'C:\\Projects\\reports' } });
  const result = await router.handle('open reports project folder', 'general', { unattended: true });
  assert.equal(tools.calls.openPath.length, 0);
  assert.match(result.response, /at the desk/i);
});

test('attended: "open reports project folder" calls tools.openPath (proves attended behavior unchanged)', async () => {
  const tools = fakeTools();
  const router = baseRouter(tools, { projects: { reports: 'C:\\Projects\\reports' } });
  const result = await router.handle('open reports project folder', 'general');
  assert.deepEqual(tools.calls.openPath, ['C:\\Projects\\reports']);
  assert.match(result.response, /Opening the reports workspace/i);
});

// D4: the file-search sub-case of open|launch|start (core/router.js
// ~358-373) — this.tools.openPath(top.path) when the target isn't a known
// application or project.
test('unattended: "open quarterly numbers" (unresolved app, file search) does not call tools.openPath', async () => {
  const tools = fakeTools({
    resolveApplication: () => null,
    searchFiles: async () => [{ name: 'quarterly numbers.xlsx', path: 'C:\\Docs\\quarterly numbers.xlsx', score: 10, type: 'file' }]
  });
  const router = baseRouter(tools);
  const result = await router.handle('open quarterly numbers', 'general', { unattended: true });
  assert.equal(tools.calls.openPath.length, 0);
  assert.match(result.response, /at the desk/i);
});

test('attended: "open quarterly numbers" (unresolved app, file search) calls tools.openPath', async () => {
  const tools = fakeTools({
    resolveApplication: () => null,
    searchFiles: async () => [{ name: 'quarterly numbers.xlsx', path: 'C:\\Docs\\quarterly numbers.xlsx', score: 10, type: 'file' }]
  });
  const router = baseRouter(tools);
  const result = await router.handle('open quarterly numbers', 'general');
  assert.deepEqual(tools.calls.openPath, ['C:\\Docs\\quarterly numbers.xlsx']);
  assert.match(result.response, /Found it/i);
});

// ---- Re-review findings: ai.reply() calls that didn't thread `unattended`,
// and the ungated `forget` deletion branch. ----------------------------------

function fakeAi(overrides = {}) {
  const calls = { reply: [] };
  return {
    calls,
    reply: async (text, context) => { calls.reply.push({ text, context }); return { text: 'AI reply text', ok: true, source: 'ollama' }; },
    ...overrides
  };
}

function routerWithDocuments({ tools, documents, ai, memory } = {}) {
  return new CommandRouter({
    config: { getSettings: () => ({ projects: {}, routines: {}, applications: {} }) },
    tools: tools || fakeTools(),
    documents,
    ai: ai || fakeAi(),
    memory: memory || { list: () => [], search: () => [] },
    tasks: { list: () => [] },
    log: { write: () => {} },
    cameras: null
  });
}

// FINDING 1a: read/summarize-document branch (core/router.js ~243) must
// thread unattended into the context handed to ai.reply, since the model
// could otherwise call open_application while nobody is watching — worse,
// the document content itself is attacker-controllable (prompt injection).
test('unattended: "summarize report" threads unattended:true into the ai.reply context', async () => {
  const tools = fakeTools({ searchFiles: async () => [{ name: 'report.pdf', path: 'C:\\Docs\\report.pdf', type: 'file' }] });
  const documents = { supports: () => true, readDocument: async () => ({ name: 'report.pdf', text: 'doc text', truncated: false }) };
  const ai = fakeAi();
  const router = routerWithDocuments({ tools, documents, ai });
  await router.handle('summarize report', 'general', { unattended: true });
  assert.equal(ai.calls.reply.length, 1);
  assert.equal(ai.calls.reply[0].context?.unattended, true);
});

test('attended: "summarize report" does not mark the ai.reply context unattended (proves no regression)', async () => {
  const tools = fakeTools({ searchFiles: async () => [{ name: 'report.pdf', path: 'C:\\Docs\\report.pdf', type: 'file' }] });
  const documents = { supports: () => true, readDocument: async () => ({ name: 'report.pdf', text: 'doc text', truncated: false }) };
  const ai = fakeAi();
  const router = routerWithDocuments({ tools, documents, ai });
  await router.handle('summarize report', 'general');
  assert.equal(ai.calls.reply.length, 1);
  assert.notEqual(ai.calls.reply[0].context?.unattended, true);
});

// FINDING 1b: create-report branch (core/router.js ~267) must also thread
// unattended into the ai.reply context.
test('unattended: "create a report called notes about widgets" threads unattended:true into the ai.reply context', async () => {
  const documents = { createTextFile: async (folder, name, content, ext) => ({ message: 'Created.', path: 'C:\\Docs\\notes.md', ok: true }) };
  const ai = fakeAi();
  const router = routerWithDocuments({ documents, ai });
  await router.handle('create a report called notes about widgets', 'general', { unattended: true });
  assert.equal(ai.calls.reply.length, 1);
  assert.equal(ai.calls.reply[0].context?.unattended, true);
});

test('attended: "create a report called notes about widgets" does not mark the ai.reply context unattended (proves no regression)', async () => {
  const documents = { createTextFile: async (folder, name, content, ext) => ({ message: 'Created.', path: 'C:\\Docs\\notes.md', ok: true }) };
  const ai = fakeAi();
  const router = routerWithDocuments({ documents, ai });
  await router.handle('create a report called notes about widgets', 'general');
  assert.equal(ai.calls.reply.length, 1);
  assert.notEqual(ai.calls.reply[0].context?.unattended, true);
});

// FINDING 2: the `forget` branch is an outright deletion (memory.forget) and
// must be gated for unattended runs, per the policy documented at
// core/ai-service.js:5-9 (deleting is not allowed unattended).
test('unattended: "forget the meeting notes" does not call memory.forget and explains it needs Adam at the desk', async () => {
  const calls = { forget: [] };
  const memory = { list: () => [], search: () => [], forget: (query) => { calls.forget.push(query); return { text: query }; } };
  const router = routerWithDocuments({ memory });
  const result = await router.handle('forget the meeting notes', 'general', { unattended: true });
  assert.equal(calls.forget.length, 0);
  assert.match(result.response, /at the desk/i);
});

test('attended: "forget the meeting notes" calls memory.forget with the original query (proves attended behavior unchanged)', async () => {
  const calls = { forget: [] };
  const memory = { list: () => [], search: () => [], forget: (query) => { calls.forget.push(query); return { text: query }; } };
  const router = routerWithDocuments({ memory });
  const result = await router.handle('forget the meeting notes', 'general');
  assert.deepEqual(calls.forget, ['the meeting notes']);
  assert.match(result.response, /Forgotten/i);
});

// FINDING 3: the "ask my documents" branch (core/router.js ~220) is the one
// ai.answerFromDocuments call site that did not thread `unattended` into the
// context — a sibling gap to findings 1a/1b above, discovered in the same
// audit as the ai-service.js #registryFor/localReply issue.
test('unattended: "ask my documents: what is the deadline" threads unattended:true into the ai.answerFromDocuments context', async () => {
  const passages = [{ name: 'spec.pdf', path: 'C:\\Docs\\spec.pdf', page: 1, text: 'The deadline is Friday.' }];
  const calls = { answerFromDocuments: [] };
  const documents = { gatherPassages: async () => passages };
  const ai = {
    answerFromDocuments: async (question, given, context) => {
      calls.answerFromDocuments.push({ question, given, context });
      return { ok: true, source: 'documents', text: 'Friday [1].', sources: given.map((p, i) => ({ n: i + 1, name: p.name, path: p.path })) };
    }
  };
  const router = routerWithDocuments({ documents, ai });
  await router.handle('ask my documents: what is the deadline', 'general', { unattended: true });
  assert.equal(calls.answerFromDocuments.length, 1);
  assert.equal(calls.answerFromDocuments[0].context?.unattended, true);
});

test('attended: "ask my documents: what is the deadline" does not mark the context unattended (proves no regression)', async () => {
  const passages = [{ name: 'spec.pdf', path: 'C:\\Docs\\spec.pdf', page: 1, text: 'The deadline is Friday.' }];
  const calls = { answerFromDocuments: [] };
  const documents = { gatherPassages: async () => passages };
  const ai = {
    answerFromDocuments: async (question, given, context) => {
      calls.answerFromDocuments.push({ question, given, context });
      return { ok: true, source: 'documents', text: 'Friday [1].', sources: given.map((p, i) => ({ n: i + 1, name: p.name, path: p.path })) };
    }
  };
  const router = routerWithDocuments({ documents, ai });
  await router.handle('ask my documents: what is the deadline', 'general');
  assert.equal(calls.answerFromDocuments.length, 1);
  assert.notEqual(calls.answerFromDocuments[0].context?.unattended, true);
});

// ---- FINDING 11: orphan approval entries — unattended runs must not queue
// an approval that nothing will ever resolve (router.pending is a leak, and
// "Review the file action before I continue" is nonsense spoken to an empty
// room). Covers both the power-confirm path (~line 105) and #fileApproval
// (~line 456), which are used by delete/copy/move/rename/organize. ----------

function routerForApprovals({ tools, documents } = {}) {
  return new CommandRouter({
    config: { getSettings: () => ({ projects: {}, routines: {}, applications: {} }) },
    tools: tools || fakeTools(),
    documents: documents || null,
    ai: {},
    memory: { list: () => [], search: () => [] },
    tasks: { list: () => [] },
    log: { write: () => {} },
    cameras: null
  });
}

test('unattended: "restart my computer" does not queue a pending approval and returns an at-the-desk message', async () => {
  const router = routerForApprovals();
  const result = await router.handle('restart my computer', 'general', { unattended: true });
  assert.equal(router.pending.size, 0);
  assert.equal(result.approval, undefined);
  assert.match(result.response, /at the desk/i);
});

test('attended: "restart my computer" still queues a pending power approval (proves no regression)', async () => {
  const router = routerForApprovals();
  const result = await router.handle('restart my computer', 'general');
  assert.equal(router.pending.size, 1);
  assert.ok(result.approval?.id);
  assert.equal(result.approval.title, 'RESTART COMPUTER');
});

test('unattended: "delete old files" does not queue a pending approval and returns an at-the-desk message', async () => {
  const documents = { trashItem: async () => ({ ok: true, message: 'Moved to Recycle Bin.' }) };
  const tools = fakeTools({ searchFiles: async () => [{ name: 'old-notes.txt', path: 'C:\\Docs\\old-notes.txt', score: 10 }] });
  const router = routerForApprovals({ tools, documents });
  const result = await router.handle('delete old files', 'general', { unattended: true });
  assert.equal(router.pending.size, 0);
  assert.equal(result.approval, undefined);
  assert.match(result.response, /at the desk/i);
});

test('attended: "delete old files" still queues a pending file approval (proves no regression)', async () => {
  const documents = { trashItem: async () => ({ ok: true, message: 'Moved to Recycle Bin.' }) };
  const tools = fakeTools({ searchFiles: async () => [{ name: 'old-notes.txt', path: 'C:\\Docs\\old-notes.txt', score: 10 }] });
  const router = routerForApprovals({ tools, documents });
  const result = await router.handle('delete old files', 'general');
  assert.equal(router.pending.size, 1);
  assert.ok(result.approval?.id);
  assert.equal(result.approval.risk, 'HIGH');
});

test('unattended: "organize my documents" does not queue a pending approval and returns an at-the-desk message', async () => {
  const documents = { planOrganization: async () => ({ directory: 'C:\\Docs', moves: [{ category: 'PDFs' }] }) };
  const router = routerForApprovals({ documents });
  const result = await router.handle('organize my documents', 'general', { unattended: true });
  assert.equal(router.pending.size, 0);
  assert.equal(result.approval, undefined);
  assert.match(result.response, /at the desk/i);
});

test('attended: "organize my documents" still queues a pending file approval (proves no regression)', async () => {
  const documents = { planOrganization: async () => ({ directory: 'C:\\Docs', moves: [{ category: 'PDFs' }] }) };
  const router = routerForApprovals({ documents });
  const result = await router.handle('organize my documents', 'general');
  assert.equal(router.pending.size, 1);
  assert.ok(result.approval?.id);
});
