'use strict';

// Defense mode: pure helpers in the battle-mode mold. The router and the
// DefenseService own the wiring; the HARD RAILS from the spec live here in
// code AND in this module's tests so they can't quietly drift:
// defense mode watches and tells — it never acts.

// Deliberately narrow, anchored patterns: entering a fullscreen posture must
// be the whole point of the sentence, so "add defense mode to my tasks" or
// "read about missile defense" never hijack the window.
const ENTER_PATTERNS = [
  /^(?:jarvis[, ]*)?defen[cs]e mode$/i,
  /^(?:jarvis[, ]*)?(?:enter|activate|engage|start)\s+defen[cs]e mode$/i,
  /^(?:jarvis[, ]*)?go (?:in)?to\s+defen[cs]e mode$/i
];

const EXIT_PATTERNS = [
  /^(?:jarvis[, ]*)?stand down$/i,
  /^(?:jarvis[, ]*)?(?:exit|leave|end|stop)\s+defen[cs]e mode$/i,
  /^(?:jarvis[, ]*)?all clear$/i
];

function matchAny(text, patterns) {
  const cleaned = String(text || '').trim().replace(/[.!?]+$/, '');
  for (const pattern of patterns) {
    if (pattern.test(cleaned)) return {};
  }
  return null;
}

function isDefenseRequest(text) {
  return matchAny(text, ENTER_PATTERNS);
}

function isStandDown(text) {
  return matchAny(text, EXIT_PATTERNS);
}

module.exports = { isDefenseRequest, isStandDown };
