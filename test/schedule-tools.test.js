'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AIService } = require('../core/ai-service');
const { buildToolRegistry } = require('../core/tool-registry');

// ---- (a) unattended tool policy -------------------------------------------
// Mirrors the mocked-fetch style already used in test/brain-openai.test.js:
// drive the cloud OpenAI agent path through the public reply() and inspect
// the tool specs actually sent on the wire.

function cloudOpenAI(registry) {
  return new AIService({
    getSettings: () => ({ aiMode: 'cloud', cloudProvider: 'openai', openaiModel: 'gpt-5.6-terra' }),
    getSecret: (name) => (name === 'openaiKey' ? 'sk-test' : '')
  }, registry);
}

function stubRegistry() {
  return [
    { name: 'read_file', description: 'Read a file', unattendedSafe: true, parameters: { type: 'object', properties: {} }, execute: async () => ({ ok: true }) },
    { name: 'open_application', description: 'Open an approved application', parameters: { type: 'object', properties: {} }, execute: async () => ({ ok: true }) }
  ];
}

test('unattended: true withholds open_application from the tool specs handed to the adapter', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (_url, options = {}) => {
    calls.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done.' }] }] }), { status: 200 });
  };
  try {
    const result = await cloudOpenAI(stubRegistry()).reply('do the thing', { unattended: true });
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    const names = calls[0].tools.map((t) => t.name);
    assert.ok(!names.includes('open_application'), 'open_application must be withheld when unattended');
    assert.ok(names.includes('read_file'), 'other read/append-only tools must still be offered');
  } finally {
    global.fetch = originalFetch;
  }
});

test('without unattended, open_application is present in the tool specs', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (_url, options = {}) => {
    calls.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done.' }] }] }), { status: 200 });
  };
  try {
    const result = await cloudOpenAI(stubRegistry()).reply('do the thing');
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    const names = calls[0].tools.map((t) => t.name);
    assert.ok(names.includes('open_application'), 'open_application must be offered on attended runs');
  } finally {
    global.fetch = originalFetch;
  }
});

// ---- (a2) allowlist, not denylist — the real registry must be opt-in safe -
// The old policy was a denylist (UNATTENDED_DENIED = ['open_application']),
// which means any new actuating tool added later is permitted unattended by
// default. These tests pin the inverted policy: a tool is withheld unattended
// unless it explicitly carries unattendedSafe: true.

function realRegistry() {
  return buildToolRegistry({
    tools: {}, tasks: {}, memory: {}, config: {}, documents: null,
    getCameras: () => null, getAi: () => null
  });
}

test('tool-registry: unattendedSafe:true is set on every read/append-only tool, and absent from open_application', () => {
  const registry = realRegistry();
  const byName = Object.fromEntries(registry.map((tool) => [tool.name, tool]));
  const expectedSafe = ['add_task', 'list_open_tasks', 'remember_note', 'search_memory', 'search_files', 'read_file', 'get_current_datetime', 'look_at_camera'];
  for (const name of expectedSafe) {
    assert.ok(byName[name], `expected registry to contain ${name}`);
    assert.equal(byName[name].unattendedSafe, true, `${name} must be marked unattendedSafe: true`);
  }
  assert.notEqual(byName.open_application.unattendedSafe, true, 'open_application must NOT be marked unattendedSafe');
});

test('registry allowlist guard: every registry tool is either unattendedSafe:true or the known-unsafe open_application', () => {
  // This is the trip-wire the audit asked for: a future tool added to the
  // registry without an explicit unattendedSafe:true marker fails this test
  // instead of silently becoming callable from an unattended run.
  const registry = realRegistry();
  for (const tool of registry) {
    const explicitlySafe = tool.unattendedSafe === true;
    const knownUnsafe = tool.name === 'open_application';
    assert.ok(explicitlySafe || knownUnsafe,
      `Tool "${tool.name}" has neither unattendedSafe: true nor is the known-unsafe open_application. ` +
      'A new actuating tool must not be silently permitted unattended — mark it unattendedSafe: true if it is genuinely read/append-only.');
  }
});

test('unattended: reply() filters the real buildToolRegistry() output to only unattendedSafe tools', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (_url, options = {}) => {
    calls.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done.' }] }] }), { status: 200 });
  };
  try {
    const registry = realRegistry();
    const result = await cloudOpenAI(registry).reply('do the thing', { unattended: true });
    assert.equal(result.ok, true);
    const names = calls[0].tools.map((t) => t.name);
    assert.ok(!names.includes('open_application'), 'open_application must be withheld when unattended');
    for (const safe of ['add_task', 'list_open_tasks', 'remember_note', 'search_memory', 'search_files', 'read_file', 'get_current_datetime', 'look_at_camera']) {
      assert.ok(names.includes(safe), `${safe} must still be offered when unattended`);
    }
  } finally {
    global.fetch = originalFetch;
  }
});

