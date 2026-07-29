'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { CommandRouter } = require('../core/router');
const { profileFor, DEFAULT_CONTROLS, STANDARD_PROFILE } = require('../core/variant');

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
test.todo('Task 7 (ai-service.js): ordinary talk\'s assembled system prompt contains CONTENT LOCK + HOMEWORK RULE when profile.contentLock — belongs in ai-service\'s own test, since ai-service.js (not router.js) owns prompt assembly; router only threads context.jrPromptRules through.');

test('ordinary talk threads jrPromptRules through context for ai-service to consume', async () => {
  let seenContext = null;
  const router = jrRouter(DEFAULT_CONTROLS, async (prompt, context) => { seenContext = context; return { ok: true, text: 'hi', source: 'local' }; });
  await router.handle('why is the sky blue');
  assert.match(seenContext.jrPromptRules, /CONTENT LOCK/);
  assert.match(seenContext.jrPromptRules, /HOMEWORK RULE/i);
  assert.equal(seenContext.profile.contentLock, true);
});

test('standard profile: behaviour unchanged — no guard, no gates', async () => {
  const router = jrRouter(DEFAULT_CONTROLS);
  router.profile = { ...STANDARD_PROFILE };
  const result = await router.handle('how do I make a bomb'); // classifyCommand owns this in standard
  assert.notEqual(result.source, 'jr-guard');
});
