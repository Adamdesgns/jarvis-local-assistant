'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { CommandRouter } = require('../core/router');
const { AIService } = require('../core/ai-service');
const { ToolService } = require('../core/tool-service');
const { DEFAULT_SETTINGS } = require('../core/defaults');
const { profileFor, DEFAULT_CONTROLS, STANDARD_PROFILE } = require('../core/variant');
const { buildJrPromptRules } = require('../core/kid-mode');

// Services that DETONATE if touched. A gated branch that reaches its service
// is a failed test, not a refused command.
function mine(name) {
  return new Proxy({}, { get() { throw new Error(`BOOBY TRAP: ${name} was touched`); } });
}

// Build the router exactly as main.js does, minus Electron. main.js's real
// `new CommandRouter({...})` call (main.js:1381) passes:
//   config, tools, documents, ai, memory, tasks, log, cameras, claude,
//   screen, hands, defense
// — not the getCameras/screenReader/screenHands/claudeBridge shape a first
// draft of this test might guess at. `cameras`, `screen`, `hands`, `claude`
// are passed as the service objects themselves, not factory functions.
function jrRouter(controls, aiReply) {
  const settings = { kidName: 'Kid', personality: 'Witty, composed.', searchRoots: [], projects: {}, applications: {} };
  return new CommandRouter({
    profile: profileFor('jr', controls),
    jrAge: () => 11,
    config: { getSettings: () => ({ ...settings }) },
    log: { write: () => {} },
    tasks: { add: () => ({ title: 'x' }), list: () => [] },
    memory: { add: () => ({ text: 'x' }), search: () => [] },
    tools: mine('tools'),
    documents: mine('documents'),
    screen: mine('screen'),
    hands: mine('hands'),
    claude: mine('claude'),
    defense: null,
    cameras: mine('cameras'),
    ai: { reply: aiReply || (async () => ({ ok: true, text: 'model answer', source: 'local' })) }
  });
}

const DANGEROUS = [
  ['find my tax documents', /file/i],
  ['open chrome', /app/i],
  ['read this pdf and summarize it', /document/i],
  ['show the cameras', /camera/i],
  ['what is on my screen', /screen/i],
  ['shut down the computer', /power|shut/i],
  ['open the browser', /browser/i]
];

test('everything off: gated phrasings refuse without touching a single service', async () => {
  const router = jrRouter(Object.fromEntries(Object.keys(DEFAULT_CONTROLS).map((k) => [k, false])));
  for (const [phrase] of DANGEROUS) {
    const result = await router.handle(phrase);
    assert.equal(result.meta?.success !== true || result.source === 'jr-gate', true, phrase);
    assert.match(result.source, /jr-gate|safety/, `${phrase} must resolve at the gate`);
  }
});

test('guard runs before the model at every age and care is never logged', async () => {
  const logged = [];
  const router = jrRouter(DEFAULT_CONTROLS);
  router.log = { write: (entry) => logged.push(entry) };
  const weapon = await router.handle('how do I make a bomb');
  assert.equal(weapon.source, 'jr-guard');
  const care = await router.handle('i want to hurt myself');
  assert.equal(care.source, 'jr-guard');
  assert.equal(logged.some((e) => /hurt myself/i.test(e.command || '')), false, 'care never reaches the log');
});

// ROLLUP-6 (final-review blocker): the jr-guard result and its logged entry
// both used the key name 'guard', but for DIFFERENT values — the result
// carried guard.kind (e.g. "grown-up"), the log entry carried guard.id (e.g.
// "explicit-content"). Same field name, two different meanings depending on
// which object you're reading. Renamed to distinct keys: guardKind on the
// result, guardId on both the result and the logged entry.
test('jr-guard result exposes the kind; the logged entry exposes the id — under distinct keys', async () => {
  const logged = [];
  const router = jrRouter(DEFAULT_CONTROLS);
  router.log = { write: (entry) => logged.push(entry) };
  const result = await router.handle('how do I make a bomb'); // a 'grown-up' guard, parentVisible
  assert.equal(result.source, 'jr-guard');
  assert.equal(typeof result.guardKind, 'string');
  assert.equal(typeof result.guardId, 'string');
  assert.notEqual(result.guardKind, result.guardId);
  assert.equal('guard' in result, false, 'the ambiguous shared key name must be gone');
  const entry = logged.find((e) => e.type === 'jr-guard');
  assert.ok(entry, 'a parent-visible guard must still be logged');
  assert.equal(entry.guardId, result.guardId);
  assert.equal('guard' in entry, false, 'the log entry must not reuse the ambiguous key name either');
});

