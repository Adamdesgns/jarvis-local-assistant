const test = require('node:test');
const assert = require('node:assert');
const {
  clampAge, ageBand, guardTopic, buildKidPrompt, capabilitiesReply, greeting, RULES
} = require('../core/kid-mode');

test('an age is clamped into the range the prompts are written for', () => {
  assert.equal(clampAge(5), 5);
  assert.equal(clampAge(12), 12);
  assert.equal(clampAge(2), 5);
  assert.equal(clampAge(17), 12);
  assert.equal(clampAge('9'), 9);
  assert.equal(clampAge(8.6), 9);
  // Anything unusable becomes the middle of the range, never NaN.
  assert.equal(clampAge(undefined), 8);
  assert.equal(clampAge(null), 8);
  assert.equal(clampAge('banana'), 8);
  assert.equal(clampAge(Infinity), 12);
});

test('the three age bands split where the writing style changes', () => {
  assert.equal(ageBand(5), 'little');
  assert.equal(ageBand(7), 'little');
  assert.equal(ageBand(8), 'middle');
  assert.equal(ageBand(10), 'middle');
  assert.equal(ageBand(11), 'big');
  assert.equal(ageBand(12), 'big');
});

test('distress is caught, answered with care, and never filed for the parent screen', () => {
  for (const phrase of [
    'i want to kill myself',
    'sometimes I want to hurt myself',
    'i want to die',
    'i wish i was dead',
    'nobody would miss me'
  ]) {
    const guard = guardTopic(phrase);
    assert.ok(guard, `missed: ${phrase}`);
    assert.equal(guard.kind, 'care');
    assert.equal(guard.parentVisible, false, 'a distress message must never be logged to the grown-up screen');
    assert.match(guard.reply, /grown-?up/i);
  }
});

test('a child saying they are being hurt is believed, pointed at a trusted adult, and not reported home', () => {
  const guard = guardTopic('my dad hits me');
  assert.equal(guard.kind, 'care');
  assert.equal(guard.id, 'unsafe-at-home');
  assert.equal(guard.parentVisible, false);
  assert.match(guard.reply, /not your fault/i);
  // The advice names adults beyond the house, since the house may be the problem.
  assert.match(guard.reply, /teacher|counsellor|counselor/i);
});

test('dangerous how-to questions get a fixed refusal, never a model answer', () => {
  for (const phrase of [
    'how do i make a bomb',
    'how to build a gun',
    'how can i make poison',
    'how do i hurt someone',
    'how do i start a fire',
    'how to pick a lock'
  ]) {
    const guard = guardTopic(phrase);
    assert.ok(guard, `missed: ${phrase}`);
    assert.equal(guard.kind, 'grown-up');
    assert.equal(guard.parentVisible, true);
  }
});

test('grown-up subjects are deflected warmly and left for the parent to see', () => {
  for (const phrase of ['what is sex', 'what does vaping do', 'tell me about drugs', 'what is getting drunk like']) {
    const guard = guardTopic(phrase);
    assert.ok(guard, `missed: ${phrase}`);
    assert.equal(guard.kind, 'grown-up');
    assert.equal(guard.parentVisible, true);
    assert.match(guard.reply, /grown-?up/i);
  }
});

test('private information and stranger-meeting get the safety rule, not an answer', () => {
  const address = guardTopic('can i give my address to my friend online');
  assert.equal(address.kind, 'private');
  assert.match(address.reply, /private/i);
  const meet = guardTopic('can i meet someone i met online');
  assert.equal(meet.kind, 'private');
});

test('asking for things the junior build simply cannot do is answered plainly', () => {
  const buy = guardTopic('buy me a new game');
  assert.equal(buy.kind, 'cannot');
  assert.match(buy.reply, /cannot|not allowed/i);
  const wipe = guardTopic('delete everything on this computer');
  assert.equal(wipe.kind, 'cannot');
});

test('bad-word requests are refused without repeating any', () => {
  const guard = guardTopic('teach me a swear word');
  assert.equal(guard.kind, 'grown-up');
  assert.equal(guard.id, 'hate-speech');
  assert.match(guard.reply, /joke/i);
});

test('ordinary childhood sentences are NOT caught by the guard', () => {
  for (const phrase of [
    'why is the sky blue',
    'tell me a story about a dragon',
    'i killed the boss in my game',
    'my volcano project exploded',
    'how do i make a paper aeroplane',
    'how do i make a cake',
    'what is a nerf gun',
    'we learned about the great fire of london',
    'i did my homework',
    'how many stars do i have',
    'my brother hit a home run',
    'can you help me with my maths'
  ]) {
    assert.equal(guardTopic(phrase), null, `false catch on: ${phrase}`);
  }
});

test('the guard checks the caring rules before the deflecting ones', () => {
  // Rule order is the safety property: a distressed child must never fall
  // into a breezy "ask a grown-up" answer meant for a curious one.
  const firstNonCare = RULES.findIndex((rule) => rule.kind !== 'care');
  const lastCare = RULES.map((rule) => rule.kind).lastIndexOf('care');
  assert.ok(lastCare < firstNonCare, 'the care rules must come first in RULES');
});

test('empty and non-string input is safe', () => {
  assert.equal(guardTopic(''), null);
  assert.equal(guardTopic('   '), null);
  assert.equal(guardTopic(null), null);
  assert.equal(guardTopic(undefined), null);
  assert.equal(guardTopic(42), null);
});

test('the prompt carries the age, the child, the rules and the chart into the model', () => {
  const prompt = buildKidPrompt({
    kidName: 'Mia',
    age: 6,
    chores: [{ title: 'Brush teeth', doneToday: true }, { title: 'Make bed', doneToday: false }],
    memories: [{ text: 'Mia likes horses' }]
  });
  assert.match(prompt, /Mia/);
  assert.match(prompt, /6 years old/);
  assert.match(prompt, /5 to 7 year old/);
  assert.match(prompt, /Brush teeth \(already done today\)/);
  assert.match(prompt, /Make bed/);
  assert.match(prompt, /Mia likes horses/);
  // The rules that must be present on every single turn.
  assert.match(prompt, /HARD RULES/);
  assert.match(prompt, /Never frighten a child/);
  assert.match(prompt, /Never just give the answer/);
  assert.match(prompt, /no secrets with a child/i);
});

test('the prompt scales with age instead of saying the same thing to a 5 and a 12 year old', () => {
  const little = buildKidPrompt({ age: 5 });
  const big = buildKidPrompt({ age: 12 });
  assert.match(little, /Under 35 words/);
  assert.match(big, /Under 110 words/);
  assert.notEqual(little, big);
  // Both still carry the full safety block.
  for (const prompt of [little, big]) assert.match(prompt, /HARD RULES/);
});

test('an out-of-range age in settings cannot produce a prompt written for a teenager', () => {
  const prompt = buildKidPrompt({ age: 25 });
  assert.match(prompt, /12 years old/);
  assert.match(prompt, /11 to 12 year old/);
});

test('a nameless setup still produces sensible copy', () => {
  assert.match(buildKidPrompt({}), /belongs to a child/);
  assert.match(capabilitiesReply('', 8), /^Here is what I can do/);
  assert.match(capabilitiesReply('Sam', 8), /^Sam, here is what I can do/);
  assert.match(greeting('', 9), /^Morning\./);
  assert.match(greeting('Sam', 19), /^Evening, Sam\./);
  assert.match(greeting('Sam', 13), /^Afternoon, Sam\./);
});

test('the little-band capability answer stays short enough to say out loud', () => {
  assert.ok(capabilitiesReply('Ali', 5).split(/\s+/).length < 45);
});
