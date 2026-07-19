const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ScheduleStore } = require('../core/schedule-store');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-sched-'));
}

function validInput(overrides = {}) {
  return {
    name: 'Morning briefing',
    when: { time: '08:00', repeat: 'daily' },
    action: { kind: 'speak', text: 'Good morning' },
    ...overrides
  };
}

test('add returns an item with an id, enabled: true, and lastRunAt: null', () => {
  const dir = tmpDir();
  try {
    const store = new ScheduleStore(dir);
    const item = store.add(validInput());
    assert.ok(item.id);
    assert.equal(item.enabled, true);
    assert.equal(item.lastRunAt, null);
    assert.equal(item.lastResult, null);
    assert.equal(item.name, 'Morning briefing');
    assert.deepEqual(item.when, { time: '08:00', repeat: 'daily' });
    assert.deepEqual(item.action, { kind: 'speak', text: 'Good morning' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('add stamps createdAt with a parseable ISO timestamp near now', () => {
  const dir = tmpDir();
  try {
    const store = new ScheduleStore(dir);
    const before = Date.now();
    const item = store.add(validInput());
    const after = Date.now();
    assert.equal(typeof item.createdAt, 'string');
    const stamped = new Date(item.createdAt).getTime();
    assert.ok(!Number.isNaN(stamped));
    assert.ok(stamped >= before && stamped <= after);
    // Persisted, not just returned on the in-memory item.
    assert.equal(store.list()[0].createdAt, item.createdAt);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loading a schedules.json written before createdAt existed backfills it instead of leaving it undefined', () => {
  const dir = tmpDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
    const legacyItem = {
      id: 'legacy-1',
      name: 'Old item',
      when: { time: '08:00', repeat: 'daily', weekday: null },
      action: { kind: 'speak', text: 'Hi' },
      enabled: true,
      lastRunAt: null,
      lastResult: null
      // no createdAt — simulates data written before this field existed
    };
    fs.writeFileSync(path.join(dir, 'schedules.json'), JSON.stringify([legacyItem]), 'utf8');

    const store = new ScheduleStore(dir);
    const items = store.list();
    assert.equal(items.length, 1);
    assert.equal(typeof items[0].createdAt, 'string');
    assert.ok(!Number.isNaN(new Date(items[0].createdAt).getTime()));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('backfilled createdAt is persisted so it stays the same across reloads', () => {
  const dir = tmpDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
    const legacyItem = {
      id: 'legacy-1',
      name: 'Old item',
      when: { time: '08:00', repeat: 'daily', weekday: null },
      action: { kind: 'speak', text: 'Hi' },
      enabled: true,
      lastRunAt: null,
      lastResult: null
      // no createdAt — simulates data written before this field existed
    };
    fs.writeFileSync(path.join(dir, 'schedules.json'), JSON.stringify([legacyItem]), 'utf8');

    const first = new ScheduleStore(dir);
    const firstCreatedAt = first.list()[0].createdAt;
    assert.equal(typeof firstCreatedAt, 'string');

    // A fresh load (e.g. next app launch) must see the SAME createdAt that
    // was backfilled the first time, not a newly re-stamped value — a
    // pre-upgrade item's catch-up floor must not keep advancing forever.
    const second = new ScheduleStore(dir);
    const secondCreatedAt = second.list()[0].createdAt;
    assert.equal(secondCreatedAt, firstCreatedAt);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('add throws on empty name', () => {
  const dir = tmpDir();
  try {
    const store = new ScheduleStore(dir);
    assert.throws(() => store.add(validInput({ name: '' })));
    assert.throws(() => store.add(validInput({ name: '   ' })));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('add throws on bad time', () => {
  const dir = tmpDir();
  try {
    const store = new ScheduleStore(dir);
    assert.throws(() => store.add(validInput({ when: { time: '25:00', repeat: 'daily' } })));
    assert.throws(() => store.add(validInput({ when: { time: 'nope', repeat: 'daily' } })));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('add throws on unknown repeat', () => {
  const dir = tmpDir();
  try {
    const store = new ScheduleStore(dir);
    assert.throws(() => store.add(validInput({ when: { time: '08:00', repeat: 'yearly' } })));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('add throws on weekly without a weekday', () => {
  const dir = tmpDir();
  try {
    const store = new ScheduleStore(dir);
    assert.throws(() => store.add(validInput({ when: { time: '08:00', repeat: 'weekly' } })));
    // out of range weekday also invalid
    assert.throws(() => store.add(validInput({ when: { time: '08:00', repeat: 'weekly', weekday: 7 } })));
    // in range is fine
    const item = store.add(validInput({ when: { time: '08:00', repeat: 'weekly', weekday: 3 } }));
    assert.equal(item.when.weekday, 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('add throws on bad action kind or missing required action field', () => {
  const dir = tmpDir();
  try {
    const store = new ScheduleStore(dir);
    assert.throws(() => store.add(validInput({ action: { kind: 'unknown' } })));
    assert.throws(() => store.add(validInput({ action: { kind: 'speak' } })));
    assert.throws(() => store.add(validInput({ action: { kind: 'ask' } })));
    // briefing needs no extra field
    const item = store.add(validInput({ action: { kind: 'briefing' } }));
    assert.equal(item.action.kind, 'briefing');
    // ask with prompt is fine
    const item2 = store.add(validInput({ action: { kind: 'ask', prompt: 'What is on my plate today?' } }));
    assert.equal(item2.action.kind, 'ask');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('list reflects adds', () => {
  const dir = tmpDir();
  try {
    const store = new ScheduleStore(dir);
    assert.equal(store.list().length, 0);
    store.add(validInput());
    store.add(validInput({ name: 'Evening wrap-up' }));
    const items = store.list();
    assert.equal(items.length, 2);
    assert.deepEqual(items.map((i) => i.name).sort(), ['Evening wrap-up', 'Morning briefing']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('list returns copies, not live references', () => {
  const dir = tmpDir();
  try {
    const store = new ScheduleStore(dir);
    store.add(validInput());
    const items = store.list();
    items[0].name = 'mutated';
    assert.notEqual(store.list()[0].name, 'mutated');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('update merges when without dropping untouched keys', () => {
  const dir = tmpDir();
  try {
    const store = new ScheduleStore(dir);
    const item = store.add(validInput({ when: { time: '08:00', repeat: 'weekly', weekday: 2 } }));
    const updated = store.update(item.id, { when: { time: '09:30' } });
    assert.equal(updated.when.time, '09:30');
    assert.equal(updated.when.repeat, 'weekly');
    assert.equal(updated.when.weekday, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('update merges action shallowly and can update name/enabled', () => {
  const dir = tmpDir();
  try {
    const store = new ScheduleStore(dir);
    const item = store.add(validInput({ action: { kind: 'speak', text: 'Hello' } }));
    const updated = store.update(item.id, { action: { text: 'Hi there' }, name: 'Renamed', enabled: false });
    assert.equal(updated.action.kind, 'speak');
    assert.equal(updated.action.text, 'Hi there');
    assert.equal(updated.name, 'Renamed');
    assert.equal(updated.enabled, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('update returns null for a missing id', () => {
  const dir = tmpDir();
  try {
    const store = new ScheduleStore(dir);
    assert.equal(store.update('does-not-exist', { name: 'x' }), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('remove returns true then false', () => {
  const dir = tmpDir();
  try {
    const store = new ScheduleStore(dir);
    const item = store.add(validInput());
    assert.equal(store.remove(item.id), true);
    assert.equal(store.remove(item.id), false);
    assert.equal(store.list().length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('markRun stamps lastRunAt and lastResult', () => {
  const dir = tmpDir();
  try {
    const store = new ScheduleStore(dir);
    const item = store.add(validInput());
    const at = new Date().toISOString();
    const updated = store.markRun(item.id, { at, ok: true, text: 'Delivered the briefing' });
    assert.equal(updated.lastRunAt, at);
    assert.deepEqual(updated.lastResult, { at, ok: true, text: 'Delivered the briefing' });
    // Confirm persisted state, not just the return value.
    assert.equal(store.list()[0].lastRunAt, at);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('markRun truncates a long result text to 500 characters before persisting', () => {
  const dir = tmpDir();
  try {
    const store = new ScheduleStore(dir);
    const item = store.add(validInput());
    const at = new Date().toISOString();
    const longText = 'x'.repeat(2000);
    const updated = store.markRun(item.id, { at, ok: true, text: longText });
    assert.equal(updated.lastResult.text.length, 500);
    assert.equal(updated.lastResult.text, longText.slice(0, 500));
    // Confirm persisted state, not just the return value.
    assert.equal(store.list()[0].lastResult.text.length, 500);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('markRun returns null for a missing id', () => {
  const dir = tmpDir();
  try {
    const store = new ScheduleStore(dir);
    assert.equal(store.markRun('does-not-exist', { at: new Date().toISOString(), ok: true, text: 'x' }), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('items survive reload in a second ScheduleStore on the same dir', () => {
  const dir = tmpDir();
  try {
    const store = new ScheduleStore(dir);
    const item = store.add(validInput());
    store.markRun(item.id, { at: new Date().toISOString(), ok: false, text: 'Network unavailable' });

    const reloaded = new ScheduleStore(dir);
    const items = reloaded.list();
    assert.equal(items.length, 1);
    assert.equal(items[0].id, item.id);
    assert.equal(items[0].name, 'Morning briefing');
    assert.equal(items[0].lastResult.ok, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('persists atomically via a .tmp file that is renamed into place', () => {
  const dir = tmpDir();
  try {
    const store = new ScheduleStore(dir);
    store.add(validInput());
    const filePath = path.join(dir, 'schedules.json');
    assert.ok(fs.existsSync(filePath));
    assert.ok(!fs.existsSync(`${filePath}.tmp`));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
