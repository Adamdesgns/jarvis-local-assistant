'use strict';

// The preload/main IPC contract.
//
// main.js cannot be required in a plain node:test run — it pulls in electron —
// so the handlers added for THE TERMINAL stage 2 have no behavioural coverage.
// This reads both files as text instead and checks the seam between them, which
// is where the realistic failure lives: a channel renamed on one side only.
// A mismatch is silent at build time and shows up as a dead button.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

const invoked = [...new Set([...preload.matchAll(/ipcRenderer\.invoke\(\s*'([^']+)'/g)].map((m) => m[1]))];
const handled = new Set([...main.matchAll(/ipcMain\.handle\(\s*'([^']+)'/g)].map((m) => m[1]));
const sent = [...new Set([...preload.matchAll(/ipcRenderer\.send\(\s*'([^']+)'/g)].map((m) => m[1]))];
const listened = new Set([...main.matchAll(/ipcMain\.on\(\s*'([^']+)'/g)].map((m) => m[1]));

test('every channel preload invokes has a handler in main', () => {
  const missing = invoked.filter((channel) => !handled.has(channel));
  assert.deepEqual(missing, [],
    `preload.js invokes ${missing.join(', ')} but main.js never handles it — that button is dead.`);
});

test('every channel preload sends has a listener in main', () => {
  const missing = sent.filter((channel) => !listened.has(channel));
  assert.deepEqual(missing, [],
    `preload.js sends ${missing.join(', ')} but main.js never listens — that message goes nowhere.`);
});

test('THE TERMINAL stage 2 channels are wired end to end', () => {
  for (const channel of ['terminal:classify', 'terminal:run', 'terminal:cwd']) {
    assert.ok(preload.includes(`'${channel}'`), `preload.js is missing ${channel}`);
    assert.ok(handled.has(channel), `main.js is missing a handler for ${channel}`);
  }
});

test('HARD RAIL: no IPC channel hands raw shell to anything but the console', () => {
  // The terminal:run handler is the ONLY route to command-runner. If another
  // channel starts calling it, that is a product decision needing Adam, not a
  // refactor — the whole point of stage 2 is that the AI never gets shell.
  const runnerCalls = [...main.matchAll(/terminalRunner\.run\(/g)];
  assert.equal(runnerCalls.length, 1,
    'command-runner should be reachable from exactly one place: the terminal:run handler.');
});
