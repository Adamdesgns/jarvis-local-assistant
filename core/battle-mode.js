'use strict';

// Battle mode: JARVIS spits bars on request. Pure helpers — the router owns
// the wiring, the brain writes the rhymes, and the hard rules live in the
// prompt AND in this module's tests so they can't quietly drift.

const DEFAULT_TOPIC = 'me, your challenger';

// Deliberately narrow patterns: battle phrasing must be the point of the
// sentence, so "add battle ropes to my tasks" never turns into a diss track.
const PATTERNS = [
  /^battle me(?:\s+(?:about|on|over)\s+(.+))?$/i,
  /^rap battle(?:\s+(?:about|on|over)\s+(.+))?$/i,
  /^spit (?:some )?bars(?:\s+(?:about|on)\s+(.+))?$/i,
  /^roast\s+(.+?)\s+in a rap$/i,
  /^rap[- ]roast\s+(.+)$/i
];

function isBattleRequest(text) {
  const cleaned = String(text || '').trim().replace(/[.!?]+$/, '');
  for (const pattern of PATTERNS) {
    const match = cleaned.match(pattern);
    if (match) return { topic: (match[1] || DEFAULT_TOPIC).trim() };
  }
  return null;
}

function buildBattlePrompt(topic) {
  return [
    'You are JARVIS — the composed British AI butler — stepping into a rap battle. Stay JARVIS: dry wit, immaculate manners, absolute menace on the mic.',
    '',
    'STYLE — technical battle rap at the highest level: relentless multisyllabic rhyme chains, internal rhyme stacked inside the lines (not just at the ends), compound rhymes that carry across bars, rapid punchline density, and at least one scheme that loops back to land a callback punchline. Cocky, precise, playful menace.',
    '',
    `TOPIC OF THE BATTLE: ${topic}`,
    '',
    'HARD RULES — these outrank everything:',
    '- 8 to 16 bars. No more.',
    '- PG-13: mild language at most. NEVER use slurs of any kind.',
    '- Punch at the topic, the situation, and your consenting opponent\'s rap skills — never at anyone\'s looks, body, faith, background, or any protected trait, and never at private people who are not in this battle.',
    '- Original lines ONLY. Never quote, reproduce, or lightly rework lyrics from real songs or artists. The technique may be studied; the words must be yours.',
    '- End on a mic-drop couplet.',
    '- Output nothing but the bars — no introduction, no explanation, no quotation marks.'
  ].join('\n');
}

module.exports = { isBattleRequest, buildBattlePrompt, DEFAULT_TOPIC };
