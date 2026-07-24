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

function routerWithScreen(screen, settings = {}) {
  return new CommandRouter({
    config: { getSettings: () => ({ projects: {}, routines: {}, applications: {}, screenControlEnabled: true, ...settings }) },
    tools: { resolveApplication: () => null, searchFiles: async () => [] },
    documents: null,
    ai: { reply: async () => ({ text: 'brain', ok: true, source: 'ollama' }) },
    memory: { list: () => [], search: () => [] },
    tasks: { list: () => [] },
    log: { write: () => {} },
    cameras: null,
    claude: null,
    screen
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