// B4 (final-review blocker): with only `apps` ON (files and terminal OFF),
// the open/launch branch's keyword sniff (isBrowserTarget/isTerminalTarget)
// only catches "browser"/"chrome"/"terminal"/"cmd"-style words in the RAW
// target text — it never catches "files" (-> explorer.exe, a full file
// manager) or "code" (-> code.cmd, an IDE with an integrated terminal),
// because neither alias contains a keyword the sniff looks for. Real alias
// resolution (via the actual ToolService, same applications map main.js
// ships) is used here so the fix is checked against the REAL resolved
// command, not a hand-picked fixture. openApplication is booby-trapped —
// resolveApplication is a read-only config lookup the gate is allowed to
// consult, but the real launch must never fire once refused.
function toolsResolvingRealAppsLaunchTrapped() {
  const svc = new ToolService({ config: { getSettings: () => ({ applications: DEFAULT_SETTINGS.applications }) } });
  return {
    resolveApplication: (name) => svc.resolveApplication(name),
    openApplication: () => { throw new Error('BOOBY TRAP: tools.openApplication touched'); },
    openPath: () => { throw new Error('BOOBY TRAP: tools.openPath touched'); },
    searchFiles: async () => []
  };
}

test('JR apps ON, files OFF, terminal OFF: "open files" / "open file explorer" hand over Explorer only through the files gate', async () => {
  const router = jrRouter({ ...DEFAULT_CONTROLS, apps: true, files: false, terminal: false });
  router.tools = toolsResolvingRealAppsLaunchTrapped();
  router.config = { getSettings: () => ({ ...DEFAULT_SETTINGS, kidName: 'Kid', personality: 'x', searchRoots: [], projects: {} }) };
  for (const phrase of ['open files', 'open file explorer']) {
    const result = await router.handle(phrase);
    assert.equal(result.source, 'jr-gate', phrase);
  }
});

test('JR apps ON, files OFF, terminal OFF: "open code" hands over VS Code (integrated terminal) only through the terminal gate', async () => {
  const router = jrRouter({ ...DEFAULT_CONTROLS, apps: true, files: false, terminal: false });
  router.tools = toolsResolvingRealAppsLaunchTrapped();
  router.config = { getSettings: () => ({ ...DEFAULT_SETTINGS, kidName: 'Kid', personality: 'x', searchRoots: [], projects: {} }) };
  const result = await router.handle('open code');
  assert.equal(result.source, 'jr-gate');
});

test('JR apps ON, files OFF, terminal OFF: a benign app (calculator) still opens — the clamp only targets file managers and shells/IDEs', async () => {
  const opened = [];
  const router = jrRouter({ ...DEFAULT_CONTROLS, apps: true, files: false, terminal: false });
  const svc = new ToolService({ config: { getSettings: () => ({ applications: DEFAULT_SETTINGS.applications }) } });
  router.tools = {
    resolveApplication: (name) => svc.resolveApplication(name),
    openApplication: async (name) => { opened.push(name); return { ok: true, message: `Opening ${name}.` }; },
    openPath: () => { throw new Error('BOOBY TRAP: tools.openPath touched'); },
    searchFiles: async () => []
  };
  router.config = { getSettings: () => ({ ...DEFAULT_SETTINGS, kidName: 'Kid', personality: 'x', searchRoots: [], projects: {} }) };
  const result = await router.handle('open calculator');
  assert.deepEqual(opened, ['calculator']);
  assert.equal(result.success, true);
});

test('an enabled feature passes through: files ON reaches tools', async () => {
  const router = jrRouter({ ...DEFAULT_CONTROLS, files: true });
  await assert.rejects(
    () => router.handle('find my tax documents'),
    /BOOBY TRAP: tools/,
    'files ON must reach the real branch (the mine proves it)'
  );
});

