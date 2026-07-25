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

// The spoken read: JARVIS tells the user what is happening, once, on entry.
// The report-only rail rides IN the prompt and is asserted by tests — the
// mode watches and tells, it never directs anyone to act.
function describeReason(reason) {
  if (reason?.kind === 'weather') return `an automatic weather trigger: ${reason.event}${reason.area ? ` for ${reason.area}` : ''}`;
  if (reason?.kind === 'camera') return `an automatic camera trigger: motion at ${reason.cameraName || 'a camera'} while the system is armed`;
  return 'a manual request';
}

function buildSituationReadPrompt(reason, alert, headlines) {
  const alertBlock = alert?.properties
    ? [
        `ACTIVE ALERT: ${alert.properties.headline || alert.properties.event || 'unnamed alert'}`,
        alert.properties.instruction ? `OFFICIAL INSTRUCTION TEXT: ${alert.properties.instruction}` : ''
      ].filter(Boolean).join('\n')
    : 'ACTIVE ALERT: none — there is no active weather alert right now.';
  const headlineBlock = Array.isArray(headlines) && headlines.length
    ? `LOCAL HEADLINES:\n${headlines.map((item) => `- ${item.title}`).join('\n')}`
    : 'LOCAL HEADLINES: none — no headlines are available.';
  return [
    'You are JARVIS — the composed British AI butler. Defense mode has just come up on screen and you are reading the situation aloud, once, calmly.',
    '',
    `WHY IT FIRED: ${describeReason(reason)}.`,
    alertBlock,
    headlineBlock,
    '',
    'HARD RULES — these outrank everything:',
    '- At most 120 words, spoken prose, no lists, no markdown.',
    '- Report only: say what fired, what the official alert text says to do (quote its substance, do not invent safety advice), and what the headlines say.',
    '- If there is no alert or no headlines, say so plainly — never pad, never speculate.',
    '- You never tell the user to call, dial, arm, or confront anyone or anything. You watch and you tell; decisions are theirs.',
    '- No greeting, no sign-off — straight into the read.'
  ].join('\n');
}

module.exports = { isDefenseRequest, isStandDown, pickTriggerAlert, buildBannerLabel, createEntryGate, parseRss, buildSituationReadPrompt, WARNING_TIER };
