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
    { name: 'read_file', description: 'Read a file', parameters: { type: 'object', properties: {} }, execute: async () => ({ ok: true }) },
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
