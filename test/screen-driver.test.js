'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { ScreenDriver } = require('../core/screen-driver');
const { ScreenHands } = require('../core/screen-drive-session');

// ---------------------------------------------------------------------------
// A scripted stand-in for the PowerShell helper: everything written to stdin
// is recorded, and `responder` decides what (if anything) comes back.
// ---------------------------------------------------------------------------

function fakeChild(responder) {
  const child = new EventEmitter();
  child.pid = 4321;
  child.exitCode = null;
  child.killed = false;
  child.stdinLines = [];
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr = new EventEmitter();
  child.stderr.setEncoding = () => {};
  child.reply = (id, body) => child.stdout.emit('data', `${JSON.stringify({ id, ...body })}\n`);
  child.stdin = {
    write(line) {
      for (const one of String(line).split('\n').filter(Boolean)) {
        child.stdinLines.push(one);
        const request = JSON.parse(one);
        if (request.cmd === 'quit') continue;
        const answer = responder(request, child);
        if (answer !== undefined && answer !== null) {
          Promise.resolve(answer).then((body) => child.reply(request.id, body));
        }
      }
      return true;
    }
  };
  child.kill = () => {
    child.killed = true;
    setImmediate(() => child.emit('close', 0));
  };
  return child;
}

function echoResponder(script = {}) {
  let snapshots = -1;
  return (request) => {
    if (request.cmd === 'ping') return { ok: true, pong: true };
    if (request.cmd === 'snapshot') {
      snapshots += 1;
      const list = script.windows || [{ processName: 'notepad.exe', pid: 41, title: 'Untitled - Notepad', integrity: 'medium' }];
      return { ok: true, foreground: list[Math.min(snapshots, list.length - 1)] };
    }
    if (request.cmd === 'resolve') return script.resolve || { ok: true, count: 1, matches: [{ ref: 'e1', name: request.target?.name || 'Thing', control: 'Button', isPassword: false, enabled: true }] };
    if (request.cmd === 'invoke' || request.cmd === 'setValue' || request.cmd === 'focusWindow') return { ok: true, pid: 41, processName: 'notepad.exe', durationMs: 5 };
    return { ok: false, error: 'bad-request' };
  };
}

function makeDriver(responder, options = {}) {
  const spawnCalls = [];
  let child;
  const driver = new ScreenDriver({
    scriptPath: 'C:\\fixed\\path\\drive-screen.ps1',
    spawn: (cli, args, opts) => {
      spawnCalls.push({ cli, args, opts });
      if (cli === 'taskkill') return new EventEmitter();
      child = fakeChild(responder);
      return child;
    },
    commandTimeoutMs: options.commandTimeoutMs || 500,
    killGraceMs: options.killGraceMs || 40
  });
  return { driver, spawnCalls, getChild: () => child };
}

// ---------------------------------------------------------------------------
// Spawn shape — the same contract the screen reader is held to.
// ---------------------------------------------------------------------------

test('the helper is spawned shell:false, hidden, -File with the fixed script path', async () => {
  const { driver, spawnCalls } = makeDriver(echoResponder());
  const started = await driver.start();
  assert.equal(started.ok, true);
  const { args, opts } = spawnCalls[0];
  assert.equal(opts.shell, false, 'shell:false is the whole point');
  assert.equal(opts.windowsHide, true);
  assert.deepEqual(args, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'C:\\fixed\\path\\drive-screen.ps1']);
  driver.stop();
});

test('text to type travels inside stdin JSON — argv never carries free text', async () => {
  const { driver, spawnCalls, getChild } = makeDriver(echoResponder());
  await driver.start();
  const secret = 'totally private sentence';
  await driver.setValue('e1', secret, { pid: 41 });
  const argvJoined = spawnCalls.map(({ cli, args }) => [cli, ...(args || [])].join(' ')).join(' ');
  assert.ok(!argvJoined.includes(secret), 'no free text on any command line');
  assert.ok(getChild().stdinLines.some((line) => JSON.parse(line).text === secret), 'the text went over stdin as JSON');
  driver.stop();
});