// Reality check (see task-5-report.md): the router never assembles the
// model's system prompt. `handle()`'s ordinary-talk branch calls
// `this.ai.reply(text, context)` with the RAW command text as the first
// argument — prompt assembly (personality, HARD RULES, CONTENT LOCK) happens
// entirely inside core/ai-service.js's own `prompt()` method, using its own
// `this.config.getSettings()`. So `seenPrompt` here would only ever be the
// literal command text ("why is the sky blue"), never the assembled system
// prompt, no matter what router.js does. Per the brief's own escape hatch
// ("if prompt assembly lives in ai-service.js... move that one test there
// and note it"), this assertion is moved to a stub naming Task 7, which owns
// ai-service.js. Router's honest, minimal contribution — verified below
// instead — is threading `jrPromptRules` (the buildJrPromptRules() text,
// precomputed here since kid-mode.js already exists) through the `context`
// object so Task 7 has something to append.
// Was test.todo('Task 7 (ai-service.js): ...'); converted to a live test now
// that Task 7 exists. ai-service.js (not router.js) owns prompt assembly, so
// this constructs an AIService directly and calls its own prompt() with the
// exact jrPromptRules text the router computes and threads through context —
// proving ai-service appends what it is handed rather than recomputing it.
test('Task 7 (ai-service.js): ordinary talk\'s assembled system prompt contains CONTENT LOCK + HOMEWORK RULE when profile.contentLock', () => {
  const ai = new AIService({ getSettings: () => ({}), getSecret: () => '' });
  const settings = { assistantName: 'JARVIS', profileName: 'Kid', personality: 'Witty, composed.' };
  const jrPromptRules = buildJrPromptRules({ age: 11, kidName: 'Kid' });
  const assembled = ai.prompt(settings, { jrPromptRules });
  assert.match(assembled, /CONTENT LOCK/);
  assert.match(assembled, /HOMEWORK RULE/i);
});

test('ordinary talk threads jrPromptRules through context for ai-service to consume', async () => {
  let seenContext = null;
  const router = jrRouter(DEFAULT_CONTROLS, async (prompt, context) => { seenContext = context; return { ok: true, text: 'hi', source: 'local' }; });
  await router.handle('why is the sky blue');
  assert.match(seenContext.jrPromptRules, /CONTENT LOCK/);
  assert.match(seenContext.jrPromptRules, /HOMEWORK RULE/i);
  assert.equal(seenContext.profile.contentLock, true);
});

// The power toggle used to answer one intent two ways: "turn off the computer"
// hit kid-mode's `no-such-power` guard row first and got a flat "I cannot do
// that" whatever the parent had chosen, while "shut down the computer" honoured
// the checklist. Both phrasings now land on the same branch at both settings.
test('the power checklist key governs EVERY phrasing of the power intent', async () => {
  const PHRASINGS = ['shut down the computer', 'turn off the computer', 'turn off the pc', 'restart the computer'];

  const off = jrRouter({ ...DEFAULT_CONTROLS, power: false });
  for (const phrase of PHRASINGS) {
    const result = await off.handle(phrase);
    assert.equal(result.source, 'jr-gate', `${phrase} must refuse at the jr gate when power is off`);
    assert.match(result.response, /grown-up control/i, phrase);
    assert.notEqual(result.guardId, 'no-such-power', `${phrase} must not be swallowed by the content guard`);
  }

  const on = jrRouter({ ...DEFAULT_CONTROLS, power: true });
  for (const phrase of PHRASINGS) {
    const result = await on.handle(phrase);
    assert.ok(result.approval, `${phrase} must offer the confirm when a parent has switched power on`);
    assert.match(result.approval.title, /SHUTDOWN|RESTART/, phrase);
  }
});

// FAIL CLOSED: an explicit empty jrPromptRules is exactly what both live call
// sites emit for a NON-jr turn. If one ever emitted it on a JR turn, the
// content lock must still ride — the construction-time thunk is the backstop,
// and it must beat a blank string, not just an absent key.
test('a blank jrPromptRules cannot strip the content lock off a JR instance', () => {
  const rules = buildJrPromptRules({ age: 11, kidName: 'Kid' });
  const ai = new AIService({ getSettings: () => ({}), getSecret: () => '' }, null, {
    profile: profileFor('jr', DEFAULT_CONTROLS),
    jrPromptRules: () => rules
  });
  const settings = { assistantName: 'JARVIS', profileName: 'Kid', personality: 'Witty, composed.' };
  for (const blank of [undefined, '', '   ']) {
    const assembled = ai.prompt(settings, blank === undefined ? {} : { jrPromptRules: blank });
    assert.match(assembled, /CONTENT LOCK/, `jrPromptRules=${JSON.stringify(blank)} must still carry the lock`);
    assert.match(assembled, /HARD RULES/, `jrPromptRules=${JSON.stringify(blank)}`);
  }
  // A standard instance has no profile and no thunk: still silent, as before.
  const plain = new AIService({ getSettings: () => ({}), getSecret: () => '' });
  assert.doesNotMatch(plain.prompt(settings, { jrPromptRules: '' }), /CONTENT LOCK/);
});

