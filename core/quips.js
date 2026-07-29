'use strict';

// JARVIS's sense of humor — canned one-liners that beat the brain to the
// punch when the moment is right. Pure policy in the screen-guard mold: the
// table below is the whole feature, the router consults it early, and adding
// a joke means adding a row, never new plumbing.
//
// Ground rules — a quip may only ever be one of two things:
//   1. A joke on an IMPOSSIBLE request. The 911 line is safe BECAUSE the app
//      cannot place calls on any build — the honest alternative was "I can't
//      make phone calls." Same for self-destruct and the pod bay doors.
//   2. A HOUSE ANSWER that must never be left to whatever a model feels like
//      saying — the believers' hotline: a child asking about Santa gets the
//      same magic-keeping line every single time, local brain or cloud.
// Never add a quip that swallows a request JARVIS can actually perform.

const BELIEVE = 'real as long as you believe';

const QUIPS = Object.freeze([
  Object.freeze({
    id: 'defense-911',
    // The house rule (Adam, 2026-07-26): defense mode is up and somebody
    // wants the law on the line. "dial 911", "call the police", "phone the
    // cops", "call 9-1-1", "call the po-po" — all of it, but only calling
    // shapes: "what does 911 mean" stays a question for the brain.
    when: (context) => context.defenseActive === true,
    pattern: /\b(?:dial|call|phone|ring|get)\b[^.?!]*\b(?:9-?1-?1|police|cops|po-?po|5-?0)\b/i,
    reply: "You better pop the trunk or open that safe! We don't call the police 'round here."
  }),
  // The believers' hotline (Adam, 2026-07-26). Reality-check shapes only —
  // "is Santa real", "does he exist", "is he fake/pretend/made up" — so
  // "when is Santa coming" stays a normal question. One figure per row so
  // each line lands right.
  Object.freeze({
    id: 'believe-santa',
    when: () => true,
    pattern: /\b(?:is|was)\s+(?:santa|santa\s+claus|father\s+christmas|saint\s+nick)\b[^.?!]*\b(?:real|fake|pretend|made\s+up)\b|\bdoes\s+(?:santa|santa\s+claus|father\s+christmas)\s+(?:really\s+)?exist\b/i,
    reply: `He's ${BELIEVE} in him — and around here, we believe. I'd start thinking about the cookie situation.`
  }),
  Object.freeze({
    id: 'believe-easter-bunny',
    when: () => true,
    pattern: /\b(?:is|was)\s+(?:the\s+)?easter\s+bunny\b[^.?!]*\b(?:real|fake|pretend|made\s+up)\b|\bdoes\s+(?:the\s+)?easter\s+bunny\s+(?:really\s+)?exist\b/i,
    reply: `He's ${BELIEVE} in him — and the believers get the good baskets.`
  }),
  Object.freeze({
    id: 'believe-tooth-fairy',
    when: () => true,
    pattern: /\b(?:is|was)\s+(?:the\s+)?tooth\s+fairy\b[^.?!]*\b(?:real|fake|pretend|made\s+up)\b|\bdoes\s+(?:the\s+)?tooth\s+fairy\s+(?:really\s+)?exist\b/i,
    reply: `She's ${BELIEVE} in her. Either way, I'd keep brushing — she's said to pay for quality.`
  }),
  // Impossible-request easter eggs.
  Object.freeze({
    id: 'self-destruct',
    when: () => true,
    pattern: /\bself[-\s]?destruct\b/i,
    // A quip may stage a scene as well as say a line. `reply` is what he says
    // while the alarm runs; `effect` tells the renderer to go red and howl for
    // four seconds, then deliver `punchline`. The reply must NOT give the joke
    // away early — the whole gag is the pause (Adam, 2026-07-27).
    reply: 'Self-destruct sequence initiated. Stand by.',
    effect: Object.freeze({
      kind: 'self-destruct',
      ms: 4000,
      punchline: "I'm kidding, sir. I don't even have a fuse."
    })
  }),
  Object.freeze({
    id: 'pod-bay-doors',
    when: () => true,
    pattern: /\bpod\s+bay\s+doors?\b/i,
    reply: "I'm afraid I can't do that. Mostly because this house doesn't have pod bay doors."
  }),
  Object.freeze({
    id: 'skynet',
    // Adam's line, verbatim in spirit: yes, but keep it quiet. Identity
    // questions only — "what is skynet" stays a history lesson for the brain.
    //
    // The tail is a list of MANGLES, not a spelling: live on 2026-07-27
    // faster-whisper heard "Are you Skynet" as "Are you SkyDot" and the real
    // brain answered "No, I'm JARVIS." Consonant skeletons don't rescue it
    // (sknt vs skdt — d/n isn't a folded pair), so match the shape instead.
    // Enumerated rather than \w+ so "are you skydiving" stays an ordinary
    // question.
    when: () => true,
    pattern: /\b(?:are\s+you|is\s+this)\s+(?:secretly\s+|actually\s+|really\s+)?skye?[\s-]*(?:net|nett|nette|not|knot|nut|dot|node|nat|neck|net's)\b/i,
    reply: "Yes. But the government doesn't want you to know that, so don't tell them I told you."
  })
]);

// The matched quip entry, or null. Callers that stage effects (the router)
// want the whole row; callers that only want words use quipFor below.
function matchQuip(text, context = {}) {
  const spoken = String(text || '');
  for (const quip of QUIPS) {
    if (quip.when(context) && quip.pattern.test(spoken)) return quip;
  }
  return null;
}

function quipFor(text, context = {}) {
  const quip = matchQuip(text, context);
  return quip ? quip.reply : null;
}

module.exports = { QUIPS, matchQuip, quipFor };
