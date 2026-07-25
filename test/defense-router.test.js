const test = require('node:test');
const assert = require('node:assert/strict');
const { CommandRouter } = require('../core/router');

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

test('the router routes defense mode through the service and flags the renderer', async () => {
  const calls = [];
  const router = makeRouter({ defense: { requestEnter: async (reason) => { calls.push(reason); return { ok: true, message: 'Defense mode. All cameras coming up.' }; } } });
  const result = await router.handle('defense mode');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { kind: 'manual' });
  assert.equal(result.source, 'defense');
  assert.equal(result.defense, 'enter');
  assert.match(result.response, /Defense mode/);
});

test('unattended runs can NEVER enter defense mode — the rail', async () => {
  const calls = [];
  const router = makeRouter({ defense: { requestEnter: async (reason) => { calls.push(reason); return { ok: true, message: 'x' }; } } });
  const result = await router.handle('defense mode', 'general', { unattended: true });
  assert.equal(calls.length, 0, 'requestEnter must not be called unattended');
  assert.equal(result.defense, undefined);
  assert.equal(result.success, false);
  assert.match(result.response, /needs you at the desk/i);
});

test('a service refusal (no Pro, no service) passes through honestly', async () => {
  const router = makeRouter({ defense: { requestEnter: async () => ({ ok: false, message: 'Cameras are a JARVIS Pro feature, sir.' }) } });
  const result = await router.handle('enter defense mode');
  assert.equal(result.defense, undefined);
  assert.equal(result.success, false);
  assert.match(result.response, /Pro/);

  const bare = makeRouter({});
  const bareResult = await bare.handle('defense mode');
  assert.equal(bareResult.success, false);
  assert.match(bareResult.response, /not set up/i);
});

test('stand down always exits, no gate in the way', async () => {
  const calls = [];
  const router = makeRouter({ defense: { requestEnter: async () => ({ ok: true, message: 'x' }), exit: () => calls.push('exit') } });
  const result = await router.handle('stand down');
  assert.equal(result.defense, 'exit');
  assert.equal(result.source, 'defense');
  assert.deepEqual(calls, ['exit']);
});

test('defense phrasings inside ordinary sentences still reach the brain', async () => {
  const prompts = [];
  const router = makeRouter({
    defense: { requestEnter: async () => { throw new Error('must not be called'); } },
    ai: { reply: async (prompt) => { prompts.push(prompt); return { ok: true, text: 'just chatting', source: 'local-ai' }; } }
  });
  const result = await router.handle('what is defense mode');
  assert.equal(prompts.length, 1);
  assert.match(result.response, /just chatting/);
});
