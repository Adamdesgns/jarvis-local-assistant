'use strict';

// K.O.R.I. first-run onboarding — "what do you want to call him?"
//
// Retail only, first install only. The buyer names the assistant; that name
// becomes how he refers to himself, and the master copy never sees any of it
// (core/edition.js). Renaming later lives in Settings → GENERAL — this module
// is only the first-run gate plus the shared name rules both paths use.
//
// The say-it-back step (nameHeardIn) closes the loop Adam asked for: after
// typing the name, the buyer says it out loud, faster-whisper transcribes it,
// and we check the recognizer can actually hear the chosen name. A name the
// recognizer can't transcribe is a name voice control will fight forever —
// better to learn that in onboarding than in week two. Coaching, not
// security: the buyer can always skip.

const { isRetail } = require('./edition');

// The name lands in every system prompt (ai-service.js), the window title and
// the console. 32 keeps it a name rather than a paragraph.
const MAX_NAME_LENGTH = 32;

const PRODUCT_NAME = 'Kori';

// Ask only when: retail build AND never stamped. The stamp — not the name —
// is what makes it once-ever: a buyer who later clears the name field must
// not get interrogated on every launch.
function needsNaming({ edition = 'retail', settings = {} } = {}) {
  if (!isRetail(edition)) return false;
  return !settings?.assistantNamedAt;
}

function isValidAssistantName(name) {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_NAME_LENGTH;
}

// The name is interpolated into the system prompt verbatim, so control
// characters and newlines are stripped — a newline in the name field is
// prompt injection, not a name. Collapses whitespace, caps length, and falls
// back to the product name rather than ever returning an empty string
// ("You are , the assistant" is a broken prompt).
function normalizeAssistantName(name) {
  const cleaned = String(name ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH)
    .trim();
  return cleaned || PRODUCT_NAME;
}

// The settings patch that closes onboarding. Exactly two keys — it rides the
// normal settings:save path, and anything wider would be a side door into
// the allowlist. Skipping still stamps: they get the default and the
// question never returns.
function namingPatch(name, now = new Date()) {
  return {
    assistantName: normalizeAssistantName(name),
    assistantNamedAt: now.toISOString(),
  };
}

// ── the say-it-back check ───────────────────────────────────────────────

// Whisper renders unfamiliar proper nouns phonetically — Kori arrives as
// "Corey" or "Cory" — so exact matching would fail the happy path for
// exactly the invented names buyers pick. Compare consonant skeletons
// instead: strip vowels after the leading character, fold the consonant
// pairs speech recognition actually confuses (k/c/q, s/z, f/ph…), drop
// doubled letters. Crude on purpose; it has to run on four words, not a
// corpus.
function skeleton(word) {
  const folded = String(word || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .replace(/ph/g, 'f')
    .replace(/[ckq]/g, 'k')
    .replace(/[sz]/g, 's')
    .replace(/[iy]/g, 'i')
    .replace(/(.)\1+/g, '$1');
  if (!folded) return '';
  // Keep the first letter even if it's a vowel; drop vowels after it.
  return folded[0] + folded.slice(1).replace(/[aeiou]/g, '');
}

// Did the transcript contain the name? The name may be several words
// ("Iron Man") and the transcript usually is ("okay Iron Man, wake up"), so
// slide the name-length window across the transcript and compare skeletons
// word-for-word.
function nameHeardIn(transcript, name) {
  const heard = String(transcript || '').split(/\s+/).map(skeleton).filter(Boolean);
  const wanted = String(name || '').split(/\s+/).map(skeleton).filter(Boolean);
  if (!heard.length || !wanted.length) return false;
  for (let start = 0; start + wanted.length <= heard.length; start += 1) {
    if (wanted.every((part, i) => heard[start + i] === part)) return true;
  }
  return false;
}

module.exports = {
  MAX_NAME_LENGTH,
  PRODUCT_NAME,
  needsNaming,
  isValidAssistantName,
  normalizeAssistantName,
  namingPatch,
  nameHeardIn,
};
