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
  assert.equal(pkg.scripts['dist:jr'], 'electron-builder --win nsis --config electron-builder.jr.json');
});
