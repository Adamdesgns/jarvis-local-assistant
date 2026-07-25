const test = require('node:test');
const assert = require('node:assert');
const { detectPlay, buildPlayPrompt, buildStoryPrompt, buildFactPrompt } = require('../core/story-time');

test('story requests are recognised, with and without a topic', () => {
  assert.deepEqual(detectPlay('tell me a story'), { kind: 'story', topic: '' });
  assert.deepEqual(detectPlay('tell me a story about a dragon'), { kind: 'story', topic: 'a dragon' });
  assert.deepEqual(detectPlay('Tell me another story about space pirates'), { kind: 'story', topic: 'space pirates' });
  assert.deepEqual(detectPlay('can you tell me a story about my dog?'), { kind: 'story', topic: 'my dog' });
  assert.deepEqual(detectPlay('i want a bedtime story'), { kind: 'story', topic: '' });
  assert.deepEqual(detectPlay('make up a story about a lost sock'), { kind: 'story', topic: 'a lost sock' });
  assert.deepEqual(detectPlay('story about robots'), { kind: 'story', topic: 'robots' });
});

test('jokes, riddles, would-you-rather and facts each route to their own kind', () => {
  assert.equal(detectPlay('tell me a joke').kind, 'joke');
  assert.deepEqual(detectPlay('tell me a joke about cats'), { kind: 'joke', topic: 'cats' });
  assert.equal(detectPlay('make me laugh').kind, 'joke');
  assert.equal(detectPlay('tell me a riddle').kind, 'riddle');
  assert.equal(detectPlay('another riddle').kind, 'riddle');
  assert.equal(detectPlay('would you rather').kind, 'would-you-rather');
  assert.equal(detectPlay('tell me a fun fact').kind, 'fact');
  assert.deepEqual(detectPlay('fun fact about sharks'), { kind: 'fact', topic: 'sharks' });
  assert.equal(detectPlay('teach me something cool').kind, 'fact');
});

test('trailing politeness and punctuation do not break the match', () => {
  assert.deepEqual(detectPlay('tell me a story about pirates please'), { kind: 'story', topic: 'pirates' });
  assert.deepEqual(detectPlay('tell me a joke!'), { kind: 'joke', topic: '' });
});

test('ordinary sentences that merely mention a story are not story requests', () => {
  for (const phrase of [
    'what is a story',
    'i read a story at school today',
    'my story homework is due tomorrow',
    'the joke book is on my shelf',
    'add a story to my homework list',
    'why do people tell stories'
  ]) {
    assert.equal(detectPlay(phrase), null, `false catch on: ${phrase}`);
  }
});

test('story length grows with age, and the safety block rides along every time', () => {
  const little = buildStoryPrompt({ topic: 'a fox', age: 5 });
  const big = buildStoryPrompt({ topic: 'a fox', age: 12 });
  assert.match(little, /120 to 180 words/);
  assert.match(big, /350 to 500 words/);
  for (const prompt of [little, big]) {
    assert.match(prompt, /HARD RULES/);
    assert.match(prompt, /a fox/);
  }
});

test('stories never star somebody else’s characters', () => {
  const prompt = buildStoryPrompt({ topic: 'Elsa from Frozen', age: 7 });
  assert.match(prompt, /Never write about characters from films, games, books, or shows that somebody else made up/);
  assert.match(prompt, /make up a new character/);
});

test('a story with no topic still has something to be about', () => {
  assert.match(buildStoryPrompt({ age: 8 }), /THE STORY IS ABOUT: a small brave animal/);
});

test('the child is the hero only when there is a name to use', () => {
  assert.match(buildStoryPrompt({ age: 8, kidName: 'Noor' }), /Noor may be in the story as the hero/);
  assert.doesNotMatch(buildStoryPrompt({ age: 8 }), /may be in the story as the hero/);
});

test('every story rules out the things that keep a child awake', () => {
  const prompt = buildStoryPrompt({ topic: 'a haunted house', age: 9 });
  assert.match(prompt, /nobody dies/);
  assert.match(prompt, /no cliffhanger/);
  assert.match(prompt, /ends safe and settled/);
});

test('facts must be true, and riddles must not give themselves away', () => {
  assert.match(buildFactPrompt({ age: 9 }), /It must be TRUE/);
  assert.match(buildFactPrompt({ age: 9 }), /Never invent a number/);
  assert.match(buildPlayPrompt('riddle', { age: 9 }), /Do NOT reveal the answer/);
});

test('every detectable kind has a prompt builder, and unknown kinds build nothing', () => {
  for (const kind of ['story', 'joke', 'riddle', 'would-you-rather', 'fact']) {
    assert.ok(buildPlayPrompt(kind, { age: 8 }), `no builder for ${kind}`);
    assert.match(buildPlayPrompt(kind, { age: 8 }), /HARD RULES/);
  }
  assert.equal(buildPlayPrompt('nonsense', {}), null);
});
