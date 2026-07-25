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

// The warning tier — the only events allowed to propose automatic entry.
// Watches and advisories NEVER qualify: a watch means "conditions are
// possible", and a fullscreen takeover for "possible" trains the user to
// wave the mode off. Exact NWS event names, checked verbatim.
const WARNING_TIER = Object.freeze([
  'Tornado Warning',
  'Hurricane Warning',
  'Severe Thunderstorm Warning',
  'Flash Flood Warning',
  'Extreme Wind Warning'
]);

function pickTriggerAlert(features) {
  if (!Array.isArray(features)) return null;
  return features.find((item) => WARNING_TIER.includes(item?.properties?.event)) || null;
}

function two(value) {
  return String(value).padStart(2, '0');
}

// The banner names the trigger and the time — that is its whole job.
// reason: { kind: 'manual' } | { kind: 'weather', event, area } |
//         { kind: 'camera', cameraName }
function buildBannerLabel(reason, now) {
  const time = `${two(now.getHours())}:${two(now.getMinutes())}`;
  let cause = 'MANUAL TRIGGER';
  if (reason?.kind === 'weather') {
    cause = String(reason.event || 'WEATHER ALERT').toUpperCase();
    if (reason.area) cause += `, ${String(reason.area).toUpperCase()}`;
  } else if (reason?.kind === 'camera') {
    cause = `MOTION AT ${String(reason.cameraName || 'CAMERA').toUpperCase()}`;
  }
  return `DEFENSE MODE · ${cause} · ${time}`;
}

// The announce-and-wave-off gate. Pure state machine — the caller owns the
// clock and the timers, which is what makes "silence enters, a word cancels"
// provable in tests. One gate instance guards the whole posture: while an
// entry is pending or live, nothing else may propose.
function createEntryGate({ timeoutMs = 15000 } = {}) {
  let state = 'idle'; // idle -> pending -> entered
  let reason = null;
  let expiresAt = 0;
  return {
    propose(proposedReason, now) {
      if (state !== 'idle') return null;
      state = 'pending';
      reason = proposedReason;
      expiresAt = now + timeoutMs;
      return { pending: true, expiresAt };
    },
    waveOff() {
      if (state !== 'pending') return false;
      state = 'idle';
      reason = null;
      return true;
    },
    expire(now) {
      if (state !== 'pending' || now < expiresAt) return null;
      state = 'entered';
      return { enter: true, reason };
    },
    entered() {
      return state === 'entered';
    },
    reset() {
      state = 'idle';
      reason = null;
      expiresAt = 0;
    }
  };
}

// RSS headlines for the situation rail. fast-xml-parser is already a
// dependency (the ONVIF camera path uses it), so no new packages. Feeds are
// strangers' XML — every failure collapses to [] and the board carries on.
const { XMLParser } = require('fast-xml-parser');

function textOf(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (value && typeof value === 'object') {
    // CDATA and attribute-carrying nodes land as objects; '#text' holds the words.
    if (typeof value['#text'] === 'string' || typeof value['#text'] === 'number') return String(value['#text']).trim();
  }
  return '';
}

function parseRss(xml, max = 10) {
  if (typeof xml !== 'string' || !xml.trim()) return [];
  let parsed;
  try {
    parsed = new XMLParser({ ignoreAttributes: true }).parse(xml);
  } catch {
    return [];
  }
  const channel = parsed?.rss?.channel;
  const raw = channel?.item;
  const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out = [];
  for (const item of items) {
    if (out.length >= max) break;
    const title = textOf(item?.title);
    if (!title) continue;
    out.push({ title, link: textOf(item?.link), date: textOf(item?.pubDate) });
  }
  return out;
}

module.exports = { isDefenseRequest, isStandDown, pickTriggerAlert, buildBannerLabel, createEntryGate, parseRss, WARNING_TIER };
