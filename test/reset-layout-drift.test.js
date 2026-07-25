const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_SETTINGS } = require('../core/defaults');

// The Reset Layout button keeps its own copies of the default hidden-module
// list and module rects in renderer.js. They drifted (terminal and browser
// were missing), so a reset un-hid modules that then had no layout entry —
// dead maximize buttons and TypeErrors on every click inside them. These
// tests pin both copies to core/defaults.js.

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

test('the reset hiddenModules list matches DEFAULT_SETTINGS.hiddenModules', () => {
  const match = /state\.hiddenModules = \[([^\]]+)\]/.exec(source);
  assert.ok(match, 'reset handler hiddenModules literal not found in renderer.js');
  const resetList = match[1].split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  assert.deepStrictEqual([...resetList].sort(), [...DEFAULT_SETTINGS.hiddenModules].sort());
});

test('RESET_LAYOUT covers exactly the modules DEFAULT_SETTINGS.moduleLayout covers', () => {
  const match = /const RESET_LAYOUT = \{([\s\S]*?)\n\};/.exec(source);
  assert.ok(match, 'RESET_LAYOUT literal not found in renderer.js');
  const keys = [...match[1].matchAll(/(?:'([^']+)'|([\w-]+)):\s*\{/g)].map((m) => m[1] || m[2]);
  assert.deepStrictEqual([...keys].sort(), Object.keys(DEFAULT_SETTINGS.moduleLayout).sort());
});
