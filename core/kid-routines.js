'use strict';

// Timers and routines for the junior build.
//
// Pure: this module parses what the child said and hands back the steps. The
// junior window runs the actual countdown, because a clock that lives in the
// renderer keeps ticking correctly whether or not the brain is busy thinking.

const MAX_TIMER_SECONDS = 60 * 60; // An hour. Longer than any child's job.

const WORD_NUMBERS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, half: 0.5, a: 1, an: 1
};

function parseCount(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value);
  return Object.prototype.hasOwnProperty.call(WORD_NUMBERS, value) ? WORD_NUMBERS[value] : null;
}

// "set a timer for 5 minutes", "2 minute timer", "time me for thirty seconds".
const TIMER_PATTERNS = [
  /^(?:can you |please )?(?:set|start|put on|make)\s+(?:a|the)?\s*timer\s+(?:for\s+)?([a-z0-9]+)\s*(second|seconds|sec|minute|minutes|min|mins|hour|hours)\b/i,
  /^(?:can you |please )?time\s+me\s+for\s+([a-z0-9]+)\s*(second|seconds|sec|minute|minutes|min|mins|hour|hours)\b/i,
  /^([a-z0-9]+)[\s-]*(second|minute|hour)s?\s+timer$/i,
  /^(?:set|start)\s+(?:a|the)?\s*([a-z0-9]+)[\s-]*(second|minute|hour)s?\s+timer$/i
];

function detectTimer(text) {
  const cleaned = String(text || '').trim().replace(/[.!?]+$/, '');
  for (const pattern of TIMER_PATTERNS) {
    const match = cleaned.match(pattern);
    if (!match) continue;
    const count = parseCount(match[1]);
    if (count === null || count <= 0) continue;
    const unit = match[2].toLowerCase();
    const multiplier = unit.startsWith('hour') ? 3600 : unit.startsWith('min') ? 60 : 1;
    const seconds = Math.round(count * multiplier);
    if (seconds < 1) continue;
    return { seconds: Math.min(MAX_TIMER_SECONDS, seconds), label: 'Timer' };
  }
  return null;
}

// "5 minutes" said out loud, without the awkward "5 minute(s) 0 seconds".
function describeDuration(totalSeconds) {
  const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  const minutePart = `${minutes} minute${minutes === 1 ? '' : 's'}`;
  return rest ? `${minutePart} and ${rest} second${rest === 1 ? '' : 's'}` : minutePart;
}

