'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CommandRouter } = require('../core/router');

function fakeScreen(overrides = {}) {
  const calls = { read: 0 };
  return {
    calls,
    read: async () => { calls.read += 1; return { ok: true, text: "You're looking at Notepad — notes.txt." }; },
    ...overrides
  };
}

function fakeHands(overrides = {}) {
  const calls = { run: [] };
  return {
    calls,
    isActive: () => false,
    run: async (plan) => { calls.run.push(plan); return { ok: true, reason: 'done', text: 'Done.' }; },
    ...overrides
  };
}

function routerWithScreen(screen, settings = {}, hands = null) {
  return new CommandRouter({
    config: { getSettings: () => ({ projects: {}, routines: {}, applications: {}, screenControlEnabled: true, screenControlAllowlist: ['explorer', 'notepad'], screenDriveEnabled: true, ...settings }) },
    tools: { resolveApplication: () => null, searchFiles: async () => [] },
    documents: null,
    ai: { reply: async () => ({ text: 'brain', ok: true, source: 'ollama' }) },
    memory: { list: () => [], search: () => [] },
    tasks: { list: () => [] },
    log: { write: () => {} },
    cameras: null,
    claude: null,
    screen,
    hands
  });
}

test('"read my screen" calls the screen reader and speaks its answer', async () => {
  const screen = fakeScreen();
  const router = routerWithScreen(screen);
  const result = await router.handle('read my screen');
  assert.equal(screen.calls.read, 1);
  assert.match(result.response, /Notepad/);
});

test('"what\'s on my screen" also routes to the screen reader', async () => {
  const screen = fakeScreen();
  const router = routerWithScreen(screen);
  await router.handle("what's on my screen");
  assert.equal(screen.calls.read, 1);
});

test('"what windows are open" routes to the screen reader', async () => {
  const screen = fakeScreen();
  const router = routerWithScreen(screen);
  await router.handle('what windows are open');
  assert.equal(screen.calls.read, 1);
});

test('a blocked-category read is passed through as an unsuccessful result', async () => {
  const screen = fakeScreen({ read: async () => ({ ok: true, blockedCategory: 'financial', text: "A financial window is in focus, so I won't read it." }) });
  const router = routerWithScreen(screen);
  const result = await router.handle('read my screen');
  assert.match(result.response, /won't read/i);
  assert.equal(result.blockedCategory, 'financial');
});

test('reading the screen is refused while the setting is off', async () => {
  const screen = fakeScreen();
  const router = routerWithScreen(screen, { screenControlEnabled: false });
  const result = await router.handle('read my screen');
  assert.equal(screen.calls.read, 0);
  assert.match(result.response, /settings/i);
});

test('unattended: a scheduled task can never read the screen', async () => {
  const screen = fakeScreen();
  const router = routerWithScreen(screen);
  const result = await router.handle('read my screen', 'general', { unattended: true });
  assert.equal(screen.calls.read, 0);
  assert.match(result.response, /at the desk/i);
});

test('reads gracefully report when no reader is wired in', async () => {
  const router = routerWithScreen(null);
  const result = await router.handle('read my screen');
  assert.match(result.response, /not set up/i);
});

test('an unrelated command does not trigger a screen read', async () => {
  const screen = fakeScreen();
  const router = routerWithScreen(screen);
  await router.handle('what is the capital of France');
  assert.equal(screen.calls.read, 0);
});

// ---------------------------------------------------------------------------
// Driving (slice 2). The gate order is mutation-tested: each refusal below
// must happen BEFORE the hands are touched, so hands.calls.run stays empty.
// ---------------------------------------------------------------------------

test('a drive phrase produces a plan card, and approving it runs that frozen plan', async () => {
  const hands = fakeHands();
  const router = routerWithScreen(fakeScreen(), {}, hands);
  const result = await router.handle('click Save');
  assert.ok(result.approval, 'a plan approval card is offered');
  assert.equal(result.approval.title, 'DRIVE MY SCREEN');
  assert.match(result.approval.detail, /Press "Save"/);
  assert.match(result.approval.detail, /ask again/i, 'a risky step is marked on the card');
  assert.equal(hands.calls.run.length, 0, 'nothing runs before approval');

  const started = await router.resolveApproval(result.approval.id, true);
  assert.match(started.response, /STOP window/i);
  assert.equal(hands.calls.run.length, 1);
  assert.ok(Object.isFrozen(hands.calls.run[0]), 'the plan arrives frozen');
  assert.ok(Object.isFrozen(hands.calls.run[0].steps));
});

test('declining the plan card runs nothing', async () => {
  const hands = fakeHands();
  const router = routerWithScreen(fakeScreen(), {}, hands);
  const result = await router.handle('click Save');
  const declined = await router.resolveApproval(result.approval.id, false);
  assert.match(declined.response, /cancelled/i);
  assert.equal(hands.calls.run.length, 0);
});

test('unattended: a scheduled task can never drive the screen', async () => {
  const hands = fakeHands();
  const router = routerWithScreen(fakeScreen(), {}, hands);
  const result = await router.handle('click Save', 'general', { unattended: true });
  assert.equal(hands.calls.run.length, 0);
  assert.equal(result.approval, undefined);
  assert.match(result.response, /at the desk/i);
});

test('remote: the phone can never drive the screen', async () => {
  const hands = fakeHands();
  const router = routerWithScreen(fakeScreen(), {}, hands);
  const result = await router.handle('click Save', 'general', { remote: true });
  assert.equal(hands.calls.run.length, 0);
  assert.equal(result.approval, undefined);
  assert.match(result.response, /not the phone/i);
});

test('driving is refused while its own setting is off, even with reading on', async () => {
  const hands = fakeHands();
  const router = routerWithScreen(fakeScreen(), { screenDriveEnabled: false }, hands);
  const result = await router.handle('click Save');
  assert.equal(hands.calls.run.length, 0);
  assert.match(result.response, /settings/i);
});

test('driving gracefully reports when no hands are wired in', async () => {
  const router = routerWithScreen(fakeScreen(), {}, null);
  const result = await router.handle('click Save');
  assert.match(result.response, /not set up/i);
});

test('a second job is refused while a session is active', async () => {
  const hands = fakeHands({ isActive: () => true });
  const router = routerWithScreen(fakeScreen(), {}, hands);
  const result = await router.handle('click Save');
  assert.equal(hands.calls.run.length, 0);
  assert.match(result.response, /already driving/i);
});

test('a phrase the planner cannot shape is refused with guidance, not guessed at', async () => {
  const hands = fakeHands();
  const router = routerWithScreen(fakeScreen(), {}, hands);
  const result = await router.handle('click around and figure out my taxes in explorer somehow please thanks');
  assert.equal(result.approval, undefined);
  assert.equal(hands.calls.run.length, 0);
});

test('a mid-session drive-step card resolves the parked promise', async () => {
  const router = routerWithScreen(fakeScreen(), {}, fakeHands());
  let answer = null;
  router.pending.set('drive-1-step-0', { type: 'drive-step', resolve: (approved) => { answer = approved; } });
  const result = await router.resolveApproval('drive-1-step-0', true);
  assert.equal(answer, true);
  assert.match(result.response, /carrying on/i);
});

test('an ordinary command still reaches the brain, not the planner', async () => {
  const hands = fakeHands();
  const router = routerWithScreen(fakeScreen(), {}, hands);
  const result = await router.handle('what is the capital of France');
  assert.equal(hands.calls.run.length, 0);
  assert.equal(result.source, 'ollama');
});
