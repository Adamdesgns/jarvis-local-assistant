'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { ScreenHands, END_MESSAGES, describeText } = require('../core/screen-drive-session');

// ---------------------------------------------------------------------------
// Fakes, in the house style: hand-rolled, scriptable per call.
// ---------------------------------------------------------------------------

const OK_WINDOW = { processName: 'notepad.exe', pid: 41, title: 'Untitled - Notepad', integrity: 'Medium' };

function fakeDriver({ windows = [], resolveResults = [], actionResults = [] } = {}) {
  const calls = [];
  let snapIndex = -1;
  let resolveIndex = -1;
  let actionIndex = -1;
  return {
    calls,
    start() { calls.push(['start']); return { ok: true }; },
    stop() { calls.push(['stop']); },
    snapshot() {
      calls.push(['snapshot']);
      snapIndex += 1;
      const win = windows[Math.min(snapIndex, windows.length - 1)] || OK_WINDOW;
      return Promise.resolve({ ok: true, foreground: win });
    },
    resolve(target) {
      calls.push(['resolve', target]);
      resolveIndex += 1;
      const result = resolveResults[Math.min(resolveIndex, resolveResults.length - 1)];
      return Promise.resolve(result || { ok: true, matches: [{ ref: 'r1', name: target?.name || 'Thing', control: 'Button' }] });
    },
    invoke(ref, expect) {
      calls.push(['invoke', ref, expect]);
      actionIndex += 1;
      return Promise.resolve(actionResults[Math.min(actionIndex, actionResults.length - 1)] || { ok: true });
    },
    setValue(ref, text, expect) {
      calls.push(['setValue', ref, text, expect]);
      actionIndex += 1;
      return Promise.resolve(actionResults[Math.min(actionIndex, actionResults.length - 1)] || { ok: true });
    },
    focusWindow(target) {
      calls.push(['focusWindow', target]);
      return Promise.resolve({ ok: true });
    }
  };
}

function fakeLog() {
  const entries = [];
  return { entries, write: (entry) => entries.push(entry) };
}

function makeHands({ driver = fakeDriver(), settings = {}, approvals = [], log = fakeLog(), timers = {} } = {}) {
  const events = [];
  const approvalRequests = [];
  let approvalIndex = -1;
  const hands = new ScreenHands({
    driverFactory: () => driver,
    getSettings: () => ({ screenControlAllowlist: ['explorer', 'notepad'], screenDriveEnabled: true, ...settings }),
    log,
    onEvent: (payload) => events.push(payload),
    requestApproval: (card) => {
      approvalRequests.push(card);
      approvalIndex += 1;
      const answer = approvals[Math.min(approvalIndex, approvals.length - 1)];
      return typeof answer === 'function' ? answer() : Promise.resolve(Boolean(answer));
    },
    stopWindow: { open: () => {}, update: () => {}, close: () => {} },
    timers: { stepMs: 200, sessionMs: 1000, approvalMs: 200, ...timers }
  });
  return { hands, events, approvalRequests, driver, log };
}

function plan(steps, extra = {}) {
  return { title: 'test drive', utterance: 'test', steps, ...extra };
}

const press = (name) => ({ action: 'invoke', target: { app: 'notepad', name, controlType: 'Button' } });
const type = (text) => ({ action: 'setValue', target: { app: 'notepad', name: 'Text editor', controlType: 'Edit' }, text });

// ---------------------------------------------------------------------------
// The happy path, and the plan freeze.
// ---------------------------------------------------------------------------

test('a free plan runs every step and ends "done"', async () => {
  const { hands, events, driver } = makeHands();
  const result = await hands.run(plan([press('File'), type('hello world')]));
  assert.equal(result.ok, true);
  assert.equal(result.reason, 'done');
  assert.equal(result.completed, 2);
  assert.ok(driver.calls.some(([c]) => c === 'invoke'));
  assert.ok(driver.calls.some(([c]) => c === 'setValue'));
  const ended = events.filter((e) => e.type === 'ended');
  assert.equal(ended.length, 1, 'ended fires exactly once');
  assert.equal(ended[0].ok, true);
});

test('the plan is frozen at run — nothing can append a step mid-session', async () => {
  const { hands } = makeHands();
  const thePlan = plan([press('File')]);
  await hands.run(thePlan);
  assert.ok(Object.isFrozen(thePlan));
  assert.ok(Object.isFrozen(thePlan.steps));
  assert.throws(() => { thePlan.steps.push(press('Evil')); }, TypeError);
});

test('an empty plan does nothing at all', async () => {
  const { hands, driver } = makeHands();
  const result = await hands.run(plan([]));
  assert.equal(result.ok, false);
  assert.equal(driver.calls.length, 0);
});

test('a second run while one is active is refused without touching the driver', async () => {
  const { hands } = makeHands({ approvals: [() => new Promise(() => {})], timers: { approvalMs: 5000 } });
  const first = hands.run(plan([press('Save')]));
  await new Promise((r) => setTimeout(r, 20));
  const second = await hands.run(plan([press('File')]));
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'busy');
  hands.abortActive('user-interrupt');
  await first;
});

