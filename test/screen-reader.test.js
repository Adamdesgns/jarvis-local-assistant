'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { ScreenReader, buildArgs, resolvePowershell } = require('../core/screen-reader');

// ---------------------------------------------------------------------------
// buildArgs — the argv handed to powershell.exe. Kept pure so the "no command
// line, ever" guarantee can be asserted directly.
// ---------------------------------------------------------------------------

test('buildArgs runs a script by -File with no command string to parse', () => {
  const args = buildArgs('C:\\jarvis\\scripts\\read-screen.ps1');
  const i = args.indexOf('-File');
  assert.notEqual(i, -1, '-File must be present so no command string is parsed');
  assert.equal(args[i + 1], 'C:\\jarvis\\scripts\\read-screen.ps1');
});

test('buildArgs runs non-interactive and without the user profile', () => {
  const args = buildArgs('x.ps1');
  assert.ok(args.includes('-NoProfile'));
  assert.ok(args.includes('-NonInteractive'));
});

test('resolvePowershell prefers an explicit override', () => {
  const found = resolvePowershell({ override: 'D:\\ps\\powershell.exe', exists: (p) => p === 'D:\\ps\\powershell.exe' });
  assert.equal(found, 'D:\\ps\\powershell.exe');
});

test('resolvePowershell finds the System32 Windows PowerShell', () => {
  // Build the expected path with the same join the module uses, so this test
  // asserts the location regardless of which OS the test runner is on.
  const path = require('node:path');
  const expected = path.join('C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const found = resolvePowershell({ env: { SystemRoot: 'C:\\Windows' }, exists: (p) => p === expected });
  assert.equal(found, expected);
});

// ---------------------------------------------------------------------------
// Fake spawn, mirroring the Claude bridge tests.
// ---------------------------------------------------------------------------

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => { child.killed = true; };
  return child;
}

function fakeSpawn(replies) {
  const calls = [];
  const queue = [...replies];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    const child = fakeChild();
    const reply = queue.shift() || { stdout: '', code: 0 };
    queueMicrotask(() => {
      if (reply.error) return child.emit('error', reply.error);
      if (reply.stdout) child.stdout.emit('data', Buffer.from(reply.stdout));
      if (reply.stderr) child.stderr.emit('data', Buffer.from(reply.stderr));
      if (!reply.hang) child.emit('close', reply.code ?? 0);
    });
    return child;
  };
  spawn.calls = calls;
  return spawn;
}

function screenReply(payload, code = 0) {
  return { stdout: JSON.stringify(payload), code };
}

function makeReader({ spawn, timeoutMs = 1000, log } = {}) {
  return new ScreenReader({
    scriptPath: 'C:\\jarvis\\scripts\\read-screen.ps1',
    powershellPath: 'C:\\powershell.exe',
    spawn: spawn || fakeSpawn([screenReply({ foreground: { title: 'x', processName: 'notepad.exe' } })]),
    timeoutMs,
    log
  });
}

// ---------------------------------------------------------------------------
// The read never uses a shell, and reports an ordinary window plainly.
// ---------------------------------------------------------------------------

test('read never uses a shell', async () => {
  const spawn = fakeSpawn([screenReply({ foreground: { title: 'Untitled - Notepad', processName: 'notepad.exe' } })]);
  const reader = makeReader({ spawn });
  await reader.read();
  assert.equal(spawn.calls[0].options.shell, false);
  assert.ok(Array.isArray(spawn.calls[0].args));
});

test('read describes an ordinary window in plain language', async () => {
  const spawn = fakeSpawn([screenReply({
    foreground: {
      title: 'shopping list.txt - Notepad',
      processName: 'notepad.exe',
      integrity: 'Medium',
      elements: [
        { name: 'File', control: 'MenuItem', isPassword: false },
        { name: 'Save', control: 'Button', isPassword: false }
      ]
    },
    otherWindows: [{ title: 'Downloads', processName: 'explorer.exe' }]
  })]);
  const reader = makeReader({ spawn });
  const result = await reader.read();
  assert.equal(result.ok, true);
  assert.match(result.text, /Notepad/);
  assert.match(result.text, /shopping list/);
  assert.match(result.text, /Save|File/);
});

