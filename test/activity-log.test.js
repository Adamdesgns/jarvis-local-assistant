const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ActivityLog, describeIntegrity, normalizeActor } = require('../core/activity-log');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-activity-'));
}

function readLines(dir) {
  return fs.readFileSync(path.join(dir, 'activity.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function writeLines(dir, entries) {
  fs.writeFileSync(
    path.join(dir, 'activity.jsonl'),
    `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`,
    'utf8'
  );
}

// --- the actor field -------------------------------------------------------

test('write records the actor that did the thing', () => {
  const dir = tmpDir();
  try {
    const log = new ActivityLog(dir);
    log.write({ type: 'night-shift', command: 'morning-report', actor: 'night-shift' });
    const [entry] = readLines(dir);
    assert.equal(entry.actor, 'night-shift');
    assert.equal(entry.type, 'night-shift');
    assert.ok(!Number.isNaN(Date.parse(entry.timestamp)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an entry with no actor is recorded as system rather than left blank', () => {
  const dir = tmpDir();
  try {
    const log = new ActivityLog(dir);
    log.write({ type: 'command', command: 'hello' });
    assert.equal(readLines(dir)[0].actor, 'system');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a junk actor is normalized to system so the field stays trustworthy', () => {
  assert.equal(normalizeActor('NIGHT-SHIFT'), 'night-shift');
  assert.equal(normalizeActor('  jarvis  '), 'jarvis');
  assert.equal(normalizeActor(''), 'system');
  assert.equal(normalizeActor(42), 'system');
  assert.equal(normalizeActor(null), 'system');
  assert.equal(normalizeActor('../../etc/passwd'), 'system');
  assert.equal(normalizeActor('a name with spaces'), 'system');
});

test('a future crew member slug is allowed through unchanged', () => {
  // THE CREW (roadmap) adds named members; the field must not reject them.
  assert.equal(normalizeActor('starfield'), 'starfield');
  assert.equal(normalizeActor('files-hand'), 'files-hand');
});

// --- the chain -------------------------------------------------------------

test('each entry is sealed and points at the one before it', () => {
  const dir = tmpDir();
  try {
    const log = new ActivityLog(dir);
    log.write({ type: 'command', command: 'first', actor: 'jarvis' });
    log.write({ type: 'command', command: 'second', actor: 'jarvis' });
    log.write({ type: 'command', command: 'third', actor: 'agent' });

    const lines = readLines(dir);
    assert.equal(lines.length, 3);
    assert.deepEqual(lines.map((entry) => entry.seq), [1, 2, 3]);
    assert.equal(lines[0].prevHash, '0'.repeat(64));
    assert.equal(lines[1].prevHash, lines[0].hash);
    assert.equal(lines[2].prevHash, lines[1].hash);
    for (const entry of lines) assert.match(entry.hash, /^[0-9a-f]{64}$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the chain survives the log being reopened between writes', () => {
  const dir = tmpDir();
  try {
    new ActivityLog(dir).write({ type: 'command', command: 'before restart', actor: 'jarvis' });
    new ActivityLog(dir).write({ type: 'command', command: 'after restart', actor: 'jarvis' });

    const lines = readLines(dir);
    assert.deepEqual(lines.map((entry) => entry.seq), [1, 2]);
    assert.equal(lines[1].prevHash, lines[0].hash);
    assert.equal(new ActivityLog(dir).verify().ok, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a caller cannot forge the seal fields by passing them in', () => {
  const dir = tmpDir();
  try {
    const log = new ActivityLog(dir);
    log.write({ type: 'command', command: 'real', actor: 'jarvis' });
    log.write({ type: 'command', command: 'sneaky', actor: 'jarvis', seq: 99, prevHash: 'x'.repeat(64), hash: 'deadbeef' });

    const lines = readLines(dir);
    assert.equal(lines[1].seq, 2, 'seq is assigned by the log, not the caller');
    assert.equal(lines[1].prevHash, lines[0].hash);
    assert.notEqual(lines[1].hash, 'deadbeef');
    assert.equal(log.verify().ok, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- verify ----------------------------------------------------------------

test('verify passes on an untouched log', () => {
  const dir = tmpDir();
  try {
    const log = new ActivityLog(dir);
    log.write({ type: 'command', command: 'one', actor: 'jarvis' });
    log.write({ type: 'command', command: 'two', actor: 'night-shift' });

    const result = log.verify();
    assert.equal(result.ok, true);
    assert.equal(result.checked, 2);
    assert.equal(result.legacy, 0);
    assert.equal(describeIntegrity(result), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('verify passes when no log exists yet', () => {
  const dir = tmpDir();
  try {
    const result = new ActivityLog(dir).verify();
    assert.equal(result.ok, true);
    assert.equal(result.total, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('verify catches an entry edited in place', () => {
  const dir = tmpDir();
  try {
    const log = new ActivityLog(dir);
    log.write({ type: 'camera', command: 'live view', actor: 'cameras' });
    log.write({ type: 'command', command: 'two', actor: 'jarvis' });
    log.write({ type: 'command', command: 'three', actor: 'jarvis' });

    const lines = readLines(dir);
    lines[1].command = 'something else entirely';
    writeLines(dir, lines);

    const result = new ActivityLog(dir).verify();
    assert.equal(result.ok, false);
    assert.equal(result.brokenAt, 2);
    assert.match(result.reason, /changed after it was written/);
    assert.match(describeIntegrity(result), /activity log has been altered \(entry 2\)/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('verify catches an entry removed from the middle', () => {
  const dir = tmpDir();
  try {
    const log = new ActivityLog(dir);
    log.write({ type: 'command', command: 'one', actor: 'jarvis' });
    log.write({ type: 'command', command: 'the incriminating one', actor: 'agent' });
    log.write({ type: 'command', command: 'three', actor: 'jarvis' });

    const lines = readLines(dir);
    writeLines(dir, [lines[0], lines[2]]);

    const result = new ActivityLog(dir).verify();
    assert.equal(result.ok, false);
    assert.equal(result.brokenAt, 2);
    assert.match(result.reason, /removed or reordered/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('verify catches entries lopped off the end, which the chain alone cannot', () => {
  const dir = tmpDir();
  try {
    const log = new ActivityLog(dir);
    log.write({ type: 'command', command: 'one', actor: 'jarvis' });
    log.write({ type: 'command', command: 'two', actor: 'night-shift' });
    log.write({ type: 'command', command: 'three', actor: 'night-shift' });

    writeLines(dir, readLines(dir).slice(0, 1)); // sidecar still says seq 3

    const result = new ActivityLog(dir).verify();
    assert.equal(result.ok, false);
    assert.match(result.reason, /missing from the end/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('verify catches an unsealed entry spliced in', () => {
  const dir = tmpDir();
  try {
    const log = new ActivityLog(dir);
    log.write({ type: 'command', command: 'one', actor: 'jarvis' });
    const lines = readLines(dir);
    writeLines(dir, [lines[0], { type: 'command', command: 'I was never here', actor: 'jarvis' }]);

    const result = new ActivityLog(dir).verify();
    assert.equal(result.ok, false);
    assert.equal(result.brokenAt, 2);
    assert.match(result.reason, /no seal/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('verify treats a pre-existing unsealed log as legacy, not as tampering', () => {
  const dir = tmpDir();
  try {
    // What an install from before this change has on disk.
    writeLines(dir, [
      { timestamp: '2026-07-01T10:00:00.000Z', type: 'command', command: 'old one' },
      { timestamp: '2026-07-01T10:01:00.000Z', type: 'command', command: 'old two' }
    ]);

    const log = new ActivityLog(dir);
    const before = log.verify();
    assert.equal(before.ok, true, 'upgrading must not accuse the user of tampering');
    assert.equal(before.legacy, 2);
    assert.equal(before.checked, 0);

    log.write({ type: 'command', command: 'the first sealed one', actor: 'jarvis' });
    const after = log.verify();
    assert.equal(after.ok, true);
    assert.equal(after.legacy, 2);
    assert.equal(after.checked, 1);
    assert.equal(readLines(dir)[2].seq, 3, 'numbering continues past the legacy lines');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('verify still catches tampering in the sealed part of a part-legacy log', () => {
  const dir = tmpDir();
  try {
    writeLines(dir, [{ timestamp: '2026-07-01T10:00:00.000Z', type: 'command', command: 'old' }]);
    const log = new ActivityLog(dir);
    log.write({ type: 'command', command: 'sealed one', actor: 'jarvis' });
    log.write({ type: 'command', command: 'sealed two', actor: 'jarvis' });

    const lines = readLines(dir);
    lines[2].command = 'tampered';
    writeLines(dir, lines);

    const result = new ActivityLog(dir).verify();
    assert.equal(result.ok, false);
    assert.equal(result.brokenAt, 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('verify does not cry wolf when the sidecar lags behind the log', () => {
  const dir = tmpDir();
  try {
    const log = new ActivityLog(dir);
    log.write({ type: 'command', command: 'one', actor: 'jarvis' });
    const stale = JSON.parse(fs.readFileSync(path.join(dir, 'activity.head.json'), 'utf8'));
    log.write({ type: 'command', command: 'two', actor: 'jarvis' });
    // A sidecar write that failed after the entry landed leaves the head behind.
    fs.writeFileSync(path.join(dir, 'activity.head.json'), JSON.stringify(stale), 'utf8');

    assert.equal(new ActivityLog(dir).verify().ok, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('key order in the entry does not change the seal', () => {
  const dir = tmpDir();
  try {
    const log = new ActivityLog(dir);
    log.write({ type: 'command', command: 'one', response: 'ok', actor: 'jarvis' });
    const lines = readLines(dir);
    // Same facts, written back with the keys in a different order.
    const reordered = {};
    for (const key of Object.keys(lines[0]).reverse()) reordered[key] = lines[0][key];
    writeLines(dir, [reordered]);

    assert.equal(new ActivityLog(dir).verify().ok, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- the old contract holds ------------------------------------------------

test('recent returns the newest entries first and skips corrupt lines', () => {
  const dir = tmpDir();
  try {
    const log = new ActivityLog(dir);
    log.write({ type: 'command', command: 'one', actor: 'jarvis' });
    log.write({ type: 'command', command: 'two', actor: 'jarvis' });
    fs.appendFileSync(path.join(dir, 'activity.jsonl'), 'not json at all\n', 'utf8');
    log.write({ type: 'command', command: 'three', actor: 'jarvis' });

    const entries = log.recent(2);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].command, 'three');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('recent returns an empty list when no log exists yet', () => {
  const dir = tmpDir();
  try {
    assert.deepEqual(new ActivityLog(dir).recent(5), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('write never throws even when the log cannot be written', () => {
  const dir = tmpDir();
  try {
    const blocked = path.join(dir, 'not-a-dir');
    fs.writeFileSync(blocked, 'occupied', 'utf8');
    const log = new ActivityLog(path.join(blocked, 'deeper'));
    assert.doesNotThrow(() => log.write({ type: 'command', command: 'x', actor: 'jarvis' }));
    assert.doesNotThrow(() => log.verify());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