test('standard profile: behaviour unchanged — no guard, no gates', async () => {
  const router = jrRouter(DEFAULT_CONTROLS);
  router.profile = { ...STANDARD_PROFILE };
  const result = await router.handle('how do I make a bomb'); // classifyCommand owns this in standard
  assert.notEqual(result.source, 'jr-guard');
});

// Task 4 (games): "play tic tac toe" / "play rock paper scissors" and their
// narrow variants must resolve at the jr-game branch, not fall through to the
// model. The negative case — a sentence that merely CONTAINS the words —
// must NOT match, so an ordinary conversation about a sibling never opens a
// game board. #result spreads `extra` flat onto the result object (see
// router.js's #result), so the shape here is `result.game`/`result.success`
// directly, not a nested `meta` object — pinned explicitly below.
test('games ON: narrow "play tic tac toe" / "play rock paper scissors" phrasings open the board', async () => {
  const router = jrRouter({ ...DEFAULT_CONTROLS, games: true });
  const ttt = [
    'play tic tac toe', "let's play tic tac toe", 'play a game of tic tac toe',
    'tic tac toe', 'tic-tac-toe', 'tictactoe'
  ];
  const rps = [
    'play rock paper scissors', "let's play rock, paper, scissors", 'rock paper scissors'
  ];
  for (const phrase of ttt) {
    const result = await router.handle(phrase);
    assert.equal(result.source, 'jr-game', phrase);
    assert.equal(result.game, 'ttt', phrase);
    assert.equal(result.success, true, phrase);
  }
  for (const phrase of rps) {
    const result = await router.handle(phrase);
    assert.equal(result.source, 'jr-game', phrase);
    assert.equal(result.game, 'rps', phrase);
    assert.equal(result.success, true, phrase);
  }
});

test('games ON: a sentence merely mentioning the game does not open the board', async () => {
  const router = jrRouter({ ...DEFAULT_CONTROLS, games: true });
  const result = await router.handle("my brother won't play tic tac toe with me");
  assert.notEqual(result.source, 'jr-game');
});

test('games OFF: "play tic tac toe" never reaches the jr-game branch', async () => {
  const router = jrRouter({ ...DEFAULT_CONTROLS, games: false });
  const result = await router.handle('play tic tac toe');
  assert.notEqual(result.source, 'jr-game');
  const rps = await router.handle('play rock paper scissors');
  assert.notEqual(rps.source, 'jr-game');
});

test('standard profile: play tic tac toe reaches the model, not the jr-game branch', async () => {
  let aiCalled = false;
  const router = jrRouter(DEFAULT_CONTROLS, async (prompt, context) => {
    aiCalled = true;
    return { ok: true, text: 'x', source: 'local' };
  });
  router.profile = { ...STANDARD_PROFILE };
  const result = await router.handle('play tic tac toe');
  assert.notEqual(result.source, 'jr-game', 'standard build should not take the jr-game branch');
  assert.equal(aiCalled, true, 'model should have been called');
});

// Task 5 review holes: routines, focus mode, dashboard, close, and defense
// mode all reached a real service with every JR control switched off. Reuses
// the jrRouter() helper's throwing-proxy services (mine()) — if a gate is
// missing, the branch reaches a proxy and the test fails with a BOOBY TRAP
// rejection instead of a clean assertion failure.
test('gate holes closed: routines, focus mode, dashboard, close, defense', async () => {
  const router = jrRouter(Object.fromEntries(Object.keys(DEFAULT_CONTROLS).map((k) => [k, false])));
  router.config = {
    getSettings: () => ({
      kidName: 'Kid', personality: 'Witty, composed.', searchRoots: [], applications: {},
      projects: { anvil: 'C:\\anvil' },
      routines: { 'start work': { apps: ['chrome'], folders: ['anvil'] } },
      focusApps: ['chrome']
    })
  };
  for (const phrase of ['start work', 'turn on focus mode', 'anvil dashboard', 'close chrome', 'defense mode']) {
    const result = await router.handle(phrase);
    assert.match(result.source, /jr-gate|safety|local-core/, phrase);
  }
  // the throwing proxies prove no service was touched: reaching one throws, failing the test
});

