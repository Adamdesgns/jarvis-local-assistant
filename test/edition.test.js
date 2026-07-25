const test = require('node:test');
const assert = require('node:assert');
const {
  resolveEdition, currentEdition, profileFor, isJunior, can, filterRegistryForEdition, EDITIONS
} = require('../core/edition');

test('an unknown, empty or missing edition falls back to standard', () => {
  assert.equal(resolveEdition('junior'), 'junior');
  assert.equal(resolveEdition('JUNIOR'), 'junior');
  assert.equal(resolveEdition('standard'), 'standard');
  assert.equal(resolveEdition('kids'), 'standard');
  assert.equal(resolveEdition(''), 'standard');
  assert.equal(resolveEdition(undefined), 'standard');
  assert.equal(resolveEdition(null), 'standard');
});

test('the edition comes from the environment first, then the packaged stamp', () => {
  assert.equal(currentEdition({ env: {}, stamp: {} }), 'standard');
  assert.equal(currentEdition({ env: {}, stamp: { jarvisEdition: 'junior' } }), 'junior');
  assert.equal(currentEdition({ env: { JARVIS_EDITION: 'junior' }, stamp: {} }), 'junior');
  // A developer running the junior build from a standard checkout, and back.
  assert.equal(currentEdition({ env: { JARVIS_EDITION: 'standard' }, stamp: { jarvisEdition: 'junior' } }), 'standard');
});

test('the junior profile switches off everything that reaches out of the app', () => {
  const junior = profileFor('junior');
  for (const capability of ['files', 'documents', 'applications', 'power', 'cameras', 'screenRead', 'screenDrive', 'claudeBridge', 'nightShift', 'schedules', 'phone']) {
    assert.equal(junior[capability], false, `${capability} must be off in the junior build`);
    assert.equal(can('junior', capability), false);
  }
  for (const capability of ['kidBrain', 'storyTime', 'starChart', 'kidRoutines', 'parentLock']) {
    assert.equal(can('junior', capability), true, `${capability} must be on in the junior build`);
  }
});

test('the standard build is untouched: everything it always had is still on, and no kid feature leaks in', () => {
  for (const capability of ['files', 'documents', 'applications', 'power', 'cameras', 'screenRead', 'screenDrive', 'claudeBridge', 'nightShift', 'schedules', 'phone']) {
    assert.equal(can('standard', capability), true);
  }
  for (const capability of ['kidBrain', 'storyTime', 'starChart', 'kidRoutines', 'parentLock']) {
    assert.equal(can('standard', capability), false);
  }
});

test('profiles are frozen, so nothing can widen a capability at runtime', () => {
  const junior = profileFor('junior');
  assert.throws(() => { 'use strict'; junior.files = true; }, TypeError);
  assert.equal(can('junior', 'files'), false);
});

test('every edition in the list has a profile, and every profile names its own edition', () => {
  for (const edition of EDITIONS) {
    assert.equal(profileFor(edition).edition, edition);
    assert.ok(profileFor(edition).productName);
    assert.ok(Array.isArray(profileFor(edition).ui));
  }
});

test('the junior tool belt is an allowlist: unflagged tools are dropped, not kept', () => {
  const registry = [
    { name: 'read_file' },
    { name: 'open_application' },
    { name: 'remember_note', kidSafe: true },
    { name: 'list_my_jobs', kidSafe: true },
    // The shape a future careless addition takes: powerful, unflagged.
    { name: 'wipe_the_disk', unattendedSafe: true }
  ];
  const junior = filterRegistryForEdition(registry, 'junior').map((tool) => tool.name);
  assert.deepEqual(junior, ['remember_note', 'list_my_jobs']);
  // The standard build keeps its whole belt.
  assert.equal(filterRegistryForEdition(registry, 'standard').length, 5);
});

test('kidSafe: false and a truthy-but-not-true flag are both refused', () => {
  const registry = [
    { name: 'a', kidSafe: false },
    { name: 'b', kidSafe: 'yes' },
    { name: 'c', kidSafe: 1 },
    { name: 'd', kidSafe: true }
  ];
  assert.deepEqual(filterRegistryForEdition(registry, 'junior').map((tool) => tool.name), ['d']);
});

test('a missing or malformed registry never throws', () => {
  assert.deepEqual(filterRegistryForEdition(null, 'junior'), []);
  assert.deepEqual(filterRegistryForEdition(undefined, 'standard'), []);
  assert.deepEqual(filterRegistryForEdition([null, undefined, { name: 'x', kidSafe: true }], 'junior').map((t) => t.name), ['x']);
});

test('isJunior only says yes to the junior edition', () => {
  assert.equal(isJunior('junior'), true);
  assert.equal(isJunior('standard'), false);
  assert.equal(isJunior('kid'), false);
  assert.equal(isJunior(undefined), false);
});