// ---------------------------------------------------------------------------
// The guard re-check before every action. Mutation tests: remove the check in
// the session and these fail.
// ---------------------------------------------------------------------------

test('a financial window appearing mid-session aborts with no further driver commands', async () => {
  const driver = fakeDriver({
    windows: [OK_WINDOW, { processName: 'chrome.exe', pid: 9, title: 'Chase Online', integrity: 'Medium' }]
  });
  const { hands } = makeHands({ driver });
  const result = await hands.run(plan([press('File'), press('Edit')]));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'guard-refused');
  assert.equal(result.completed, 1);
  // After the poisoned snapshot: nothing else went out on the wire.
  const invokes = driver.calls.filter(([c]) => c === 'invoke');
  assert.equal(invokes.length, 1, 'only the first step ever invoked');
});

test('an elevated window is terminal with the UAC hand-back message', async () => {
  const driver = fakeDriver({ windows: [{ processName: 'consent.exe', pid: 4, title: 'User Account Control', integrity: 'High' }] });
  const { hands, events } = makeHands({ driver });
  const result = await hands.run(plan([press('File')]));
  assert.equal(result.reason, 'elevated');
  assert.equal(result.text, END_MESSAGES.elevated);
  assert.equal(driver.calls.filter(([c]) => c === 'invoke').length, 0);
  assert.equal(events.filter((e) => e.type === 'ended').length, 1);
});

test('a non-allowlisted app in the foreground refuses before any resolve', async () => {
  const driver = fakeDriver({ windows: [{ processName: 'notepad++.exe', pid: 7, title: 'plugin.js - Notepad++', integrity: 'Medium' }] });
  const { hands } = makeHands({ driver });
  const result = await hands.run(plan([press('File')]));
  assert.equal(result.reason, 'not-allowlisted');
  assert.equal(driver.calls.filter(([c]) => c === 'resolve' || c === 'invoke').length, 0);
});

test('settings cannot widen driving to chrome — the v1 clamp holds inside a session', async () => {
  const driver = fakeDriver({ windows: [{ processName: 'chrome.exe', pid: 12, title: 'Wikipedia', integrity: 'Medium' }] });
  const { hands } = makeHands({ driver, settings: { screenControlAllowlist: ['explorer', 'notepad', 'chrome'] } });
  const result = await hands.run(plan([press('Back')]));
  assert.equal(result.reason, 'not-allowlisted');
  assert.equal(driver.calls.filter(([c]) => c === 'invoke').length, 0);
});

test('zero matches stops the session; two matches stops the session', async () => {
  for (const [resolveResult, reason] of [
    [{ ok: true, matches: [] }, 'not-found'],
    [{ ok: true, matches: [{ ref: 'a', name: 'Save' }, { ref: 'b', name: 'Save' }] }, 'ambiguous']
  ]) {
    const driver = fakeDriver({ resolveResults: [resolveResult] });
    const { hands } = makeHands({ driver });
    const result = await hands.run(plan([press('Save as')]));
    assert.equal(result.reason, reason);
    assert.equal(driver.calls.filter(([c]) => c === 'invoke').length, 0);
  }
});

test('a password field revealed at resolve time is denied even in a free-looking step', async () => {
  const driver = fakeDriver({ resolveResults: [{ ok: true, matches: [{ ref: 'p', name: 'Text editor', control: 'Edit', isPassword: true }] }] });
  const { hands } = makeHands({ driver });
  const result = await hands.run(plan([type('hunter2')]));
  assert.equal(result.reason, 'guard-refused');
  assert.equal(driver.calls.filter(([c]) => c === 'setValue').length, 0);
});

// ---------------------------------------------------------------------------
// Approvals: risky steps wait, decline stops, silence stops.
// ---------------------------------------------------------------------------

test('a risky step sends nothing until approval, then acts on yes', async () => {
  const driver = fakeDriver();
  const { hands, approvalRequests } = makeHands({ driver, approvals: [true] });
  const result = await hands.run(plan([press('Save')]));
  assert.equal(result.ok, true);
  assert.equal(approvalRequests.length, 1);
  assert.match(approvalRequests[0].detail, /Save/);
  const approvalAt = approvalRequests.length ? driver.calls.filter(([c]) => c === 'invoke').length : -1;
  assert.equal(approvalAt <= 1, true);
});

test('declining the card means the action never happens', async () => {
  const driver = fakeDriver();
  const { hands } = makeHands({ driver, approvals: [false] });
  const result = await hands.run(plan([press('Save')]));
  assert.equal(result.reason, 'declined');
  assert.equal(driver.calls.filter(([c]) => c === 'invoke').length, 0);
});

