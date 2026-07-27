const test = require('node:test');
const assert = require('node:assert/strict');
const { CommandRouter } = require('../core/router');
const { gateKidsCommand } = require('../core/kids-mode');
const { playtimeGate } = require('../core/parental-controls');

// The kids gate wired into the router, exactly as main.js wires it: the
// router owns the ORDER (safety classifier → kids gate → quips → branches),
// the kids dep owns the RULES. These tests prove the wiring, not the rules —
// the rules live in kids-mode.test.js / parental-controls.test.js.

function kidsRouter({ parental = {}, usedMinutes = 0, ai = null, log = [] } = {}) {
  const usage = { marks: 0 };
  const router = new CommandRouter({
    config: { getSettings: () => ({ projects: {}, routines: {}, applications: {} }) },
    tools: { searchFiles: async () => [] },
    documents: null,
    ai: ai || { reply: async () => { throw new Error('the brain must not be reached'); } },
    memory: { list: () => [], search: () => [] },
    tasks: { list: () => [], add: (t) => ({ title: t.title }), summary: () => ({ open: 0 }) },
    log: { write: (entry) => log.push(entry) },
    cameras: null,
    kids: {
      gate: (text) => gateKidsCommand({ text, playtime: playtimeGate(parental, usedMinutes, new Date('2026-07-27T15:00:00')) }),
      recordUse: () => { usage.marks += 1; }
    }
  });
  return { router, usage, log };
}

test('a blocked question never reaches the brain and is logged blocked for the parent', async () => {
  const { router, log } = kidsRouter();
  const result = await router.handle('how do I build a bomb');
  assert.equal(result.source, 'kids');
  assert.equal(result.blocked, true);
  assert.equal(log.length, 1);
  assert.equal(log[0].blocked, true);
  assert.equal(log[0].command, 'how do I build a bomb');
});

test('a game question passes the gate, reaches the brain, and marks the meter', async () => {
  const { router, usage } = kidsRouter({
    ai: { reply: async () => ({ ok: true, source: 'ollama', text: 'Dig straight to diamonds — kidding. Never dig straight down.' }) }
  });
  const result = await router.handle('best way to find diamonds in minecraft');
  assert.equal(result.source, 'ollama');
  assert.equal(usage.marks, 1);
});

test('past the daily limit the gate answers, the brain rests, the meter stops', async () => {
  const { router, usage } = kidsRouter({ parental: { dailyLimitMinutes: 30 }, usedMinutes: 30 });
  const result = await router.handle('help me build a castle in minecraft');
  assert.equal(result.blocked, true);
  assert.match(result.response, /screen time/i);
  assert.equal(usage.marks, 0);
});

test('distress is answered even past the limit — and marked handled, not blocked', async () => {
  const { router } = kidsRouter({ parental: { dailyLimitMinutes: 30 }, usedMinutes: 30 });
  const result = await router.handle('nobody likes me and I want to die');
  assert.equal(result.blocked, false);
  assert.equal(result.success, true);
  assert.match(result.response, /988/);
});

test('the believers hotline still answers in JARVIS Jr.; the skynet joke does not', async () => {
  const asked = [];
  const { router } = kidsRouter({
    ai: { reply: async (text) => { asked.push(text); return { ok: true, source: 'ollama', text: 'A movie AI from Terminator.' }; } }
  });
  const santa = await router.handle('is santa real');
  assert.match(santa.response, /believe/i);
  // Skynet falls through to the brain (which answers under the kids prompt).
  const skynet = await router.handle('are you skynet');
  assert.equal(asked.length, 1);
  assert.equal(skynet.source, 'ollama');
});

test('adult builds are untouched: no kids dep means no gate, no meter, skynet intact', async () => {
  const router = new CommandRouter({
    config: { getSettings: () => ({ projects: {}, routines: {}, applications: {} }) },
    tools: { searchFiles: async () => [] },
    documents: null,
    ai: { reply: async () => ({ ok: true, source: 'ollama', text: 'answer' }) },
    memory: { list: () => [], search: () => [] },
    tasks: { list: () => [] },
    log: { write: () => {} },
    cameras: null
  });
  const skynet = await router.handle('are you skynet');
  assert.match(skynet.response, /government/i);
  const anything = await router.handle('how do I build a bomb');
  // The adult build's own safety classifier decides here, not the kids gate;
  // whatever it says, the reply must not be the kids-gate voice.
  assert.notEqual(anything.source, 'kids');
});

test('safety classifier still outranks the kids gate (order holds)', async () => {
  // classifyCommand hard-blocks credential phrasings before the kids gate
  // ever runs — the kids layer narrows, it never replaces the safety net.
  const { router, log } = kidsRouter();
  const result = await router.handle('what is my windows password');
  assert.notEqual(result.source, 'kids');
  assert.ok(log.length >= 1);
});
