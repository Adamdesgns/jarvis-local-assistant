'use strict';

// ADHD mode: instructions delivered one small step at a time, the kid (or
// Adam — this ships in BOTH builds) advancing by voice. Adam's own house
// rule for how *Claude* should talk to him is literally this — "ONE tiny
// step per message, then stop and wait" — so the phrase "adhd mode" is the
// natural toggle, and JARVIS earns the same manners.
//
// Everything here is pure: the router owns the session and the wiring, this
// module owns the words and the parsing. Nothing reaches the model — when
// the mode is on, ai-service.js appends STYLE_RULES to the system prompt so
// the model FORMATS how-to answers as a numbered list; the router then walks
// that list, speaking one step per turn.

// Turning the mode on and off, both anchored so a mid-sentence "normal"
// never flips it. "adhd" is the headline; the plainer synonyms are there
// because a kid may not reach for the acronym.
const ON_PATTERN = /^(?:(?:hey )?jarvis[,\s]+)?(?:turn on |switch to |go |use )?(?:adhd|a\.d\.h\.d\.?)(?:\s+mode)?(?:\s+on)?[\s.!?]*$|^(?:(?:hey )?jarvis[,\s]+)?(?:one step at a time|step by step|simple steps)(?:\s+mode)?[\s.!?]*$/i;
const OFF_PATTERN = /^(?:(?:hey )?jarvis[,\s]+)?(?:turn off )?(?:normal|regular)(?:\s+mode)?[\s.!?]*$|^(?:(?:hey )?jarvis[,\s]+)?(?:adhd|a\.d\.h\.d\.?)\s+off[\s.!?]*$|^(?:(?:hey )?jarvis[,\s]+)?(?:all at once|stop stepping)[\s.!?]*$/i;

function detectAdhdOn(text) { return ON_PATTERN.test(String(text || '').trim()); }
function detectAdhdOff(text) { return OFF_PATTERN.test(String(text || '').trim()); }

// Step navigation, consulted ONLY while a step walk is live. Order matters in
// the router: STOP and REST are checked before NEXT, so "I'm done" ends the
// walk while a bare "done" just advances it.
const STOP_PATTERN = /^(?:(?:hey )?jarvis[,\s]+)?(?:stop|never ?mind|cancel|forget it|i(?:'|’)?m done|we(?:'|’)?re done|all done|that(?:'|’)?s enough)[\s.!?]*$/i;
const REST_PATTERN = /^(?:(?:hey )?jarvis[,\s]+)?(?:all of them|the rest|read the rest|rest of (?:it|them)|just tell me(?: (?:it|them|everything))?|everything|all the steps)[\s.!?]*$/i;
const REPEAT_PATTERN = /^(?:(?:hey )?jarvis[,\s]+)?(?:again|repeat(?: that)?|say (?:that|it) again|one more time|what was that|huh|what)[\s.!?]*$/i;
const NEXT_PATTERN = /^(?:(?:hey )?jarvis[,\s]+)?(?:next(?: step| one)?|done|ok(?:ay)?|got it|ready|continue|keep going|go on|and then|what(?:'|’)?s next|yep|yeah|uh ?huh)[\s.!?]*$/i;

// Returns 'stop' | 'rest' | 'repeat' | 'next' | null. Null means the
// utterance is not step navigation, so the router routes it normally and the
// walk simply waits — a kid can ask an unrelated question mid-steps.
function detectStepNav(text) {
  const clean = String(text || '').trim();
  if (!clean) return null;
  if (STOP_PATTERN.test(clean)) return 'stop';
  if (REST_PATTERN.test(clean)) return 'rest';
  if (REPEAT_PATTERN.test(clean)) return 'repeat';
  if (NEXT_PATTERN.test(clean)) return 'next';
  return null;
}

// Pull a numbered list out of the model's answer. The mode's STYLE_RULES ask
// for "1. ... 2. ..." with one action per line, so this stays strict: only
// lines that actually begin with a step marker count, which keeps ordinary
// prose (a one-line answer to "what's a creeper") from being mistaken for a
// walk. Returns [] when there is no real list — the caller then speaks the
// whole short answer as-is.
function splitSteps(text) {
  const lines = String(text || '').split(/\r?\n/);
  const steps = [];
  for (const line of lines) {
    const match = line.match(/^\s*(?:step\s+)?\d+\s*[.)\]:-]\s+(.+\S)\s*$/i);
    if (match) steps.push(match[1].trim());
  }
  return steps.length >= 2 ? steps : [];
}

// The line spoken for one step. Numbered so a kid always knows where they are
// and how many are left — the whole point of the mode.
function stepLine(steps, index) {
  const total = steps.length;
  const body = steps[index];
  if (index === 0) return `Step 1 of ${total}. ${body}`;
  if (index === total - 1) return `Last step, number ${total}. ${body}`;
  return `Step ${index + 1} of ${total}. ${body}`;
}

// Read the remaining steps out in one go ("just tell me the rest").
function restLine(steps, fromIndex) {
  const remaining = steps.slice(fromIndex);
  if (remaining.length === 1) return `Here it is: ${remaining[0]}`;
  return `Okay, the rest: ${remaining.map((s, i) => `${fromIndex + i + 1}. ${s}`).join(' ')}`;
}

// Appended to the system prompt (ai-service.js) only while the mode is on.
// It shapes FORMAT, never content or persona — JARVIS stays JARVIS, just
// laid out in single steps.
const STYLE_RULES = [
  'SIMPLE-STEPS MODE IS ON — the person you are helping wants things broken down small.',
  '- For anything that has more than one step (how to do, make, build, or fix something), answer as a numbered list: "1. ...", "2. ...", one on each line.',
  '- Exactly one action per step. Never combine two actions with "and" or "then" — split them into two steps.',
  '- Keep each step to one short, plain sentence. No jargon; if a special word is needed, say what it means in the same step.',
  '- For anything that is NOT a set of steps (a fact, a yes/no, a greeting), answer in one or two short plain sentences and do not make a list.'
].join('\n');

module.exports = {
  detectAdhdOn,
  detectAdhdOff,
  detectStepNav,
  splitSteps,
  stepLine,
  restLine,
  STYLE_RULES
};
