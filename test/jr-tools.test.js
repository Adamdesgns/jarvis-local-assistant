'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildToolRegistry, filterRegistryForProfile } = require('../core/tool-registry');
const { profileFor, DEFAULT_CONTROLS, STANDARD_PROFILE } = require('../core/variant');

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
