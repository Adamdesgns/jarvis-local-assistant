'use strict';
const test = require('node:test');
const assert = require('node:assert');
const config = require('../electron-builder.jr.json');
const pkg = require('../package.json');

test('jr installer: own identity, jr stamp, never the grown-up appId', () => {
  assert.equal(config.appId, 'com.adam.jarvis.jr');
  assert.equal(config.productName, 'JARVIS JR');
  assert.equal(config.extraMetadata.jarvisVariant, 'jr');
  assert.match(config.nsis.artifactName || config.win.artifactName, /JARVIS-JR-Setup/);
  // B3 (final-review blocker): dist:jr packs electron-builder.jr.json's own
  // extraResources: { from: 'build/edition', to: 'edition' } — same as every
  // other dist script — but was the only dist script that never RAN
  // scripts/stamp-edition.mjs first, so it packaged build/edition
  // stale/missing rather than the retail stamp core/edition.js expects (JR
  // is a retail-family build: no license/purchase features, same as the
  // plain `dist` script, never the `dist:master` one).
  assert.equal(pkg.scripts['dist:jr'], 'node scripts/stamp-edition.mjs retail && electron-builder --win nsis --config electron-builder.jr.json');
});