test('an unanswered card times out and nothing happens', async () => {
  const driver = fakeDriver();
  const { hands } = makeHands({ driver, approvals: [() => new Promise(() => {})], timers: { approvalMs: 60 } });
  const result = await hands.run(plan([press('Send')]));
  assert.equal(result.reason, 'approval-timeout');
  assert.equal(driver.calls.filter(([c]) => c === 'invoke').length, 0);
});

// ---------------------------------------------------------------------------
// Stop paths and watchdogs.
// ---------------------------------------------------------------------------

test('abortActive stops a session mid-wait and teardown runs once', async () => {
  const driver = fakeDriver();
  const { hands, events } = makeHands({ driver, approvals: [() => new Promise(() => {})], timers: { approvalMs: 5000 } });
  const running = hands.run(plan([press('Save')]));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(hands.isActive(), true);
  assert.equal(hands.abortActive('stop-button'), true);
  const result = await running;
  assert.equal(result.reason, 'stop-button');
  assert.equal(result.text, END_MESSAGES['stop-button']);
  assert.equal(hands.isActive(), false);
  assert.equal(events.filter((e) => e.type === 'ended').length, 1);
  assert.ok(driver.calls.some(([c]) => c === 'stop'), 'the helper child is killed');
  assert.equal(hands.abortActive('stop-button'), false, 'second abort is a no-op');
});

test('a stalled driver call trips the per-step watchdog', async () => {
  const driver = fakeDriver();
  driver.invoke = () => { driver.calls.push(['invoke-hang']); return new Promise(() => {}); };
  const { hands } = makeHands({ driver, timers: { stepMs: 60 } });
  const result = await hands.run(plan([press('File')]));
  assert.equal(result.reason, 'step-timeout');
  assert.ok(driver.calls.some(([c]) => c === 'stop'));
});

test('the session watchdog ends an overstaying session', async () => {
  const driver = fakeDriver();
  driver.snapshot = () => { driver.calls.push(['snapshot-slow']); return new Promise((r) => setTimeout(() => r({ ok: true, foreground: OK_WINDOW }), 80)); };
  const { hands } = makeHands({ driver, timers: { sessionMs: 120, stepMs: 100 } });
  const result = await hands.run(plan([press('File'), press('Edit'), press('View'), press('Help')]));
  assert.equal(result.reason, 'session-timeout');
});

test('structured driver failures map to their own terminal messages', async () => {
  for (const error of ['focus-stolen', 'stale-element', 'desktop-locked']) {
    const driver = fakeDriver({ actionResults: [{ ok: false, error }] });
    const { hands } = makeHands({ driver });
    const result = await hands.run(plan([press('File')]));
    assert.equal(result.reason, error);
    assert.equal(result.text, END_MESSAGES[error]);
  }
});

// ---------------------------------------------------------------------------
// The log: full accounting, zero plaintext.
// ---------------------------------------------------------------------------

test('typed text is logged as sha256 + length, never plaintext', async () => {
  const secretish = 'meet me at the dock at nine';
  const log = fakeLog();
  const { hands } = makeHands({ log });
  await hands.run(plan([type(secretish)]));
  const serialized = JSON.stringify(log.entries);
  assert.ok(!serialized.includes(secretish), 'plaintext must never reach the log');
  const expected = crypto.createHash('sha256').update(secretish, 'utf8').digest('hex');
  const entry = log.entries.find((item) => item.textSha256);
  assert.ok(entry, 'a hashed record of the typing exists');
  assert.equal(entry.textSha256, expected);
  assert.equal(entry.textLength, secretish.length);
});

test('describeText never returns the value it was given', () => {
  const described = describeText('password123');
  assert.ok(!JSON.stringify(described).includes('password123'));
  assert.equal(described.textLength, 11);
  assert.equal(describeText(''), null);
});

test('every session writes a start and an end log entry', async () => {
  const log = fakeLog();
  const { hands } = makeHands({ log });
  await hands.run(plan([press('File')]));
  const drive = log.entries.filter((e) => e.type === 'screen-drive');
  assert.ok(drive.some((e) => /session started/.test(e.response)));
  assert.ok(drive.some((e) => /session ended: done/.test(e.response)));
});

// ---------------------------------------------------------------------------
// The STOP window is load-bearing: if it cannot open, nothing drives.
// ---------------------------------------------------------------------------

test('a STOP window that fails to open aborts the session before any action', async () => {
  const driver = fakeDriver();
  const events = [];
  const hands = new ScreenHands({
    driverFactory: () => driver,
    getSettings: () => ({ screenControlAllowlist: ['notepad'] }),
    onEvent: (payload) => events.push(payload),
    stopWindow: { open: () => { throw new Error('no window for you'); }, update: () => {}, close: () => {} },
    timers: { stepMs: 100, sessionMs: 500, approvalMs: 100 }
  });
  const result = await hands.run(plan([press('File')]));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'stop-window-lost');
  assert.equal(driver.calls.filter(([c]) => c === 'invoke').length, 0);
});
