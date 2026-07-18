const test = require('node:test');
const assert = require('node:assert/strict');
const { AIService } = require('../core/ai-service');

// Drives the cloud OpenAI agent path through the public reply() with a mocked
// global.fetch, so we exercise the real /v1/chat/completions request body.
function cloudOpenAI() {
  return new AIService({
    getSettings: () => ({ aiMode: 'cloud', cloudProvider: 'openai', openaiModel: 'gpt-5.6-luna' }),
    getSecret: (name) => (name === 'openaiKey' ? 'sk-test' : '')
  });
}

test('OpenAI agent call uses max_completion_tokens (GPT-5 models reject max_tokens)', async () => {
  const originalFetch = global.fetch;
  const bodies = [];
  global.fetch = async (url, options = {}) => {
    bodies.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Done.' } }] }), { status: 200 });
  };
  try {
    const result = await cloudOpenAI().reply('hello');
    assert.equal(result.ok, true);
    assert.ok(bodies.length >= 1, 'made at least one chat request');
    assert.ok('max_completion_tokens' in bodies[0], 'sends max_completion_tokens');
    assert.ok(!('max_tokens' in bodies[0]), 'does not send the legacy max_tokens field');
  } finally {
    global.fetch = originalFetch;
  }
});

test('OpenAI agent call retries with max_tokens if the endpoint rejects max_completion_tokens', async () => {
  const originalFetch = global.fetch;
  const bodies = [];
  global.fetch = async (url, options = {}) => {
    const body = JSON.parse(options.body);
    bodies.push(body);
    // Simulate an older model / OpenAI-compatible endpoint that only accepts the legacy field.
    if ('max_completion_tokens' in body) {
      return new Response(JSON.stringify({
        error: { message: "Unsupported parameter: 'max_completion_tokens' is not supported with this model. Use 'max_tokens' instead." }
      }), { status: 400 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Done.' } }] }), { status: 200 });
  };
  try {
    const result = await cloudOpenAI().reply('hello');
    assert.equal(result.ok, true, 'recovers by swapping the token field');
    assert.ok('max_completion_tokens' in bodies[0], 'first attempt uses the modern field');
    assert.ok(bodies.some((b) => 'max_tokens' in b), 'retries with the legacy field');
  } finally {
    global.fetch = originalFetch;
  }
});
