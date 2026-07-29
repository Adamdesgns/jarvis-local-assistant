'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildToolRegistry, filterRegistryForProfile } = require('../core/tool-registry');
const { profileFor, DEFAULT_CONTROLS, STANDARD_PROFILE } = require('../core/variant');
const { AIService } = require('../core/ai-service');
const { buildJrPromptRules } = require('../core/kid-mode');

function registry() {
  return buildToolRegistry({
    tools: {}, tasks: {}, memory: {}, config: {}, documents: {},
    getCameras: () => null, getAi: () => null
  });
}

test('every tool row declares its feature (null means core on purpose)', () => {
  for (const tool of registry()) {
    assert.ok('feature' in tool, `${tool.name} must declare feature`);
  }
});

test('jr defaults: file/document/app/camera tools are gone; core survives', () => {
  const names = filterRegistryForProfile(registry(), profileFor('jr', DEFAULT_CONTROLS)).map((t) => t.name);
  assert.ok(names.includes('add_task'));
  assert.ok(names.includes('get_current_datetime'));
  for (const gated of ['search_files', 'read_file', 'open_application', 'look_at_camera']) {
    assert.ok(!names.includes(gated), `${gated} must be filtered`);
  }
});

test('flipping a control on restores exactly its tools', () => {
  const names = filterRegistryForProfile(registry(), profileFor('jr', { ...DEFAULT_CONTROLS, files: true })).map((t) => t.name);
  assert.ok(names.includes('search_files'));
  assert.ok(!names.includes('read_file'), 'read_file is documents, not files');
});

test('a tool added without a feature tag is DENIED in jr — off by default, on purpose', () => {
  const withStranger = [...registry(), { name: 'new_powerful_thing', parameters: {}, execute: async () => ({}) }];
  const names = filterRegistryForProfile(withStranger, profileFor('jr', DEFAULT_CONTROLS)).map((t) => t.name);
  assert.ok(!names.includes('new_powerful_thing'));
});

test('standard profile filters nothing', () => {
  assert.equal(filterRegistryForProfile(registry(), STANDARD_PROFILE).length, registry().length);
});

// Task 7 (fail-closed direction): main.js constructs AIService once, at boot,
// with the real jr PROFILE (see main.js's `new AIService(...)`). A caller
// that forgets to thread context.profile through an individual reply() call
// must still get the filtered belt — the effective profile falls back to the
// one captured at construction rather than to nothing. Driven through the
// real localReply()/mocked-fetch path (mirrors test/schedule-tools.test.js's
// established pattern) so this proves the actual wire payload, not just the
// private filter function in isolation.
test('AIService constructed with a jr profile filters the registry even when reply() context omits profile (fail closed)', async () => {
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
    const jrProfile = profileFor('jr', DEFAULT_CONTROLS); // files/documents/apps/cameras all off by default
    const ai = new AIService(
      { getSettings: () => ({ ollamaModel: 'qwen3:8b' }), getSecret: () => '' },
      registry(),
      { profile: jrProfile }
    );
    // Context deliberately omits `profile` entirely — the exact gap this fix closes.
    const result = await ai.localReply('find my homework file', {});
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    const names = calls[0].tools.map((t) => t.function.name);
    assert.ok(names.includes('add_task'), 'core tools are still offered');
    for (const gated of ['search_files', 'read_file', 'open_application', 'look_at_camera']) {
      assert.ok(!names.includes(gated), `${gated} must be filtered even though context omitted profile`);
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test('AIService without a construction-time profile is unaffected — a bare context still controls filtering (no regression)', async () => {
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
    const ai = new AIService({ getSettings: () => ({ ollamaModel: 'qwen3:8b' }), getSecret: () => '' }, registry());
    const result = await ai.localReply('open chrome', {});
    assert.equal(result.ok, true);
    const names = calls[0].tools.map((t) => t.function.name);
    assert.ok(names.includes('open_application'), 'standard construction (no profile) offers the full registry');
  } finally {
    global.fetch = originalFetch;
  }
});

// answerFromDocuments stays zero-tools, but the WORDS the model is told to
// use still need the content lock: this pins that the router's
// context.jrPromptRules (built with buildJrPromptRules()) actually reaches
// the systemOverride it hands to localReply/cloudReply.
test('answerFromDocuments appends jrPromptRules to its systemOverride when passed', async () => {
  const ai = new AIService({ getSettings: () => ({ aiMode: 'local' }), getSecret: () => '' });
  let capturedSystem = '';
  ai.localReply = async (question, ctx) => { capturedSystem = ctx.systemOverride; return { ok: true, source: 'ollama', text: 'Answer [1].' }; };
  const passages = [{ name: 'spec.pdf', path: 'C:\\Docs\\spec.pdf', page: 1, text: 'Some passage text.' }];
  const rules = buildJrPromptRules({ age: 11, kidName: 'Kid' });
  await ai.answerFromDocuments('what is it', passages, { jrPromptRules: rules });
  assert.match(capturedSystem, /only the passages/i, 'the grounded-answer rules must still be present');
  assert.match(capturedSystem, /CONTENT LOCK/, 'jrPromptRules must be appended');
  assert.match(capturedSystem, /HOMEWORK RULE/i, 'jrPromptRules must be appended in full');
});

test('answerFromDocuments without jrPromptRules is unaffected (no regression)', async () => {
  const ai = new AIService({ getSettings: () => ({ aiMode: 'local' }), getSecret: () => '' });
  let capturedSystem = '';
  ai.localReply = async (question, ctx) => { capturedSystem = ctx.systemOverride; return { ok: true, source: 'ollama', text: 'Answer [1].' }; };
  const passages = [{ name: 'spec.pdf', path: 'C:\\Docs\\spec.pdf', page: 1, text: 'Some passage text.' }];
  await ai.answerFromDocuments('what is it', passages);
  assert.match(capturedSystem, /only the passages/i);
  assert.doesNotMatch(capturedSystem, /CONTENT LOCK/);
});
