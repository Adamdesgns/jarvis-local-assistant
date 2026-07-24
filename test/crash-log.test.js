const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { CrashLog, installProcessHandlers } = require('../core/crash-log');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-crash-'));
}

function readLines(dir) {
  return fs.readFileSync(path.join(dir, 'crash.log'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test('record writes one JSON line with timestamp, source, name, message, and stack', () => {
  const dir = tmpDir();
  try {
    const log = new CrashLog(dir);
    log.record('main:uncaughtException', new TypeError('boom'));
    const lines = readLines(dir);
    assert.equal(lines.length, 1);
    const entry = lines[0];
    assert.ok(!Number.isNaN(Date.parse(entry.timestamp)));
    assert.equal(entry.source, 'main:uncaughtException');
    assert.equal(entry.name, 'TypeError');
    assert.equal(entry.message, 'boom');
    assert.ok(entry.stack.includes('TypeError: boom'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('record accepts a plain string rejection reason without throwing', () => {
  const dir = tmpDir();
  try {
    const log = new CrashLog(dir);
    log.record('main:unhandledRejection', 'it broke');
    const [entry] = readLines(dir);
    assert.equal(entry.name, 'Error');
    assert.equal(entry.message, 'it broke');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('record accepts undefined without throwing and still writes an entry', () => {
  const dir = tmpDir();
  try {
    const log = new CrashLog(dir);
    log.record('main:unhandledRejection', undefined);
    const [entry] = readLines(dir);
    assert.equal(entry.source, 'main:unhandledRejection');
    assert.equal(typeof entry.message, 'string');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('record never throws even when the target directory cannot be created', () => {
  const dir = tmpDir();
  try {
    // A file where the log directory should be makes mkdir/append fail.
    const blocked = path.join(dir, 'not-a-dir');
    fs.writeFileSync(blocked, 'occupied', 'utf8');
    const log = new CrashLog(path.join(blocked, 'deeper'));
    assert.doesNotThrow(() => log.record('main:uncaughtException', new Error('x')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tail returns the most recent entries newest-first', () => {
  const dir = tmpDir();
  try {
    const log = new CrashLog(dir);
    log.record('a', new Error('first'));
    log.record('b', new Error('second'));
    log.record('c', new Error('third'));
    const entries = log.tail(2);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].message, 'third');
    assert.equal(entries[1].message, 'second');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tail skips corrupt lines instead of failing', () => {
  const dir = tmpDir();
  try {
    const log = new CrashLog(dir);
    log.record('a', new Error('good'));
    fs.appendFileSync(path.join(dir, 'crash.log'), 'not json at all\n', 'utf8');
    const entries = log.tail(5);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].message, 'good');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tail returns an empty list when no crash log exists yet', () => {
  const dir = tmpDir();
  try {
    const log = new CrashLog(dir);
    assert.deepEqual(log.tail(5), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the log rotates once it grows past maxBytes, keeping one previous file', () => {
  const dir = tmpDir();
  try {
    const log = new CrashLog(dir, { maxBytes: 500 });
    for (let i = 0; i < 20; i += 1) {
      log.record('main:uncaughtException', new Error(`error number ${i}`));
    }
    const current = fs.statSync(path.join(dir, 'crash.log'));
    assert.ok(current.size <= 500 + 4096, 'current file stays near the cap');
    assert.ok(fs.existsSync(path.join(dir, 'crash.log.1')), 'previous file kept');
    // The newest entry is always in the current file.
    const entries = log.tail(1);
    assert.equal(entries[0].message, 'error number 19');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('record preserves fields from an error-shaped plain object, as arrives over IPC', () => {
  const dir = tmpDir();
  try {
    const log = new CrashLog(dir);
    log.record('renderer:main-window', {
      name: 'ReferenceError',
      message: 'thing is not defined',
      stack: 'ReferenceError: thing is not defined\n    at renderer.js:42'
    });
    const [entry] = readLines(dir);
    assert.equal(entry.name, 'ReferenceError');
    assert.equal(entry.message, 'thing is not defined');
    assert.ok(entry.stack.includes('renderer.js:42'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('record caps an enormous stack so one entry cannot bloat the log', () => {
  const dir = tmpDir();
  try {
    const log = new CrashLog(dir);
    const error = new Error('deep');
    error.stack = 'x'.repeat(50000);
    log.record('main:uncaughtException', error);
    const [entry] = readLines(dir);
    assert.ok(entry.stack.length <= 4000);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('installProcessHandlers records uncaught exceptions from the process', () => {
  const dir = tmpDir();
  try {
    const log = new CrashLog(dir);
    const fakeProcess = new EventEmitter();
    installProcessHandlers(fakeProcess, log);
    fakeProcess.emit('uncaughtException', new Error('escaped'));
    const [entry] = log.tail(1);
    assert.equal(entry.source, 'main:uncaughtException');
    assert.equal(entry.message, 'escaped');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('installProcessHandlers records unhandled promise rejections from the process', () => {
  const dir = tmpDir();
  try {
    const log = new CrashLog(dir);
    const fakeProcess = new EventEmitter();
    installProcessHandlers(fakeProcess, log);
    fakeProcess.emit('unhandledRejection', 'no await');
    const [entry] = log.tail(1);
    assert.equal(entry.source, 'main:unhandledRejection');
    assert.equal(entry.message, 'no await');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
