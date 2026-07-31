'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { CommandRouter } = require('../core/router');
const { profileFor, DEFAULT_CONTROLS } = require('../core/variant');

function mine(name) {
  return new Proxy({}, { get() { throw new Error(`BOOBY TRAP: ${name} was touched`); } });
}

// A router with a settings store that actually holds adhdMode (so the
// persist path is exercised), and an AI whose reply is scripted per test.
function adhdRouter({ jr = false, reply } = {}) {
  const settings = { adhdMode: false, projects: {}, personality: 'Witty.', kidName: 'Kid' };
  return new CommandRouter({
    profile: jr ? profileFor('jr', { ...DEFAULT_CONTROLS, games: true }) : undefined,
    jrAge: () => 11,
    // The router gets the GATED READ view (no updateSettings), plus the
    // narrow persistAdhdMode writer — exactly the main.js shape.
    config: { getSettings: () => ({ ...settings }) },
    persistAdhdMode: (on) => { settings.adhdMode = on === true; },
    log: { write: () => {} },
    tasks: { add: () => ({}), list: () => [] },
    memory: { add: () => ({}), search: () => [], list: () => [] },
    tools: mine('tools'),
    documents: null,
    screen: mine('screen'),
    hands: mine('hands'),
    claude: mine('claude'),
    defense: null,
    cameras: mine('cameras'),
    ai: { reply: reply || (async () => ({ ok: true, text: 'plain answer', source: 'local' })) }
  });
}

const RECIPE = {
  ok: true, source: 'local',
  text: 'Here is how to make a bed:\n1. Open the crafting table.\n2. Place three wool in the top row.\n3. Place three planks in the middle row.'
};

test('turning ADHD mode on persists the setting and confirms', async () => {
  const router = adhdRouter();
  const on = await router.handle('adhd mode');
  assert.match(on.response, /simple-steps mode on/i);
  assert.equal(on.adhd, 'on');
  assert.equal(router.config.getSettings().adhdMode, true, 'persisted');
});

test('with the mode on, a multi-step answer becomes a one-step walk', async () => {
  const router = adhdRouter({ reply: async () => RECIPE });
  await router.handle('adhd mode');
  const first = await router.handle('how do I make a bed in minecraft');
  assert.match(first.response, /^Step 1 of 3\. Open the crafting table\.$/);
  assert.doesNotMatch(first.response, /wool|planks/, 'later steps are NOT spoken yet');
  assert.ok(router.steps, 'a walk is live');
});

test('next walks forward; the last step says so and ends the walk', async () => {
  const router = adhdRouter({ reply: async () => RECIPE });
  await router.handle('adhd mode');
  await router.handle('how do I make a bed');
  assert.match((await router.handle('next')).response, /^Step 2 of 3\. Place three wool/);
  assert.match((await router.handle('done')).response, /^Last step, number 3\./);
  const past = await router.handle('next');
  assert.match(past.response, /last one — you did it|anything else/i);
  assert.equal(router.steps, null, 'walk ended');
});

test('again repeats the current step without advancing', async () => {
  const router = adhdRouter({ reply: async () => RECIPE });
  await router.handle('adhd mode');
  await router.handle('how do I make a bed');
  await router.handle('next'); // on step 2
  assert.match((await router.handle('again')).response, /^Step 2 of 3\./);
  assert.match((await router.handle('what was that')).response, /^Step 2 of 3\./);
});

test('"just tell me the rest" reads what is left and ends the walk', async () => {
  const router = adhdRouter({ reply: async () => RECIPE });
  await router.handle('adhd mode');
  await router.handle('how do I make a bed');
  const rest = await router.handle('the rest');
  assert.match(rest.response, /wool.*planks/s);
  assert.equal(router.steps, null);
});

test('stop ends the walk; a fresh "next" afterward is ordinary talk', async () => {
  // Reply steps only for the bed question, so a cold "next" routes to a plain
  // answer rather than spawning a brand-new walk (the mode stays on).
  const router = adhdRouter({ reply: async (t) => (t.includes('bed') ? RECIPE : { ok: true, text: 'plain answer', source: 'local' }) });
  await router.handle('adhd mode');
  await router.handle('how do I make a bed');
  assert.match((await router.handle('stop')).response, /stop there/i);
  assert.equal(router.steps, null);
  const cold = await router.handle('next');
  assert.equal(cold.response, 'plain answer', 'no walk — routed to the model');
});

test('an unrelated question mid-walk routes normally and the walk waits', async () => {
  let asked = '';
  const router = adhdRouter({ reply: async (t) => { asked = t; return t.includes('bed') ? RECIPE : { ok: true, text: 'A creeper is a green mob.', source: 'local' }; } });
  await router.handle('adhd mode');
  await router.handle('how do I make a bed');
  await router.handle('next'); // step 2
  const detour = await router.handle('what is a creeper');
  assert.match(detour.response, /green mob/);
  assert.equal(asked, 'what is a creeper');
  assert.ok(router.steps, 'the walk is still parked');
  assert.match((await router.handle('next')).response, /^Last step, number 3\./, 'resumes where it left off');
});

test('a short answer is never chopped into a walk', async () => {
  const router = adhdRouter({ reply: async () => ({ ok: true, text: 'A creeper is a green mob that explodes.', source: 'local' }) });
  await router.handle('adhd mode');
  const answer = await router.handle('what is a creeper');
  assert.equal(answer.response, 'A creeper is a green mob that explodes.');
  assert.equal(router.steps, null);
});

test('normal mode off abandons a half-walk and stops stepping future answers', async () => {
  const router = adhdRouter({ reply: async () => RECIPE });
  await router.handle('adhd mode');
  await router.handle('how do I make a bed'); // walk live
  const off = await router.handle('normal mode');
  assert.equal(off.adhd, 'off');
  assert.equal(router.steps, null, 'half-walk abandoned');
  assert.equal(router.config.getSettings().adhdMode, false, 'persisted off');
  const whole = await router.handle('how do I make a bed');
  assert.match(whole.response, /crafting table.*wool.*planks/s, 'the whole answer, not a step');
});

test('a stale walk (idle) forgets itself so a late "next" starts nothing', async () => {
  const router = adhdRouter({ reply: async (t) => (t.includes('bed') ? RECIPE : { ok: true, text: 'plain answer', source: 'local' }) });
  await router.handle('adhd mode');
  await router.handle('how do I make a bed');
  router.steps.lastAt = Date.now() - (11 * 60 * 1000);
  const late = await router.handle('next');
  assert.equal(late.response, 'plain answer', 'idle walk expired; routed to the model');
  assert.equal(router.steps, null);
});

test('OFF by default: a multi-step answer is spoken whole', async () => {
  const router = adhdRouter({ reply: async () => RECIPE });
  const answer = await router.handle('how do I make a bed');
  assert.match(answer.response, /crafting table.*wool.*planks/s);
  assert.equal(router.steps, null);
});