// ---- (a3) localReply must also filter through #registryFor — it is the one
// tool-offering path (used by answerFromDocuments) that used to read
// this.registry directly, unfiltered by context.unattended. -----------------

test('localReply: given { unattended: true } offers only the filtered registry to the local model', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/api/tags')) {
      return new Response(JSON.stringify({ models: [{ name: 'qwen3:8b' }] }), { status: 200 });
    }
    calls.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ message: { content: 'Local response.' } }), { status: 200 });
  };
  try {
    const registry = realRegistry();
    const ai = new AIService({ getSettings: () => ({ ollamaModel: 'qwen3:8b' }), getSecret: () => '' }, registry);
    const result = await ai.localReply('do the thing', { unattended: true });
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    const names = calls[0].tools.map((t) => t.function.name);
    assert.ok(!names.includes('open_application'), 'open_application must be withheld from localReply when unattended');
    assert.ok(names.includes('read_file'), 'safe tools must still be offered to localReply when unattended');
  } finally {
    global.fetch = originalFetch;
  }
});

test('localReply: without unattended, open_application is still offered to the local model (no regression)', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/api/tags')) {
      return new Response(JSON.stringify({ models: [{ name: 'qwen3:8b' }] }), { status: 200 });
    }
    calls.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ message: { content: 'Local response.' } }), { status: 200 });
  };
  try {
    const registry = realRegistry();
    const ai = new AIService({ getSettings: () => ({ ollamaModel: 'qwen3:8b' }), getSecret: () => '' }, registry);
    const result = await ai.localReply('do the thing', {});
    assert.equal(result.ok, true);
    const names = calls[0].tools.map((t) => t.function.name);
    assert.ok(names.includes('open_application'), 'open_application must be offered on attended runs');
  } finally {
    global.fetch = originalFetch;
  }
});

// ---- (b) look_at_camera tool ----------------------------------------------

function fakeCameras({ list = [{ key: 'a:1', name: 'Front Door' }], snapshot = { ok: true, jpegBase64: 'x' } } = {}) {
  return {
    listCameras: async () => list,
    getSnapshot: async () => snapshot
  };
}

function fakeAi({ described = { ok: true, text: 'A porch.' }, withVision = true } = {}) {
  const ai = {};
  if (withVision) ai.describeCameraFrame = async () => described;
  return ai;
}

function registryFor({ getCameras, getAi }) {
  return buildToolRegistry({
    tools: {}, tasks: {}, memory: {}, config: {}, documents: null,
    getCameras, getAi
  });
}

function findTool(registry) {
  const tool = registry.find((item) => item.name === 'look_at_camera');
  assert.ok(tool, 'look_at_camera must be registered');
  return tool;
}

test('look_at_camera: happy path matches by name case-insensitively and returns the description', async () => {
  const registry = registryFor({ getCameras: () => fakeCameras(), getAi: () => fakeAi() });
  const tool = findTool(registry);
  const result = await tool.execute({ camera: 'front door' });
  assert.deepEqual(result, { ok: true, camera: 'Front Door', description: 'A porch.' });
});

test('look_at_camera: no cameras configured returns a friendly failure', async () => {
  const registry = registryFor({ getCameras: () => null, getAi: () => fakeAi() });
  const tool = findTool(registry);
  const result = await tool.execute({ camera: 'front door' });
  assert.equal(result.ok, false);
  assert.match(result.message, /no camera/i);
});

test('look_at_camera: unmatched camera name returns a friendly failure', async () => {
  const registry = registryFor({ getCameras: () => fakeCameras(), getAi: () => fakeAi() });
  const tool = findTool(registry);
  const result = await tool.execute({ camera: 'backyard' });
  assert.equal(result.ok, false);
  assert.match(result.message, /backyard/i);
});

test('look_at_camera: failed snapshot returns a friendly failure', async () => {
  const registry = registryFor({
    getCameras: () => fakeCameras({ snapshot: { ok: false, message: 'camera offline' } }),
    getAi: () => fakeAi()
  });
  const tool = findTool(registry);
  const result = await tool.execute({ camera: 'Front Door' });
  assert.equal(result.ok, false);
  assert.match(result.message, /camera offline/i);
});

test('look_at_camera: no vision model available returns a friendly failure', async () => {
  const registry = registryFor({
    getCameras: () => fakeCameras(),
    getAi: () => fakeAi({ withVision: false })
  });
  const tool = findTool(registry);
  const result = await tool.execute({ camera: 'Front Door' });
  assert.equal(result.ok, false);
  assert.match(result.message, /vision/i);
});

test('look_at_camera: vision model answering ok:false returns a friendly failure', async () => {
  const registry = registryFor({
    getCameras: () => fakeCameras(),
    getAi: () => fakeAi({ described: { ok: false } })
  });
  const tool = findTool(registry);
  const result = await tool.execute({ camera: 'Front Door' });
  assert.equal(result.ok, false);
  assert.match(result.message, /could not describe/i);
});