// The routines. Steps carry their own seconds so the junior window can run a
// countdown per step and move itself along.
const ROUTINES = {
  morning: {
    key: 'morning',
    title: 'Morning routine',
    intro: 'Morning routine. I will tell you each thing, one at a time.',
    finish: 'That is the whole morning routine done. You are ready.',
    steps: [
      { text: 'Get dressed — everything, including socks.', seconds: 300 },
      { text: 'Brush your teeth. Top, bottom, front, back.', seconds: 120 },
      { text: 'Brush or comb your hair.', seconds: 60 },
      { text: 'Eat your breakfast.', seconds: 600 },
      { text: 'Pack your bag and put your shoes on.', seconds: 180 }
    ]
  },
  bedtime: {
    key: 'bedtime',
    title: 'Bedtime routine',
    intro: 'Bedtime routine. Nice and calm — one thing at a time.',
    finish: 'All done. Sleep well.',
    steps: [
      { text: 'Put your toys away.', seconds: 180 },
      { text: 'Put your pyjamas on.', seconds: 180 },
      { text: 'Brush your teeth. Two whole minutes.', seconds: 120 },
      { text: 'Wash your face and hands.', seconds: 60 },
      { text: 'Get into bed and pick a story.', seconds: 60 }
    ]
  },
  'brush-teeth': {
    key: 'brush-teeth',
    title: 'Toothbrush timer',
    intro: 'Two minutes of brushing. I will move you around your mouth.',
    finish: 'Two minutes done. Spit, do not rinse — the toothpaste keeps working.',
    steps: [
      { text: 'Top teeth on the right. Little circles.', seconds: 30 },
      { text: 'Top teeth on the left.', seconds: 30 },
      { text: 'Bottom teeth on the right.', seconds: 30 },
      { text: 'Bottom teeth on the left. Do not forget the backs.', seconds: 30 }
    ]
  },
  homework: {
    key: 'homework',
    title: 'Homework time',
    intro: 'Homework time. Twenty-five minutes of work, then a proper break.',
    finish: 'Time is up. Well done — go and have your break.',
    steps: [
      { text: 'Clear the table and get everything you need out.', seconds: 120 },
      { text: 'Pick the hardest thing first and start it.', seconds: 900 },
      { text: 'Keep going — you are more than halfway.', seconds: 600 },
      { text: 'Check your work over before you pack up.', seconds: 180 }
    ]
  },
  'tidy-up': {
    key: 'tidy-up',
    title: 'Tidy-up race',
    intro: 'Tidy-up race. Ten minutes. Go as fast as you like.',
    finish: 'Time. Have a look around — that is a much better room.',
    steps: [
      { text: 'All the rubbish in the bin.', seconds: 120 },
      { text: 'All the clothes in the wash basket or the drawer.', seconds: 180 },
      { text: 'All the toys back in their boxes.', seconds: 180 },
      { text: 'Books on the shelf, and make your bed.', seconds: 120 }
    ]
  },
  calm: {
    key: 'calm',
    title: 'Calming down',
    intro: 'Let us slow everything down together. Follow my voice.',
    finish: 'Better? If you still feel wobbly, go and find a grown-up you trust.',
    steps: [
      { text: 'Sit down somewhere comfy. Put both feet flat on the floor.', seconds: 20 },
      { text: 'Breathe in slowly while I count to four. One, two, three, four.', seconds: 20 },
      { text: 'Hold it. Now let it out slowly, all the way.', seconds: 20 },
      { text: 'Again, twice more. Slow in, slow out.', seconds: 40 },
      { text: 'Now name five things you can see around you.', seconds: 40 }
    ]
  }
};

const ROUTINE_PATTERNS = [
  { key: 'morning', pattern: /\b(?:morning routine|get ready for school|getting ready for school|school routine)\b/i },
  { key: 'bedtime', pattern: /\b(?:bed\s?time routine|get ready for bed|getting ready for bed|time for bed|night routine)\b/i },
  { key: 'brush-teeth', pattern: /\b(?:brush(?:ing)? (?:my )?teeth|tooth ?brush(?:ing)? timer|teeth timer)\b/i },
  { key: 'homework', pattern: /\b(?:homework time|start (?:my )?homework|homework timer|do my homework)\b/i },
  { key: 'tidy-up', pattern: /\b(?:tidy(?:ing)?[- ]up|tidy my room|clean my room|clean up time)\b/i },
  { key: 'calm', pattern: /\b(?:calm me down|help me calm down|i(?:'m| am) (?:angry|upset|cross|worried|nervous)|calm down)\b/i }
];

function detectRoutine(text) {
  const cleaned = String(text || '').trim();
  if (!cleaned) return null;
  for (const { key, pattern } of ROUTINE_PATTERNS) {
    if (pattern.test(cleaned)) return ROUTINES[key];
  }
  return null;
}

function routineSeconds(routine) {
  return (routine && routine.steps ? routine.steps : []).reduce((total, step) => total + (Number(step.seconds) || 0), 0);
}

function describeRoutine(routine) {
  if (!routine) return '';
  return `${routine.intro} ${routine.steps.length} steps, about ${describeDuration(routineSeconds(routine))} altogether.`;
}

module.exports = {
  ROUTINES,
  MAX_TIMER_SECONDS,
  parseCount,
  detectTimer,
  detectRoutine,
  describeDuration,
  describeRoutine,
  routineSeconds
};
