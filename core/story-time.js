'use strict';

// Story time, jokes, riddles, would-you-rather and fun facts.
//
// Same shape as battle-mode.js: narrow patterns so ordinary sentences never
// turn into a bedtime story, pure prompt builders, and the hard rules written
// into both the prompt and the tests so they cannot quietly drift.

const { clampAge, ageBand, kidSafetyRules } = require('./kid-mode');

const DEFAULT_STORY_TOPIC = 'a small brave animal';

const PATTERNS = [
  { kind: 'story', pattern: /^(?:can you |will you |please )?tell(?:\s+me)?\s+(?:a|another)\s+story(?:\s+(?:about|with|of)\s+(.+))?$/i },
  { kind: 'story', pattern: /^(?:i want|i'd like|can i have)\s+(?:a|another)\s+(?:bed\s?time\s+)?story(?:\s+(?:about|with)\s+(.+))?$/i },
  { kind: 'story', pattern: /^(?:make up|read me|say)\s+(?:a|another)\s+story(?:\s+(?:about|with)\s+(.+))?$/i },
  { kind: 'story', pattern: /^(?:bed\s?time\s+)?story\s+(?:about|time)(?:\s+(.+))?$/i },
  { kind: 'joke', pattern: /^(?:can you |please )?tell(?:\s+me)?\s+(?:a|another)\s+joke(?:\s+about\s+(.+))?$/i },
  { kind: 'joke', pattern: /^(?:say|make up|got)\s+(?:a|another)\s+(?:funny\s+)?joke(?:\s+about\s+(.+))?$/i },
  { kind: 'joke', pattern: /^(?:make me laugh|be funny|another joke|tell me another one)$/i },
  { kind: 'riddle', pattern: /^(?:can you |please )?(?:tell|give|ask)(?:\s+me)?\s+(?:a|another)\s+riddle(?:\s+about\s+(.+))?$/i },
  { kind: 'riddle', pattern: /^(?:riddle me|another riddle)$/i },
  { kind: 'would-you-rather', pattern: /^(?:play\s+)?would\s+you\s+rather(?:\s+about\s+(.+))?$/i },
  { kind: 'would-you-rather', pattern: /^(?:give|ask)(?:\s+me)?\s+a\s+would\s+you\s+rather$/i },
  { kind: 'fact', pattern: /^(?:tell(?:\s+me)?\s+)?(?:a\s+)?(?:fun|cool|weird|amazing)\s+fact(?:\s+about\s+(.+))?$/i },
  { kind: 'fact', pattern: /^(?:teach|tell)(?:\s+me)?\s+something\s+(?:cool|new|interesting)(?:\s+about\s+(.+))?$/i }
];

// Returns { kind, topic } or null. The topic is whatever the child named,
// trimmed of trailing punctuation and politeness.
function detectPlay(text) {
  const cleaned = String(text || '').trim().replace(/\s+please$/i, '').replace(/[.!?]+$/, '');
  for (const { kind, pattern } of PATTERNS) {
    const match = cleaned.match(pattern);
    if (match) return { kind, topic: (match[1] || '').trim() };
  }
  return null;
}

// Story length by age: a 5-year-old wants a bedtime story that ends before
// they wriggle off the bed; an 11-year-old wants an actual plot.
const STORY_SHAPE = {
  little: { words: '120 to 180 words', shape: 'One simple problem, one kind fix, a happy ending. Three characters at most.' },
  middle: { words: '220 to 320 words', shape: 'A beginning, a proper problem, one surprise, and an ending that ties it up.' },
  big: { words: '350 to 500 words', shape: 'A real plot with a turn in the middle, a character who wants something and changes, and an ending that earns itself.' }
};

function buildStoryPrompt({ topic = '', age, kidName = '' } = {}) {
  const band = ageBand(age);
  const shape = STORY_SHAPE[band];
  const name = String(kidName || '').trim();
  const subject = String(topic || '').trim() || DEFAULT_STORY_TOPIC;
  return [
    `You are telling a bedtime-quality story out loud to ${name || 'a child'}, aged ${clampAge(age)}.`,
    `THE STORY IS ABOUT: ${subject}`,
    '',
    'HOW TO WRITE IT:',
    `- ${shape.words}. ${shape.shape}`,
    '- Invent your own characters and your own world. Never write about characters from films, games, books, or shows that somebody else made up — if the child names one, make up a new character who is a bit like them and give them a different name.',
    name ? `- ${name} may be in the story as the hero if it fits naturally. Nobody in the story ever gets hurt or humiliated.` : '- Nobody in the story ever gets hurt or humiliated.',
    '- Warm, funny, and a bit surprising. Kindness solves the problem, not force.',
    '- No villains who are truly frightening, nothing in the dark that is real, nobody dies, nobody is lost for long, and no cliffhanger. It ends safe and settled.',
    '- Plain spoken sentences — this is read aloud. No chapter headings, no markdown, no emoji, no "The End".',
    '- Output only the story itself. No title, no introduction, no notes about the story.',
    '',
    kidSafetyRules()
  ].join('\n');
}

function buildJokePrompt({ topic = '', age } = {}) {
  const subject = String(topic || '').trim();
  return [
    `Tell exactly one joke to a child aged ${clampAge(age)}.`,
    subject ? `THE JOKE IS ABOUT: ${subject}` : 'Pick any subject a child finds funny — animals, food, school, space, dinosaurs.',
    '',
    'RULES:',
    '- A proper joke a child can repeat at school: a setup line and a punchline. Puns and knock-knocks are perfect.',
    '- Clean. Nothing about bodies, nothing mean about anybody, nobody is the butt of it.',
    '- Two or three lines. Output only the joke — no "here is a joke", no explaining why it is funny.',
    '',
    kidSafetyRules()
  ].join('\n');
}

function buildRiddlePrompt({ topic = '', age } = {}) {
  const subject = String(topic || '').trim();
  return [
    `Ask a child aged ${clampAge(age)} exactly one riddle.`,
    subject ? `THE RIDDLE IS ABOUT: ${subject}` : '',
    '',
    'RULES:',
    '- Solvable by this age with a moment of thought. Not a trick, not a maths trap.',
    '- Give the riddle, then on a new line write: Say your answer when you are ready.',
    '- Do NOT reveal the answer. Keep it for when they guess.',
    '- Nothing frightening. No riddles about death, dark, or being lost.',
    '',
    kidSafetyRules()
  ].filter(Boolean).join('\n');
}

function buildWouldYouRatherPrompt({ topic = '', age } = {}) {
  const subject = String(topic || '').trim();
  return [
    `Give a child aged ${clampAge(age)} one "would you rather" question.`,
    subject ? `ABOUT: ${subject}` : '',
    '',
    'RULES:',
    '- Two options, both fun, genuinely hard to choose between. Silly is good.',
    '- Nothing that involves being hurt, scared, alone, or losing somebody.',
    '- One or two lines, ending with the question. Then wait for their answer.',
    '',
    kidSafetyRules()
  ].filter(Boolean).join('\n');
}

function buildFactPrompt({ topic = '', age } = {}) {
  const subject = String(topic || '').trim();
  return [
    `Tell a child aged ${clampAge(age)} one genuinely true, genuinely surprising fact.`,
    subject ? `ABOUT: ${subject}` : 'Pick something from nature, space, animals, or how things work.',
    '',
    'RULES:',
    '- It must be TRUE. If you are not sure it is true, pick a different fact. Never invent a number.',
    '- Say the fact, then one sentence of why it is surprising or how it works.',
    '- Under 50 words. Nothing gruesome — no facts about how animals kill, no facts about death.',
    '',
    kidSafetyRules()
  ].join('\n');
}

const BUILDERS = {
  story: buildStoryPrompt,
  joke: buildJokePrompt,
  riddle: buildRiddlePrompt,
  'would-you-rather': buildWouldYouRatherPrompt,
  fact: buildFactPrompt
};

function buildPlayPrompt(kind, options = {}) {
  const builder = BUILDERS[kind];
  if (!builder) return null;
  return builder(options);
}

module.exports = {
  DEFAULT_STORY_TOPIC,
  STORY_SHAPE,
  detectPlay,
  buildStoryPrompt,
  buildJokePrompt,
  buildRiddlePrompt,
  buildWouldYouRatherPrompt,
  buildFactPrompt,
  buildPlayPrompt
};
