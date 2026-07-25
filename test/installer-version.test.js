const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The installer used to hardcode its own version string. It said 0.11.2 while
// package.json said 0.18.0, so Windows "Installed apps" reported a version
// seven releases old and nobody noticed for weeks. One source of truth now,
// and this test is the thing that keeps it that way.

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const nsi = fs.readFileSync(path.join(root, 'scripts', 'jarvis-installer.nsi'), 'utf8');

test('installer version: the NSIS script declares the same version as package.json', () => {
  const declared = nsi.match(/!define\s+JARVIS_VERSION\s+"([^"]+)"/);
  assert.ok(declared, 'jarvis-installer.nsi must !define JARVIS_VERSION');
  assert.equal(
    declared[1],
    pkg.version,
    `installer says ${declared[1]}, package.json says ${pkg.version} — bump both`,
  );
});

test('installer version: no bare version literal is left hardcoded in the registry write', () => {
  const displayVersion = nsi.match(/"DisplayVersion"\s+"([^"]+)"/);
  assert.ok(displayVersion, 'the installer must still write a DisplayVersion');
  assert.equal(
    displayVersion[1],
    '${JARVIS_VERSION}',
    'DisplayVersion must reference ${JARVIS_VERSION}, not a literal',
  );
});
