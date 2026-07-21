const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const {
  buildArgs,
  resolveClaudeCli,
  ANSWERS_ONLY_TOOLS,
  ClaudeBridge
} = require('../core/claude-bridge');
const { CommandRouter } = require('../core/router');

// ---------------------------------------------------------------------------
// buildArgs — the argv handed to claude.exe. Kept pure so the answers-only
// guarantee can be asserted directly rather than inferred from behaviour.
// ---------------------------------------------------------------------------

test('buildArgs runs in print mode with the question as its own argv entry', () => {
  const args = buildArgs({ question: 'why will my truck not start' });
  assert.ok(args.includes('-p'));
  // The question must be a single argv element — never concatenated into a
  // command line, so quoting and shell metacharacters can never matter.
  assert.ok(args.includes('why will my truck not start'));
});

test('buildArgs asks for JSON so the reply and session id are structured data', () => {
  const args = buildArgs({ question: 'hello' });
  const i = args.indexOf('--output-format');
  assert.notEqual(i, -1);
  assert.equal(args[i + 1], 'json');
});

// This is the answers-only guarantee. If someone deletes the flag or drops a
// tool from the list, this test must fail — see the handoff note about guards
// that would have passed their tests even if removed entirely.
test('buildArgs disallows every tool that could change the PC', () => {
  const args = buildArgs({ question: 'hello' });
  const i = args.indexOf('--disallowedTools');
  assert.notEqual(i, -1, '--disallowedTools must be present or Claude could edit files');
  const blocked = args[i + 1].split(',');
  for (const tool of ['Edit', 'Write', 'NotebookEdit', 'Bash', 'WebFetch']) {
    assert.ok(blocked.includes(tool), `${tool} must be blocked`);
  }
});

test('ANSWERS_ONLY_TOOLS is what buildArgs actually sends', () => {
  const args = buildArgs({ question: 'hello' });
  assert.equal(args[args.indexOf('--disallowedTools') + 1], ANSWERS_ONLY_TOOLS.join(','));
});

test('buildArgs resumes a previous conversation when a session id is known', () => {
  const args = buildArgs({ question: 'what about the battery', sessionId: 'abc-123' });
  const i = args.indexOf('--resume');
  assert.notEqual(i, -1);
  assert.equal(args[i + 1], 'abc-123');
});

test('buildArgs starts a fresh conversation when there is no session id', () => {
  assert.equal(buildArgs({ question: 'hello' }).includes('--resume'), false);
});

// ---------------------------------------------------------------------------
// resolveClaudeCli — finding claude.exe without guessing.
// ---------------------------------------------------------------------------

test('resolveClaudeCli prefers an explicit override from settings', () => {
  const found = resolveClaudeCli({ override: 'D:\\tools\\claude.exe', exists: (p) => p === 'D:\\tools\\claude.exe' });
  assert.equal(found, 'D:\\tools\\claude.exe');
});

test('resolveClaudeCli finds the npm global install', () => {
  const expected = path.join('C:\\Users\\steam\\AppData\\Roaming\\npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
  const found = resolveClaudeCli({ env: { APPDATA: 'C:\\Users\\steam\\AppData\\Roaming' }, exists: (p) => p === expected });
  assert.equal(found, expected);
});

test('resolveClaudeCli returns null when nothing is installed', () => {
  assert.equal(resolveClaudeCli({ env: {}, exists: () => false }), null);
});

// ---------------------------------------------------------------------------
// ClaudeBridge.ask — spawning, session memory, transcripts, failures.
// ---------------------------------------------------------------------------

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => { child.killed = true; };
  return child;
}

// Drives a fake spawn: each queued reply is delivered to the next spawn call.
function fakeSpawn(replies) {
  const calls = [];
  const queue = [...replies];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    const child = fakeChild();
    const reply = queue.shift() || { stdout: '', code: 0 };
    queueMicrotask(() => {
      if (reply.error) return child.emit('error', reply.error);
      if (reply.stdout) child.stdout.emit('data', Buffer.from(reply.stdout));
      if (reply.stderr) child.stderr.emit('data', Buffer.from(reply.stderr));
      if (!reply.hang) child.emit('close', reply.code ?? 0);
    });
    return child;
  };
  spawn.calls = calls;
  return spawn;
}

function jsonReply(text, sessionId = 'sess-1') {
  return { stdout: JSON.stringify({ type: 'result', result: text, session_id: sessionId }), code: 0 };
}

