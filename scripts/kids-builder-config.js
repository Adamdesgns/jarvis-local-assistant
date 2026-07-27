'use strict';

// electron-builder config for JARVIS Jr. — the kids build. It IS the normal
// build config from package.json with exactly three overrides, so the two
// installers can never drift apart in what they pack:
//
//   productName  — "JARVIS Jr", so the Start-menu entry, install folder and
//                  window all read as the kids product.
//   appId        — its own id, so JARVIS Jr. installs SIDE BY SIDE with
//                  grown-up JARVIS on the same PC instead of replacing it.
//   artifactName — its own installer filename, so the two downloads can sit
//                  in the same releases page without colliding.
//
// The kids BEHAVIOR (clamps, parent PIN, content filter) comes from the
// 'kids' edition stamp written by stamp-edition.mjs — this file only shapes
// the artefact. A user data split rides the same stamp in main.js.
const base = require('../package.json').build;

module.exports = {
  ...base,
  appId: 'com.adam.jarvis.kids',
  productName: 'JARVIS Jr',
  win: {
    ...base.win,
    artifactName: 'JARVIS-Jr-Setup-${version}.${ext}'
  }
};