// ---------------------------------------------------------------------------
// Protocol mechanics.
// ---------------------------------------------------------------------------

test('responses correlate by id even when they arrive out of order', async () => {
  let held;
  const responder = (request, child) => {
    if (request.cmd === 'ping') return { ok: true };
    if (request.cmd === 'snapshot') { held = request.id; return null; } // answered later
    if (request.cmd === 'resolve') {
      // Answer the resolve first, then release the earlier snapshot.
      setImmediate(() => child.reply(held, { ok: true, foreground: { processName: 'late.exe' } }));
      return { ok: true, count: 0, matches: [] };
    }
    return { ok: true };
  };
  const { driver } = makeDriver(responder);
  await driver.start();
  const [snap, resolved] = await Promise.all([driver.snapshot(), driver.resolve({ name: 'X' })]);
  assert.equal(snap.foreground.processName, 'late.exe');
  assert.equal(resolved.count, 0);
  driver.stop();
});

test('a response split across chunks is reassembled', async () => {
  const responder = (request, child) => {
    if (request.cmd === 'ping') return { ok: true };
    if (request.cmd === 'snapshot') {
      const whole = `${JSON.stringify({ id: request.id, ok: true, foreground: { processName: 'chunked.exe' } })}\n`;
      setImmediate(() => {
        child.stdout.emit('data', whole.slice(0, 20));
        child.stdout.emit('data', whole.slice(20));
      });
      return null;
    }
    return { ok: true };
  };
  const { driver } = makeDriver(responder);
  await driver.start();
  const snap = await driver.snapshot();
  assert.equal(snap.foreground.processName, 'chunked.exe');
  driver.stop();
});

test('a helper that never answers resolves as a failure, not a hang', async () => {
  const responder = (request) => (request.cmd === 'ping' ? { ok: true } : null);
  const { driver } = makeDriver(responder, { commandTimeoutMs: 60 });
  await driver.start();
  const result = await driver.invoke('e1', {});
  assert.equal(result.ok, false);
  assert.equal(result.error, 'driver-failed');
  driver.stop();
});

test('the child dying fails every pending command instead of leaving promises open', async () => {
  const responder = (request, child) => {
    if (request.cmd === 'ping') return { ok: true };
    if (request.cmd === 'snapshot') { setImmediate(() => child.emit('close', 1)); return null; }
    return { ok: true };
  };
  const { driver } = makeDriver(responder);
  await driver.start();
  const result = await driver.snapshot();
  assert.equal(result.ok, false);
  driver.stop();
});

test('commands after stop() fail cleanly without touching a dead child', async () => {
  const { driver } = makeDriver(echoResponder());
  await driver.start();
  driver.stop();
  const result = await driver.snapshot();
  assert.equal(result.ok, false);
  assert.equal(result.error, 'driver-failed');
});

// ---------------------------------------------------------------------------
// The kill path.
// ---------------------------------------------------------------------------

test('stop() kills the child and a wedged child gets taskkill /F', async () => {
  const { driver, spawnCalls, getChild } = makeDriver(echoResponder(), { killGraceMs: 30 });
  await driver.start();
  const child = getChild();
  // Simulate a wedged UIA call: kill() does nothing, the process never exits.
  child.kill = () => {};
  driver.stop();
  await new Promise((r) => setTimeout(r, 80));
  const taskkill = spawnCalls.find(({ cli }) => cli === 'taskkill');
  assert.ok(taskkill, 'taskkill escalation fired');
  assert.deepEqual(taskkill.args, ['/pid', '4321', '/T', '/F']);
});

test('a child that exits promptly never sees taskkill', async () => {
  const { driver, spawnCalls } = makeDriver(echoResponder(), { killGraceMs: 30 });
  await driver.start();
  driver.stop();
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(spawnCalls.some(({ cli }) => cli === 'taskkill'), false);
});