function fakeConfig(settings = {}) {
  const state = { claudeBridgeEnabled: true, claudeBridgeSessionId: '', ...settings };
  return {
    state,
    getSettings: () => ({ ...state }),
    updateSettings: (patch) => Object.assign(state, patch)
  };
}

function fakeTranscript() {
  const entries = [];
  return { entries, append: async (entry) => { entries.push(entry); } };
}

function makeBridge({ spawn, config, transcript, cliPath = 'C:\\claude.exe', timeoutMs = 1000 } = {}) {
  return new ClaudeBridge({
    config: config || fakeConfig(),
    spawn: spawn || fakeSpawn([jsonReply('An answer.')]),
    transcript: transcript || fakeTranscript(),
    resolveCli: () => cliPath,
    timeoutMs
  });
}

test('ask returns the answer text from the CLI', async () => {
  const bridge = makeBridge({ spawn: fakeSpawn([jsonReply('Check the battery terminals.')]) });
  const result = await bridge.ask('why will my truck not start');
  assert.equal(result.ok, true);
  assert.equal(result.text, 'Check the battery terminals.');
});

test('ask never uses a shell — the question can never become a command', async () => {
  const spawn = fakeSpawn([jsonReply('ok')]);
  const bridge = makeBridge({ spawn });
  await bridge.ask('delete everything & format c:');
  assert.equal(spawn.calls[0].options.shell, false);
  assert.ok(Array.isArray(spawn.calls[0].args));
  assert.ok(spawn.calls[0].args.includes('delete everything & format c:'));
});

test('ask remembers the conversation by storing the session id', async () => {
  const config = fakeConfig();
  const bridge = makeBridge({ config, spawn: fakeSpawn([jsonReply('ok', 'sess-42')]) });
  await bridge.ask('first question');
  assert.equal(config.state.claudeBridgeSessionId, 'sess-42');
});

test('ask resumes the stored conversation on the next question', async () => {
  const config = fakeConfig({ claudeBridgeSessionId: 'sess-42' });
  const spawn = fakeSpawn([jsonReply('ok', 'sess-42')]);
  const bridge = makeBridge({ config, spawn });
  await bridge.ask('what about the battery');
  const args = spawn.calls[0].args;
  assert.equal(args[args.indexOf('--resume') + 1], 'sess-42');
});

test('ask retries once without --resume when the stored session is gone', async () => {
  const config = fakeConfig({ claudeBridgeSessionId: 'stale-id' });
  const spawn = fakeSpawn([
    { stderr: 'No conversation found with session ID: stale-id', code: 1 },
    jsonReply('Fresh answer.', 'sess-new')
  ]);
  const bridge = makeBridge({ config, spawn });
  const result = await bridge.ask('carry on');
  assert.equal(spawn.calls.length, 2);
  assert.equal(spawn.calls[1].args.includes('--resume'), false);
  assert.equal(result.text, 'Fresh answer.');
  assert.equal(config.state.claudeBridgeSessionId, 'sess-new');
});

test('ask saves the exchange to the transcript', async () => {
  const transcript = fakeTranscript();
  const bridge = makeBridge({ transcript, spawn: fakeSpawn([jsonReply('Check the battery.')]) });
  await bridge.ask('why will my truck not start');
  assert.equal(transcript.entries.length, 1);
  assert.equal(transcript.entries[0].question, 'why will my truck not start');
  assert.equal(transcript.entries[0].answer, 'Check the battery.');
});

test('ask still answers when the transcript cannot be written', async () => {
  const transcript = { append: async () => { throw new Error('disk full'); } };
  const bridge = makeBridge({ transcript, spawn: fakeSpawn([jsonReply('Still works.')]) });
  const result = await bridge.ask('anything');
  assert.equal(result.ok, true);
  assert.equal(result.text, 'Still works.');
});