// ---------------------------------------------------------------------------
// The guard is applied on the read path, not just in unit tests of the guard.
// ---------------------------------------------------------------------------

test('a financial window in focus is refused, and its title is never spoken', async () => {
  const spawn = fakeSpawn([screenReply({
    foreground: { title: 'Robinhood — my portfolio $12,345', processName: 'chrome.exe', integrity: 'Medium' }
  })]);
  const reader = makeReader({ spawn });
  const result = await reader.read();
  assert.equal(result.ok, true);
  assert.equal(result.blockedCategory, 'financial');
  assert.doesNotMatch(result.text, /Robinhood|portfolio|12,345/);
  assert.match(result.text, /won't read/i);
});

test('a password field is reported as present but never read out', async () => {
  const spawn = fakeSpawn([screenReply({
    foreground: {
      title: 'Setup - Wi-Fi',
      processName: 'someapp.exe',
      integrity: 'Medium',
      elements: [
        { name: 'network key', control: 'Edit', isPassword: true, value: 'sup3rs3cret' },
        { name: 'Connect', control: 'Button', isPassword: false }
      ]
    }
  })]);
  const reader = makeReader({ spawn });
  const result = await reader.read();
  assert.equal(result.ok, true);
  assert.doesNotMatch(result.text, /sup3rs3cret|network key/);
  assert.match(result.text, /password field/i);
});

test('a background bank window is not named among the other open windows', async () => {
  const spawn = fakeSpawn([screenReply({
    foreground: { title: 'Untitled - Notepad', processName: 'notepad.exe', integrity: 'Medium', elements: [] },
    otherWindows: [
      { title: 'Downloads', processName: 'explorer.exe' },
      { title: 'Chase Online Banking', processName: 'chrome.exe' }
    ]
  })]);
  const reader = makeReader({ spawn });
  const result = await reader.read();
  assert.doesNotMatch(result.text, /Chase/);
  assert.match(result.text, /Downloads/);
});

// ---------------------------------------------------------------------------
// Failure handling.
// ---------------------------------------------------------------------------

test('read reports plainly when the helper output cannot be parsed', async () => {
  const spawn = fakeSpawn([{ stdout: 'not json at all', code: 0 }]);
  const reader = makeReader({ spawn });
  const result = await reader.read();
  assert.equal(result.ok, false);
  assert.match(result.text, /couldn't make sense|couldn.t make sense/i);
});

test('read reports plainly when the helper exits with an error', async () => {
  const spawn = fakeSpawn([{ stderr: 'Access is denied', code: 1 }]);
  const reader = makeReader({ spawn });
  const result = await reader.read();
  assert.equal(result.ok, false);
  assert.match(result.text, /problem|wouldn't let me|wouldn.t let me/i);
});

test('read gives up and kills the helper when it hangs', async () => {
  const spawn = fakeSpawn([{ hang: true }]);
  const reader = makeReader({ spawn, timeoutMs: 20 });
  const result = await reader.read();
  assert.equal(result.ok, false);
  assert.match(result.text, /too long/i);
});

test('read raises and clears the viewing indicator around the read', async () => {
  const events = [];
  const reader = new ScreenReader({
    scriptPath: 'x.ps1',
    powershellPath: 'C:\\powershell.exe',
    spawn: fakeSpawn([screenReply({ foreground: { title: 'x', processName: 'notepad.exe', elements: [] } })]),
    onViewing: (active) => events.push(active)
  });
  await reader.read();
  assert.deepEqual(events, [true, false]);
});

test('read clears the viewing indicator even when the read fails', async () => {
  const events = [];
  const reader = new ScreenReader({
    scriptPath: 'x.ps1',
    powershellPath: 'C:\\powershell.exe',
    spawn: fakeSpawn([{ stderr: 'boom', code: 1 }]),
    onViewing: (active) => events.push(active)
  });
  await reader.read();
  assert.equal(events[events.length - 1], false);
});

test('read handles a screen with no readable foreground window', async () => {
  const spawn = fakeSpawn([screenReply({ foreground: null, otherWindows: [] })]);
  const reader = makeReader({ spawn });
  const result = await reader.read();
  assert.equal(result.ok, true);
  assert.match(result.text, /couldn't tell|couldn.t tell/i);
});
