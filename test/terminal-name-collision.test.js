'use strict';

// THE TERMINAL, stage 2 — settling the "terminal" name collision.
//
// docs/ROADMAP.md flagged this as the thing to decide BEFORE stage 2 ships
// command execution: core/defaults.js registered an app literally named
// `terminal` pointing at wt.exe, while the in-app console module is also called
// terminal. Harmless in stage 1. Once the module can run commands, the word is
// ambiguous — and one of the two routes (launching Windows Terminal externally)
// sits entirely outside the confirm card.
//
// THE DECISION (Claude's Night Crew, 2026-07-26, conservative call made without
// Adam since he was asleep at the time of writing):
//   "terminal"          → the in-app console. Never launches an external shell.
//   "windows terminal"  → the external Windows Terminal app, named explicitly.
//
// Rationale: inside JARVIS, "the terminal" is his console. Anything that opens
// a real shell outside the guard has to be asked for by its full name. The
// ambiguous word must never silently reach wt.exe.

const test = require('node:test');
const assert = require('node:assert');

const { DEFAULT_SETTINGS } = require('../core/defaults.js');
const { ToolService } = require('../core/tool-service.js');

function service() {
  return new ToolService({
    config: { getSettings: () => DEFAULT_SETTINGS },
    shell: {},
    app: {},
    launchProcess: () => { throw new Error('no launch in this test'); },
  });
}

test('the bare word "terminal" no longer resolves to an external shell', () => {
  const resolved = service().resolveApplication('terminal');
  if (resolved) {
    assert.notEqual(resolved.command, 'wt.exe',
      '"terminal" must not launch Windows Terminal. Inside JARVIS the terminal is the ' +
      'in-app console; an external shell bypasses the stage-2 confirm card entirely.');
  }
});

test('"windows terminal" still resolves, by its explicit name', () => {
  const resolved = service().resolveApplication('windows terminal');
  assert.ok(resolved, 'windows terminal should still be launchable');
  assert.equal(resolved.command, 'wt.exe');
});

test('"wt" resolves too — the short name is unambiguous', () => {
  const resolved = service().resolveApplication('wt');
  assert.ok(resolved);
  assert.equal(resolved.command, 'wt.exe');
});

test('no application entry is keyed on the bare word "terminal"', () => {
  const keys = Object.keys(DEFAULT_SETTINGS.applications);
  assert.ok(!keys.includes('terminal'),
    'A key named exactly "terminal" collides with the console module name.');
});

test('nothing else in the app registry silently claims "terminal"', () => {
  // An alias would reintroduce the collision just as effectively as a key.
  for (const [name, details] of Object.entries(DEFAULT_SETTINGS.applications)) {
    for (const alias of details.aliases || []) {
      assert.notEqual(String(alias).toLowerCase().trim(), 'terminal',
        `App "${name}" claims the alias "terminal", which collides with the console module.`);
    }
  }
});

test('the console module is still registered as a hideable module named terminal', () => {
  // The module keeps the name; it is the external app that had to move.
  assert.ok(DEFAULT_SETTINGS.hiddenModules.includes('terminal'));
  assert.ok(DEFAULT_SETTINGS.moduleLayout.terminal, 'the terminal module keeps its saved layout');
});
