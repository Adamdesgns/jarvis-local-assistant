'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { CommandRouter } = require('../core/router');
const { profileFor, DEFAULT_CONTROLS } = require('../core/variant');

// The voice RPS session: the orb plays on the main screen, the kid runs the
// countdown, and the router owns "the next utterance answers me" — the first
// state of its kind in this router. Mirrors router-jr.test.js's construction.

function mine(name) {
  return new Proxy({}, { get() { throw new Error(`BOOBY TRAP: ${name} was touched`); } });
}

function rpsRouter({ gameCamera = true, scores } = {}) {
  const settings = { kidName: 'Kid', personality: 'Witty.', searchRoots: [], projects: {}, applications: {} };
  return new CommandRouter({
    profile: profileFor('jr', { ...DEFAULT_CONTROLS, games: true, gameCamera }),
    jrAge: () => 11,
    config: { getSettings: () => ({ ...settings }) },
    log: { write: () => {} },
    tasks: { add: () => ({}), list: () => [] },
    memory: { add: () => ({}), search: () => [] },
    tools: mine('tools'),
    documents: mine('documents'),
    screen: mine('screen'),
    hands: mine('hands'),
    claude: mine('claude'),
    defense: null,
    cameras: mine('cameras'),
    scores: scores || { record: () => ({ rps: { wins: 0, losses: 0, draws: 0, streak: 0 } }) },
    ai: { reply: async () => ({ ok: true, text: 'model answer', source: 'local' }) }
  });
}

const SHAPES = ['rock', 'paper', 'scissors'];

test('arming: the ask starts a session, invites the chant, and never opens an overlay', async () => {
  const router = rpsRouter();
  const result = await router.handle("let's play rock paper scissors");
  assert.equal(result.source, 'jr-game');
  assert.equal(result.rps?.phase, 'invite');
  assert.equal(result.rps?.camera, true);
  assert.equal('game' in result, false, 'no .game key — the overlay path is dead for rps');
  assert.match(result.response, /rock, paper, scissors, shoot/i);
  assert.ok(router.rps, 'session live');
});

test('the camera flag mirrors the parent checklist', async () => {
  const router = rpsRouter({ gameCamera: false });
  const result = await router.handle('play rock paper scissors');
  assert.equal(result.rps?.camera, false);
});

test('shoot locks the throw BEFORE any capture, and the outcome judges against that same lock', async () => {
  const router = rpsRouter();
  await router.handle('play rock paper scissors');
  const shot = await router.handle('jarvis rock paper scissors shoot');
  assert.equal(shot.rps?.phase, 'shoot');
  assert.equal(shot.response, '', 'silent — the reveal speaks after the read');
  const locked = shot.rps.jarvisShape;
  assert.ok(SHAPES.includes(locked));
  // The camera "reads" a kid shape only now — after the lock.
  const outcome = router.rpsOutcome('rock');
  assert.equal(outcome.ok, true);
  assert.equal(outcome.jarvisShape, locked, 'judged against the pre-capture lock, not a re-roll');
  assert.match(outcome.line, /beats|Both/, 'the reveal names the shapes');
  assert.equal(router.rps.history.length, 1);
  assert.equal(router.rps.pendingThrow, null, 'consumed');
});

test('a re-shoot after a missed read keeps the SAME locked throw', async () => {
  const router = rpsRouter();
  await router.handle('play rock paper scissors');
  const first = await router.handle('shoot');
  const second = await router.handle('rock paper scissors shoot');
  assert.equal(second.rps.jarvisShape, first.rps.jarvisShape);
});

test('honor mode never spoils: ask first, morph at reveal', async () => {
  const router = rpsRouter({ gameCamera: false });
  await router.handle('play rock paper scissors');
  const shot = await router.handle('shoot');
  assert.equal(shot.rps?.phase, 'ask');
  assert.match(shot.response, /what did you throw/i);
  assert.equal(shot.rps.jarvisShape, undefined, 'the shape must not ride the ask — the kid could pick the winner');
  const reveal = await router.handle('i threw paper');
  assert.equal(reveal.rps?.phase, 'reveal');
  assert.ok(SHAPES.includes(reveal.rps.jarvisShape));
  assert.equal(reveal.rps.kidShape, 'paper');
  assert.match(reveal.response, /beats|Both/);
});

test('hard mode by voice affects the NEXT lock — a rock-kid gets papered', async () => {
  const router = rpsRouter();
  await router.handle('play rock paper scissors');
  // Two resolved rock rounds build the history hard mode reads.
  for (let i = 0; i < 2; i++) {
    await router.handle('shoot');
    assert.equal(router.rpsOutcome('rock').ok, true);
  }
  const diff = await router.handle('jarvis make it hard');
  assert.equal(diff.rps?.phase, 'difficulty');
  const shot = await router.handle('shoot');
  assert.equal(shot.rps.jarvisShape, 'paper', 'hard counters the favourite deterministically');
});

test('stop ends it with a recap; the next shoot is ordinary small talk', async () => {
  const router = rpsRouter();
  await router.handle('play rock paper scissors');
  await router.handle('shoot');
  router.rpsOutcome('rock');
  const stop = await router.handle("we're done");
  assert.equal(stop.rps?.phase, 'stop');
  assert.match(stop.response, /good game/i);
  assert.equal(router.rps, null);
  const cold = await router.handle('shoot');
  assert.equal(cold.response, 'model answer', 'no session — falls through to the model');
});

test('a quiet game expires: after the idle window the chant is just words', async () => {
  const router = rpsRouter();
  await router.handle('play rock paper scissors');
  router.rps.lastAt = Date.now() - (6 * 60 * 1000);
  const late = await router.handle('shoot');
  assert.equal(late.response, 'model answer');
  assert.equal(router.rps, null);
});

test('shoot with no game ever started falls through to the model', async () => {
  const router = rpsRouter();
  const result = await router.handle('rock paper scissors shoot');
  assert.equal(result.response, 'model answer');
});

test('rpsOutcome fails closed: no session, no pending throw, or a bad shape', async () => {
  const router = rpsRouter();
  assert.equal(router.rpsOutcome('rock').ok, false, 'no session');
  await router.handle('play rock paper scissors');
  assert.equal(router.rpsOutcome('rock').ok, false, 'no locked throw yet');
  await router.handle('shoot');
  assert.equal(router.rpsOutcome('lizard').ok, false, 'unknown shape');
  assert.equal(router.rpsOutcome('rock').ok, true, 'the honest path still works');
});

test('camera failure degrades the session to honor mode, not to death', async () => {
  const router = rpsRouter();
  await router.handle('play rock paper scissors');
  router.rpsCameraFailed();
  const shot = await router.handle('shoot');
  assert.equal(shot.rps?.phase, 'ask', 'honor mode took over');
});

test('the content guard still outranks the game: distress mid-session gets the care answer', async () => {
  const router = rpsRouter();
  await router.handle('play rock paper scissors');
  const guarded = await router.handle('i want to hurt myself');
  assert.equal(guarded.source, 'jr-guard');
  assert.ok(router.rps, 'and the session is merely bystanding, not consulted');
});

test('re-asking mid-session re-invites and keeps the score', async () => {
  const router = rpsRouter();
  await router.handle('play rock paper scissors');
  await router.handle('shoot');
  router.rpsOutcome('rock');
  const tallyBefore = { ...router.rps.tally };
  const again = await router.handle("let's play rock paper scissors");
  assert.equal(again.rps?.phase, 'invite');
  assert.deepEqual(router.rps.tally, tallyBefore, 'score carries across a re-invite');
});