test('ask reports plainly when Claude is not installed', async () => {
  const bridge = new ClaudeBridge({
    config: fakeConfig(),
    spawn: fakeSpawn([]),
    transcript: fakeTranscript(),
    resolveCli: () => null
  });
  const result = await bridge.ask('hello');
  assert.equal(result.ok, false);
  assert.match(result.text, /can't find Claude|cannot find Claude/i);
});

test('ask reports plainly when Claude is not signed in', async () => {
  const spawn = fakeSpawn([{ stderr: 'Invalid API key · Please run /login', code: 1 }]);
  const bridge = makeBridge({ spawn });
  const result = await bridge.ask('hello');
  assert.equal(result.ok, false);
  assert.match(result.text, /signed in|sign in/i);
});

test('ask reports plainly when the connection is down', async () => {
  const spawn = fakeSpawn([{ stderr: 'request to https://api.anthropic.com failed, reason: getaddrinfo ENOTFOUND', code: 1 }]);
  const bridge = makeBridge({ spawn });
  const result = await bridge.ask('hello');
  assert.equal(result.ok, false);
  assert.match(result.text, /connection|reach Claude/i);
});

test('ask gives up and kills the process when Claude takes too long', async () => {
  const spawn = fakeSpawn([{ hang: true }]);
  const bridge = makeBridge({ spawn, timeoutMs: 20 });
  const result = await bridge.ask('hello');
  assert.equal(result.ok, false);
  assert.match(result.text, /too long/i);
});

test('newConversation clears the stored session id', () => {
  const config = fakeConfig({ claudeBridgeSessionId: 'sess-42' });
  const bridge = makeBridge({ config });
  bridge.newConversation();
  assert.equal(config.state.claudeBridgeSessionId, '');
});

// ---------------------------------------------------------------------------
// Router integration — the "ask claude" phrase.
// ---------------------------------------------------------------------------

function fakeClaude(overrides = {}) {
  const calls = { ask: [], newConversation: 0 };
  return {
    calls,
    ask: async (question) => { calls.ask.push(question); return { ok: true, text: 'Claude says hello.' }; },
    newConversation: () => { calls.newConversation += 1; },
    ...overrides
  };
}

function routerWithClaude(claude, settings = {}) {
  return new CommandRouter({
    config: { getSettings: () => ({ projects: {}, routines: {}, applications: {}, claudeBridgeEnabled: true, ...settings }) },
    tools: { resolveApplication: () => null, searchFiles: async () => [] },
    documents: null,
    ai: {},
    memory: { list: () => [], search: () => [] },
    tasks: { list: () => [] },
    log: { write: () => {} },
    cameras: null,
    claude
  });
}

test('"ask claude" passes just the question through and speaks the answer', async () => {
  const claude = fakeClaude();
  const router = routerWithClaude(claude);
  const result = await router.handle('ask claude why will my truck not start');
  assert.deepEqual(claude.calls.ask, ['why will my truck not start']);
  assert.equal(result.response, 'Claude says hello.');
});

test('"jarvis, ask claude, ..." tolerates the wake word and punctuation', async () => {
  const claude = fakeClaude();
  const router = routerWithClaude(claude);
  await router.handle('jarvis, ask claude: what about the battery');
  assert.deepEqual(claude.calls.ask, ['what about the battery']);
});

test('a near miss like "ask claudia about it" is not sent to Claude', async () => {
  const claude = fakeClaude();
  const router = routerWithClaude(claude);
  // Falls through to the normal brain instead, so the router needs one.
  router.ai = { reply: async () => ({ text: 'Local brain answer.', ok: true, source: 'ollama' }) };
  const result = await router.handle('ask claudia about it');
  assert.equal(claude.calls.ask.length, 0);
  assert.equal(result.response, 'Local brain answer.');
});

test('"ask claude" with no question asks what he wants and sends nothing', async () => {
  const claude = fakeClaude();
  const router = routerWithClaude(claude);
  const result = await router.handle('ask claude');
  assert.equal(claude.calls.ask.length, 0);
  assert.match(result.response, /what/i);
});

test('"ask claude, new conversation" starts a fresh thread without asking anything', async () => {
  const claude = fakeClaude();
  const router = routerWithClaude(claude);
  const result = await router.handle('ask claude new conversation');
  assert.equal(claude.calls.newConversation, 1);
  assert.equal(claude.calls.ask.length, 0);
  assert.match(result.response, /fresh|new conversation|start/i);
});

test('"ask claude" is refused while the setting is switched off', async () => {
  const claude = fakeClaude();
  const router = routerWithClaude(claude, { claudeBridgeEnabled: false });
  const result = await router.handle('ask claude anything at all');
  assert.equal(claude.calls.ask.length, 0);
  assert.match(result.response, /settings/i);
});

test('unattended: a scheduled task can never reach Claude', async () => {
  const claude = fakeClaude();
  const router = routerWithClaude(claude);
  const result = await router.handle('ask claude what is on my calendar', 'general', { unattended: true });
  assert.equal(claude.calls.ask.length, 0);
  assert.match(result.response, /at the desk/i);
});