// ---------------------------------------------------------------------------
// Integration: the real session referee driving the real protocol against a
// scripted helper. The big mutation test lives here — if the session's
// window-guard re-check is removed, the poisoned second snapshot no longer
// stops the wire traffic and this fails.
// ---------------------------------------------------------------------------

function handsOver(driver) {
  const events = [];
  const hands = new ScreenHands({
    driverFactory: () => driver,
    getSettings: () => ({ screenControlAllowlist: ['explorer', 'notepad'], screenDriveEnabled: true }),
    onEvent: (payload) => events.push(payload),
    requestApproval: () => Promise.resolve(true),
    stopWindow: { open: () => {}, update: () => {}, close: () => {} },
    timers: { stepMs: 300, sessionMs: 2000, approvalMs: 300 }
  });
  return { hands, events };
}

test('end to end: a two-step plan crosses the wire in order and succeeds', async () => {
  const { driver, getChild } = makeDriver(echoResponder());
  const { hands } = handsOver(driver);
  const result = await hands.run({
    title: 'test',
    steps: [
      { action: 'invoke', target: { app: 'notepad', name: 'File', controlType: 'Button' } },
      { action: 'setValue', target: { app: 'notepad', name: 'Text editor', controlType: 'Edit' }, text: 'hello world' }
    ]
  });
  assert.equal(result.ok, true);
  const cmds = getChild().stdinLines.map((line) => JSON.parse(line).cmd);
  assert.deepEqual(cmds.filter((c) => c !== 'ping' && c !== 'quit'), ['snapshot', 'resolve', 'invoke', 'snapshot', 'resolve', 'setValue']);
});

test('a bank window between steps stops all wire traffic — nothing else is ever sent', async () => {
  const { driver, getChild } = makeDriver(echoResponder({
    windows: [
      { processName: 'notepad.exe', pid: 41, title: 'Untitled - Notepad', integrity: 'medium' },
      { processName: 'chrome.exe', pid: 9, title: 'Chase Online - Google Chrome', integrity: 'medium' }
    ]
  }));
  const { hands } = handsOver(driver);
  const result = await hands.run({
    title: 'test',
    steps: [
      { action: 'invoke', target: { app: 'notepad', name: 'File', controlType: 'Button' } },
      { action: 'invoke', target: { app: 'notepad', name: 'Edit', controlType: 'Button' } }
    ]
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'guard-refused');
  const lines = getChild().stdinLines.map((line) => JSON.parse(line));
  const afterSecondSnapshot = lines.slice(lines.findIndex((l, i) => l.cmd === 'snapshot' && lines.slice(0, i).some((p) => p.cmd === 'snapshot')) + 1);
  assert.deepEqual(afterSecondSnapshot.filter((l) => l.cmd !== 'quit').map((l) => l.cmd), [], 'no resolve, no invoke after the poisoned snapshot');
});

test('an ambiguous resolve over the real protocol aborts without an invoke', async () => {
  const { driver, getChild } = makeDriver(echoResponder({
    resolve: { ok: true, count: 2, matches: [{ ref: 'e1', name: 'Save' }, { ref: 'e2', name: 'Save' }] }
  }));
  const { hands } = handsOver(driver);
  const result = await hands.run({ title: 'test', steps: [{ action: 'invoke', target: { app: 'notepad', name: 'Save as', controlType: 'Button' } }] });
  assert.equal(result.reason, 'ambiguous');
  assert.equal(getChild().stdinLines.some((line) => JSON.parse(line).cmd === 'invoke'), false);
});

test('an elevated foreground over the real protocol is terminal', async () => {
  const { driver } = makeDriver(echoResponder({
    windows: [{ processName: 'regedit.exe', pid: 5, title: 'Registry Editor', integrity: 'high' }]
  }));
  const { hands } = handsOver(driver);
  const result = await hands.run({ title: 'test', steps: [{ action: 'invoke', target: { app: 'notepad', name: 'File', controlType: 'Button' } }] });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'elevated');
});