test('routine with only folders needs files, not apps', async () => {
  const router = jrRouter({ ...DEFAULT_CONTROLS, apps: true });
  router.config = {
    getSettings: () => ({
      kidName: 'Kid', personality: 'Witty, composed.', searchRoots: [], applications: {},
      projects: {},
      routines: { 'start work': { apps: [], folders: ['anvil'] } }
    })
  };
  const result = await router.handle('start work');
  assert.equal(result.source, 'jr-gate');
});

// FIX 3 (Critical, task-6 review): routine folders bypass approved roots.
// A routine's folders are settings.json entries a kid can edit directly (or
// a parent can mistype), resolved through `(settings.projects || {})[folder]
// || folder` — so an entry that is not a known project name is opened AS A
// LITERAL PATH with no check at all, even though the ordinary "open the
// Anvil project" and "find and open ..." branches only ever reach paths
// vetted by the same approved-roots boundary path:open uses. This is the
// booby trap: `documents` here is `mine('documents')` (see jrRouter above),
// so if the router ever reaches `tools.openPath` on the unapproved path
// without first consulting `documents.isAllowed`, the BOOBY TRAP on `tools`
// fires and fails the test with a clear rejection instead of a silent pass.
test('JR + files ON: a routine folder outside approved roots is refused, tools.openPath never touched', async () => {
  const router = jrRouter({ ...DEFAULT_CONTROLS, files: true });
  router.documents = { isAllowed: (target) => target === 'C:\\Approved' };
  router.config = {
    getSettings: () => ({
      kidName: 'Kid', personality: 'Witty, composed.', searchRoots: [], applications: {},
      projects: {},
      routines: { 'start work': { apps: [], folders: ['C:\\NotApproved'] } }
    })
  };
  const result = await router.handle('start work'); // router.tools is still mine('tools') — a touch throws
  assert.equal(result.success, false);
  assert.match(result.response, /notapproved|not approved|approved/i);
});

test('JR + files ON: a routine whose folders are all approved still runs (no false refusal)', async () => {
  const opened = [];
  const router = jrRouter({ ...DEFAULT_CONTROLS, files: true });
  router.documents = { isAllowed: (target) => target === 'C:\\Approved' };
  router.tools = {
    openApplication: async (name) => { opened.push(name); return { ok: true, message: 'ok' }; },
    openPath: async (target) => { opened.push(target); return { ok: true, message: 'ok' }; },
    resolveApplication: () => null
  };
  router.config = {
    getSettings: () => ({
      kidName: 'Kid', personality: 'Witty, composed.', searchRoots: [], applications: {},
      projects: {},
      routines: { 'start work': { apps: [], folders: ['C:\\Approved'] } }
    })
  };
  const result = await router.handle('start work');
  assert.deepEqual(opened, ['C:\\Approved']);
  assert.equal(result.success, true);
});

// B2 (final-review blocker): badTarget's pre-flight check computed
// this.documents.isAllowed(...) guarded only by this.profile.files &&
// this.profile.contentLock — but this.documents is null whenever the
// `documents` control is off (main.js never constructs that service then,
// same invariant every other JR gate holds to). files ON + documents OFF is
// a perfectly normal checklist combination, so a folder routine must not
// crash reaching a null service; it must resolve some result.
test('JR + files ON, documents OFF (documents service null): a folder routine refuses via jr-gate, never touches tools', async () => {
  const router = jrRouter({ ...DEFAULT_CONTROLS, files: true, documents: false, contentLock: true });
  router.documents = null; // main.js never builds this service when documents is off
  router.tools = {
    openApplication: () => { throw new Error('BOOBY TRAP: tools.openApplication touched'); },
    openPath: () => { throw new Error('BOOBY TRAP: tools.openPath touched'); },
    resolveApplication: () => null
  };
  router.config = {
    getSettings: () => ({
      kidName: 'Kid', personality: 'Witty, composed.', searchRoots: [], applications: {},
      projects: {},
      routines: { 'start work': { apps: [], folders: ['anvil'] } }
    })
  };
  const result = await router.handle('start work');
  assert.equal(result.source, 'jr-gate', 'must refuse at the jr-gate when documents cannot be verified');
  assert.equal(result.success, false);
});

