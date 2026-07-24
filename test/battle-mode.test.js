const test = require('node:test');
const assert = require('node:assert/strict');
const { isBattleRequest, buildBattlePrompt } = require('../core/battle-mode');
const { CommandRouter } = require('../core/router');

test('isBattleRequest recognizes the battle phrasings and pulls the topic', () => {
  assert.deepEqual(isBattleRequest('battle me'), { topic: 'me, your challenger' });
  assert.deepEqual(isBattleRequest('Battle me about Mondays'), { topic: 'Mondays' });
  assert.deepEqual(isBattleRequest('rap battle'), { topic: 'me, your challenger' });
  assert.deepEqual(isBattleRequest('rap battle about pipefitting'), { topic: 'pipefitting' });
  assert.deepEqual(isBattleRequest('spit bars about cold garages'), { topic: 'cold garages' });
  assert.deepEqual(isBattleRequest('spit some bars'), { topic: 'me, your challenger' });
  assert.deepEqual(isBattleRequest('roast my truck in a rap'), { topic: 'my truck' });
  assert.deepEqual(isBattleRequest('rap roast slow wifi'), { topic: 'slow wifi' });
});

test('isBattleRequest leaves normal commands alone', () => {
  assert.equal(isBattleRequest('add battle ropes to my tasks'), null);
  assert.equal(isBattleRequest('what is a rap battle'), null);
  assert.equal(isBattleRequest('open the battle plan document'), null);
  assert.equal(isBattleRequest('roast beef recipe'), null);
  assert.equal(isBattleRequest('remind me to battle traffic at 5'), null);
});

test('buildBattlePrompt carries the topic, the style, and every hard rule', () => {
  const prompt = buildBattlePrompt('pipefitting');
  assert.match(prompt, /pipefitting/);
  assert.match(prompt, /internal rhyme|multisyllabic/i);
  assert.match(prompt, /JARVIS/);
  assert.match(prompt, /PG-13/i);
  assert.match(prompt, /never.*slurs|no slurs/i);
  assert.match(prompt, /never (?:quote|reproduce|copy).*(?:lyrics|songs)/i);
  assert.match(prompt, /8.*16|eight.*sixteen/i);
  assert.match(prompt, /only the bars|bars only|nothing but the bars/i);
});

test('the router routes battle requests to the brain with the battle prompt', async () => {
  const prompts = [];
  const router = new CommandRouter({
    config: { getSettings: () => ({ projects: {} }) },
    tools: {},
    ai: { reply: async (prompt) => { prompts.push(prompt); return { ok: true, text: 'Bars line one / bars line two', source: 'local-ai' }; } },
    memory: { list: () => [], search: () => [] },
    tasks: { summary: () => ({ open: 0, overdue: 0, tasks: [] }), list: () => [] },
    log: { write: () => {} }
  });
  const result = await router.handle('battle me about pipefitting');
  assert.match(result.response, /Bars line one/);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /pipefitting/);
  assert.match(prompts[0], /PG-13/i);
});

test('battle mode works unattended too — words are harmless', async () => {
  const router = new CommandRouter({
    config: { getSettings: () => ({ projects: {} }) },
    tools: {},
    ai: { reply: async () => ({ ok: true, text: 'Night bars', source: 'local-ai' }) },
    memory: { list: () => [], search: () => [] },
    tasks: { summary: () => ({ open: 0, overdue: 0, tasks: [] }), list: () => [] },
    log: { write: () => {} }
  });
  const result = await router.handle('spit bars about the night shift', 'general', { unattended: true });
  assert.match(result.response, /Night bars/);
});
