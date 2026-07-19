const test = require('node:test');
const assert = require('node:assert/strict');
const { AIService } = require('../core/ai-service');

// Drives the cloud OpenAI agent path through the public reply() with a mocked
// global.fetch. gpt-5.6 models reason by default and /v1/chat/completions
// rejects tools+reasoning, so the agent brain must speak /v1/responses.
function cloudOpenAI(registry) {
  return new AIService({
    getSettings: () => ({ aiMode: 'cloud', cloudProvider: 'openai', openaiModel: 'gpt-5.6-terra' }),
    getSecret: (name) => (name === 'openaiKey' ? 'sk-test' : '')
  }, registry);
}

test('OpenAI agent speaks /v1/responses (not chat/completions) with stateless reasoning flags', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'At your service.' }] }] }), { status: 200 });
  };
  try {
    const result = await cloudOpenAI().reply('hello');
    assert.equal(result.ok, true);
    assert.equal(result.text, 'At your service.');
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/v1\/responses$/);
    const body = calls[0].body;
    assert.equal(body.model, 'gpt-5.6-terra');
    assert.equal(body.store, false);
    assert.deepEqual(body.include, ['reasoning.encrypted_content']);
    assert.equal(typeof body.max_output_tokens, 'number');
    assert.ok(!('max_tokens' in body) && !('max_completion_tokens' in body), 'legacy token fields are gone');
    assert.ok(typeof body.instructions === 'string' && body.instructions.length > 0, 'system prompt rides in instructions');
  } finally {
    global.fetch = originalFetch;
  }
});

test('OpenAI agent runs a full tool round-trip over /v1/responses', async () => {
  const originalFetch = global.fetch;
  const registry = [{
    name: 'add_task',
    description: 'Add a task',
    parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
    execute: async (args) => ({ ok: true, added: args.title })
  }];
  const reasoningItem = { type: 'reasoning', id: 'rs_1', encrypted_content: 'opaque…' };
  const callItem = { type: 'function_call', id: 'fc_1', call_id: 'call_7', name: 'add_task', arguments: '{"title":"review pdf"}' };
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    if (calls.length === 1) {
      return new Response(JSON.stringify({ output: [reasoningItem, callItem] }), { status: 200 });
    }
    return new Response(JSON.stringify({ output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Task added, sir.' }] }] }), { status: 200 });
  };
  try {
    const result = await cloudOpenAI(registry).reply('add a task to review the pdf');
    assert.equal(result.ok, true);
    assert.equal(result.text, 'Task added, sir.');
    assert.deepEqual(result.usedTools, ['add_task']);
    assert.equal(calls.length, 2);
    // First call advertises the tool in the FLAT responses format.
    assert.deepEqual(calls[0].body.tools?.[0], { type: 'function', name: 'add_task', description: 'Add a task', parameters: registry[0].parameters });
    // Second call replays the reasoning + call items and pairs the tool output by call_id.
    const input2 = calls[1].body.input;
    assert.ok(input2.some((item) => item.type === 'reasoning' && item.encrypted_content === 'opaque…'), 'reasoning replayed');
    assert.ok(input2.some((item) => item.type === 'function_call' && item.call_id === 'call_7'), 'function_call replayed');
    const output = input2.find((item) => item.type === 'function_call_output');
    assert.equal(output.call_id, 'call_7');
    assert.match(output.output, /"added":"review pdf"/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('OpenAI agent surfaces the API error message when /v1/responses rejects', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ error: { message: 'Invalid API key.' } }), { status: 401 });
  try {
    const result = await cloudOpenAI().reply('hello');
    assert.equal(result.ok, false);
    assert.match(result.text, /Invalid API key\./);
  } finally {
    global.fetch = originalFetch;
  }
});
