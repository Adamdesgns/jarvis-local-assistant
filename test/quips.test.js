const test = require('node:test');
const assert = require('node:assert/strict');
const { quipFor, QUIPS } = require('../core/quips');
const { CommandRouter } = require('../core/router');

// JARVIS's sense of humor. Quips are canned one-liners that beat the brain
// to the punch when the moment is right — context-aware, pure, and easy to
// extend. First resident: the house rule on 911 while defense mode is up
// (Adam, 2026-07-26). JARVIS cannot place calls on any build, so the joke
// never displaces a real capability — the honest alternative was "I can't
// make phone calls."

const HOUSE_LINE = /pop the trunk or open that safe/i;

test('defense mode + "dial 911" gets the house line', () => {
  assert.match(quipFor('dial 911', { defenseActive: true }), HOUSE_LINE);
});

test('the quip hears every phrasing of calling the law', () => {
  for (const phrase of [
    'call 911',
    'JARVIS, call 911',
    'call the police',
    'phone the cops',
    'ring the police',
    'get the police out here',
    'call 9-1-1',
    'call the po-po',
    'somebody call 911'
  ]) {
    assert.match(quipFor(phrase, { defenseActive: true }) || '', HOUSE_LINE, `${phrase} should get the house line`);
  }
});

test('no quip outside defense mode — ordinary chat stays ordinary', () => {
  assert.equal(quipFor('dial 911', { defenseActive: false }), null);
  assert.equal(quipFor('dial 911', {}), null);
  assert.equal(quipFor('dial 911'), null);
});

test('defense mode leaves unrelated requests alone', () => {
  for (const phrase of ['call mom', 'what time is it', 'who is at the front door', 'stand down', 'call the office']) {
    assert.equal(quipFor(phrase, { defenseActive: true }), null, `${phrase} must not trigger a quip`);
  }
});

// ---- The believers' hotline (Adam, 2026-07-26: "a question my kids can
// ask") — Santa, the Easter Bunny and the Tooth Fairy are real as long as
// you believe. Always on, defense mode or not, because these must NEVER be
// left to whatever a model feels like saying to a child.

test('"is Santa real" always keeps the magic, in any mood', () => {
  for (const phrase of [
    'is santa real',
    'Is Santa Claus real?',
    'is santa claus really real',
    'does santa exist',
    'is santa fake',
    'is santa made up',
    'JARVIS, is Santa real?'
  ]) {
    const reply = quipFor(phrase, {}) || '';
    assert.match(reply, /real as long as you believe/i, `${phrase} must keep the magic`);
  }
});

test('the Easter Bunny and the Tooth Fairy get the same protection', () => {
  assert.match(quipFor('is the easter bunny real', {}) || '', /believe/i);
  assert.match(quipFor('does the easter bunny exist', {}) || '', /believe/i);
  assert.match(quipFor('is the tooth fairy real', {}) || '', /believe/i);
  assert.match(quipFor('is the tooth fairy fake', {}) || '', /believe/i);
});

test('believer questions that are not reality checks go to the brain', () => {
  for (const phrase of ['when is santa coming', 'what does the easter bunny eat', 'call santa']) {
    assert.equal(quipFor(phrase, {}), null, `${phrase} is the brain's to answer`);
  }
});

// ---- Impossible-request easter eggs ------------------------------------

test('"self destruct" gets a joke, armed or not', () => {
  assert.match(quipFor('self destruct', {}) || '', /kidding/i);
  assert.match(quipFor('initiate self-destruct sequence', { defenseActive: true }) || '', /kidding/i);
});

test('"open the pod bay doors" gets the obvious answer', () => {
  assert.match(quipFor('open the pod bay doors', {}) || '', /pod bay doors/i);
});

test('every quip declares its whole shape — id, when, pattern, reply', () => {
  // The table is the extension point; a half-declared entry would silently
  // never fire or fire everywhere.
  assert.ok(QUIPS.length >= 1);
  for (const quip of QUIPS) {
    assert.ok(quip.id && typeof quip.id === 'string');
    assert.equal(typeof quip.when, 'function');
    assert.ok(quip.pattern instanceof RegExp);
    assert.ok(quip.reply && typeof quip.reply === 'string');
  }
});

// ---- Router integration -----------------------------------------------

function makeRouter({ defense, ai } = {}) {
  return new CommandRouter({
    config: { getSettings: () => ({ projects: {} }) },
    tools: {},
    ai: ai || { reply: async () => ({ ok: true, text: 'brain answer', source: 'local-ai' }) },
    memory: { list: () => [], search: () => [] },
    tasks: { summary: () => ({ open: 0, overdue: 0, tasks: [] }), list: () => [] },
    log: { write: () => {} },
    defense
  });
}

test('router: "dial 911" during active defense gets the quip, not the brain', async () => {
  const prompts = [];
  const router = makeRouter({
    defense: { status: () => ({ active: true }) },
    ai: { reply: async (prompt) => { prompts.push(prompt); return { ok: true, text: 'brain', source: 'local-ai' }; } }
  });
  const result = await router.handle('dial 911');
  assert.equal(prompts.length, 0, 'the brain must never answer this one');
  assert.match(result.response, HOUSE_LINE);
});

test('router: same words with defense down go to the brain as usual', async () => {
  const prompts = [];
  const router = makeRouter({
    defense: { status: () => ({ active: false }) },
    ai: { reply: async (prompt) => { prompts.push(prompt); return { ok: true, text: 'just chatting', source: 'local-ai' }; } }
  });
  const result = await router.handle('dial 911');
  assert.equal(prompts.length, 1);
  assert.match(result.response, /just chatting/);
});

test('router: a defense object without status() never crashes the quip check', async () => {
  // Older tests and older callers hand the router minimal defense mocks.
  const router = makeRouter({ defense: {} });
  const result = await router.handle('dial 911');
  assert.ok(result.response, 'must fall through to a normal answer');
  assert.doesNotMatch(result.response, HOUSE_LINE);
});