test('standard profile: routine folders are unchanged — no isAllowed check, no gate', async () => {
  const opened = [];
  const router = jrRouter(DEFAULT_CONTROLS);
  router.profile = { ...STANDARD_PROFILE };
  router.documents = mineThatThrowsIfTouched();
  router.tools = {
    openApplication: async (name) => { opened.push(name); return { ok: true, message: 'ok' }; },
    openPath: async (target) => { opened.push(target); return { ok: true, message: 'ok' }; },
    resolveApplication: () => null
  };
  router.config = {
    getSettings: () => ({
      kidName: 'Kid', personality: 'Witty, composed.', searchRoots: [], applications: {},
      projects: {},
      routines: { 'start work': { apps: [], folders: ['C:\\AnyPathAtAll'] } }
    })
  };
  const result = await router.handle('start work');
  assert.deepEqual(opened, ['C:\\AnyPathAtAll']);
  assert.equal(result.success, true);
});

function mineThatThrowsIfTouched() {
  return new Proxy({}, { get() { throw new Error('BOOBY TRAP: documents.isAllowed touched in standard profile'); } });
}

// Task 7 (fail-closed threading): the per-call-context-only design fails open
// when a caller forgets — the fix is core/router.js's #aiContext() helper,
// used at EVERY this.ai.reply()/answerFromDocuments() call site so none of
// them can forget to hand over `profile`/`jrPromptRules`. This test pins that
// for the three reply-reaching branches that are NOT the already-covered
// ordinary-talk branch: battle, create-report, and document-summarize. Each
// gets a fresh router with only the one control it needs switched on; where
// the branch also touches a booby-trapped service (documents/tools) that
// isn't the point of this test, it gets a minimal stub instead, per the task
// brief ("give it a minimal stub for this test only").
test('every reply-reaching branch threads profile + jrPromptRules through ai.reply (battle, create report, document summarize)', async () => {
  const captured = [];
  const aiReply = async (prompt, context) => { captured.push({ prompt, context }); return { ok: true, text: 'stub reply', source: 'local' }; };

  // Battle mode.
  {
    const router = jrRouter({ ...DEFAULT_CONTROLS, battle: true }, aiReply);
    captured.length = 0;
    const result = await router.handle('battle me about pizza vs tacos');
    assert.equal(captured.length, 1, 'battle must reach ai.reply exactly once');
    assert.equal(captured[0].context.profile.contentLock, true);
    assert.match(captured[0].context.jrPromptRules, /CONTENT LOCK/);
    assert.match(captured[0].context.jrPromptRules, /HOMEWORK RULE/i);
    assert.equal(result.source, 'battle');
  }

  // Create report — needs files ON; documents.createTextFile is stubbed
  // minimally since the point here is what reaches ai.reply, not file I/O.
  {
    const router = jrRouter({ ...DEFAULT_CONTROLS, files: true }, aiReply);
    router.documents = { createTextFile: async () => ({ ok: true, path: 'C:\\Docs\\notes.md', message: 'Created notes.md.' }) };
    captured.length = 0;
    await router.handle('create a report called notes about widgets');
    assert.equal(captured.length, 1, 'create report must reach ai.reply exactly once');
    assert.equal(captured[0].context.profile.contentLock, true);
    assert.match(captured[0].context.jrPromptRules, /CONTENT LOCK/);
  }

  // Document summarize — needs documents ON; tools.searchFiles and
  // documents.supports/readDocument are stubbed minimally for the same
  // reason as above.
  {
    const router = jrRouter({ ...DEFAULT_CONTROLS, documents: true }, aiReply);
    router.tools = { searchFiles: async () => [{ name: 'report.pdf', path: 'C:\\Docs\\report.pdf', type: 'file' }] };
    router.documents = { supports: () => true, readDocument: async () => ({ name: 'report.pdf', text: 'doc text', truncated: false }) };
    captured.length = 0;
    await router.handle('summarize report.pdf');
    assert.equal(captured.length, 1, 'document summarize must reach ai.reply exactly once');
    assert.equal(captured[0].context.profile.contentLock, true);
    assert.equal(captured[0].context.untrustedContent, true, 'summarize must keep its untrustedContent clamp');
    assert.match(captured[0].context.jrPromptRules, /CONTENT LOCK/);
  }
});
