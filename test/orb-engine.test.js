const test = require('node:test');
const assert = require('node:assert/strict');
const { OrbEngine } = require('../src/orbs/orb-engine');

function fakeSkin(name) {
  return {
    label: name.toUpperCase(),
    create: () => ({ setState() {}, setPalette() {}, setPaused() {}, destroy() {} })
  };
}

test('register + list: skins appear in registration order with name and label', () => {
  const engine = new OrbEngine();
  engine.register('plasma', fakeSkin('plasma'));
  engine.register('zen', fakeSkin('zen'));
  assert.deepEqual(engine.list().map((s) => s.name), ['plasma', 'zen']);
  assert.equal(engine.list()[0].label, 'PLASMA');
});

test('resolve falls back to the first registered skin for unknown names', () => {
  const engine = new OrbEngine();
  engine.register('original', fakeSkin('original'));
  engine.register('plasma', fakeSkin('plasma'));
  assert.equal(engine.resolve('plasma').name, 'plasma');
  assert.equal(engine.resolve('does-not-exist').name, 'original');
  assert.equal(engine.resolve(undefined).name, 'original');
});

test('resolveExact returns a skin only when registered, null otherwise — the widget uses null to keep its classic ball', () => {
  const engine = new OrbEngine();
  engine.register('plasma', fakeSkin('plasma'));
  engine.register('zen', fakeSkin('zen'));
  assert.equal(engine.resolveExact('zen').name, 'zen');
  // 'original' lives only in the main window (hologram.js); in the widget it
  // must NOT silently become plasma the way resolve() would.
  assert.equal(engine.resolveExact('original'), null);
  assert.equal(engine.resolveExact(undefined), null);
  assert.equal(engine.resolveExact(''), null);
});

test('registering the same name twice replaces the earlier entry without duplicating', () => {
  const engine = new OrbEngine();
  engine.register('zen', fakeSkin('zen'));
  engine.register('zen', { label: 'Zen v2', create: () => null });
  assert.equal(engine.list().length, 1);
  assert.equal(engine.list()[0].label, 'Zen v2');
});

test('mapStateToMood maps every app state to a mood the skins understand', () => {
  const engine = new OrbEngine();
  assert.deepEqual(engine.mapStateToMood('ready'), { mood: 'idle', dim: false });
  assert.deepEqual(engine.mapStateToMood('listening'), { mood: 'listening', dim: false });
  assert.deepEqual(engine.mapStateToMood('speaking'), { mood: 'listening', dim: false });
  assert.deepEqual(engine.mapStateToMood('processing'), { mood: 'thinking', dim: false });
  assert.deepEqual(engine.mapStateToMood('exploding'), { mood: 'thinking', dim: false });
  assert.deepEqual(engine.mapStateToMood('error'), { mood: 'idle', dim: true });
  assert.deepEqual(engine.mapStateToMood('offline'), { mood: 'idle', dim: true });
  assert.deepEqual(engine.mapStateToMood('never-heard-of-it'), { mood: 'idle', dim: false });
});

test('normalizePalette allows gold and obsidian, falling back to gold', () => {
  const engine = new OrbEngine();
  assert.equal(engine.normalizePalette('gold'), 'gold');
  assert.equal(engine.normalizePalette('obsidian'), 'obsidian');
  assert.equal(engine.normalizePalette('neon-pink'), 'gold');
  assert.equal(engine.normalizePalette(undefined), 'gold');
});
