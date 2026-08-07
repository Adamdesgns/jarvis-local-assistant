// Adam's brief, turned into prompt material. Everything here is pure string
// work so the prompts can be tested without an API key.
//
// The parser is deliberately forgiving. This is a file a human edits between
// calls, so a missing heading or an empty file must degrade to "record anyway,
// say what is missing" — never to a thrown error thirty seconds before a
// sales call.

const WANTED = ['business', 'pricing', 'objections'];

function parseBrief(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  const sections = {};
  const warnings = [];

  if (!text) {
    return { ok: false, sections, warnings: ['The brief is empty, so coaching will be generic.'] };
  }

  const lines = text.split(/\r?\n/);
  let current = null;
  let buffer = [];
  const flush = () => {
    if (current && buffer.length) sections[current] = buffer.join('\n').trim();
    buffer = [];
  };

  for (const line of lines) {
    const heading = line.match(/^#{1,3}\s+(.+?)\s*$/);
    if (heading) {
      flush();
      current = heading[1].toLowerCase();
    } else {
      if (!current) current = 'business';
      buffer.push(line);
    }
  }
  flush();

  for (const key of WANTED) {
    if (!sections[key]) warnings.push(`No "${key}" section — advice on that will be generic.`);
  }

  return { ok: Object.keys(sections).length > 0, sections, warnings };
}

function briefBlock(brief) {
  return Object.entries(brief.sections)
    .map(([name, body]) => `${name.toUpperCase()}\n${body}`)
    .join('\n\n');
}

function buildPrepPrompt(brief, prospect) {
  const who = String(prospect || '').trim() || 'an unnamed prospect';
  return [
    `I am about to get on a call with ${who}.`,
    '',
    'Here is my brief on what I sell:',
    '',
    briefBlock(brief),
    '',
    'Give me, in this order and nothing else:',
    '1. How to open — two sentences I could actually say out loud.',
    '2. The three objections most likely from this specific prospect, each with the line that answers it.',
    '3. Three questions I should ask them.',
    '',
    'Be concrete and use my real pricing where it is relevant. Do not invent',
    'numbers that are not in the brief.'
  ].join('\n');
}

function buildAnswerSystem(brief) {
  return [
    'You are helping the user live, mid-conversation, on a call they are on right now.',
    'Answer in at most three short sentences. Lead with the answer — they are',
    'reading this while someone waits for them to speak.',
    '',
    'Everything you know about their business is below. Do not invent pricing,',
    'features, or commitments that are not here; if the answer is not in the',
    'brief or the transcript, say so plainly in one line.',
    '',
    briefBlock(brief)
  ].join('\n');
}

module.exports = { parseBrief, buildPrepPrompt, buildAnswerSystem };
