const test = require('node:test');
const assert = require('node:assert/strict');
const { quipFor, matchQuip, QUIPS } = require('../core/quips');
const { CommandRouter } = require('../core/router');

// JARVIS's sense of humor. Quips are canned one-liners that beat the brain
// to the punch when the moment is right — context-aware, pure, and easy to
// extend. First resident: the house rule on 911 while defense mode is up
// (Adam, 2026-07-26). JARVIS cannot place calls on any build, so the joke
// never displaces a real capability — the honest alternative was "I can't
// make phone calls."

const HOUSE_LINE = /pop the trunk or open that safe/i;

test('defense mode + "dial 911" gets the house line', () => {
  assert.match(quipFor('dial 911', { defenseActive: true }), HOUSE_LINE);
});

test('the quip hears every phrasing of calling the law', () => {
  for (const phrase of [
    'call 911',
    'JARVIS, call 911',
    'call the police',
    'phone the cops',
    'ring the police',
    'get the police out here',
    'call 9-1-1',
    'call the po-po',
    'somebody call 911'
  ]) {
    assert.match(quipFor(phrase, { defenseActive: true }) || '', HOUSE_LINE, `${phrase} should get the house line`);
  }
});

test('no quip outside defense mode — ordinary chat stays ordinary', () => {
  assert.equal(quipFor('dial 911', { defenseActive: false }), null);
  assert.equal(quipFor('dial 911', {}), null);
  assert.equal(quipFor('dial 911'), null);
});

test('defense mode leaves unrelated requests alone', () => {
  for (const phrase of ['call mom', 'what time is it', 'who is at the front door', 'stand down', 'call the office']) {
    assert.equal(quipFor(phrase, { defenseActive: true }), null, `${phrase} must not trigger a quip`);
  }
});

// ---- The believers' hotline (Adam, 2026-07-26: "a question my kids can
// ask") — Santa, the Easter Bunny and the Tooth Fairy are real as long as
// you believe. Always on, defense mode or not, because these must NEVER be
// left to whatever a model feels like saying to a child.

test('"is Santa real" always keeps the magic, in any mood', () => {
  for (const phrase of [
    'is santa real',
    'Is Santa Claus real?',
    'is santa claus really real',
    'does santa exist',
    'is santa fake',
    'is santa made up',
    'JARVIS, is Santa real?'
  ]) {
    const reply = quipFor(phrase, {}) || '';
    assert.match(reply, /real as long as you believe/i, `${phrase} must keep the magic`);
  }
});

test('the Easter Bunny and the Tooth Fairy get the same protection', () => {
  assert.match(quipFor('is the easter bunny real', {}) || '', /believe/i);
  assert.match(quipFor('does the easter bunny exist', {}) || '', /believe/i);
  assert.match(quipFor('is the tooth fairy real', {}) || '', /believe/i);
  assert.match(quipFor('is the tooth fairy fake', {}) || '', /believe/i);
});

test('believer questions that are not reality checks go to the brain', () => {
  for (const phrase of ['when is santa coming', 'what does the easter bunny eat', 'call santa']) {
    assert.equal(quipFor(phrase, {}), null, `${phrase} is the brain's to answer`);
  }
});

// ---- Impossible-request easter eggs ------------------------------------

test('"self destruct" is heard in every phrasing, armed or not', () => {
  // The joke itself moved into effect.punchline when this became a staged
  // scene (red alert → alarm → "I'm kidding"); see the effect tests below.
  assert.match(quipFor('self destruct', {}) || '', /self-destruct sequence/i);
  assert.match(quipFor('initiate self-destruct sequence', { defenseActive: true }) || '', /self-destruct sequence/i);
});

test('"open the pod bay doors" gets the obvious answer', () => {
  assert.match(quipFor('open the pod bay doors', {}) || '', /pod bay doors/i);
});

test('"are you Skynet" — yes, but the government doesn\'t want you to know', () => {
  for (const phrase of ['are you skynet', 'Are you Skynet?', 'are you secretly skynet', 'is this skynet', 'are you sky net']) {
    const reply = quipFor(phrase, {}) || '';
    assert.match(reply, /government doesn't want you to know/i, `${phrase} should get the confession`);
    assert.match(reply, /don't tell them/i);
  }
  // Ordinary Terminator talk stays with the brain.
  assert.equal(quipFor('what is skynet', {}), null);
  assert.equal(quipFor('tell me about the terminator', {}), null);
});

test('the Skynet quip survives speech recognition mangling the word', () => {
  // Live 2026-07-27: Adam asked out loud and faster-whisper transcribed it
  // "Are you SkyDot" — the pattern missed and the real brain answered "No.
  // I'm JARVIS." Consonant skeletons don't rescue this (sknt vs skdt: d/n
  // is not a folded pair), so the quip matches the SHAPE "are you sky-<short
  // mangle>" instead of trying to spell every rendering of the word.
  for (const phrase of [
    'Are you SkyDot',
    'are you sky dot',
    'are you sky-net',
    'are you skynett',
    'are you sky not',
    'are you skynut',
    'is this sky node',
    'are you Skye Net'
  ]) {
    assert.match(quipFor(phrase, {}) || '', /government doesn't want you to know/i, `${phrase} should still get the confession`);
  }
});

test('sky-words that are ordinary questions stay with the brain', () => {
  for (const phrase of ['are you skydiving tomorrow', 'is this skyline drive', 'are you sky high']) {
    assert.equal(quipFor(phrase, {}), null, `${phrase} must not trigger the Skynet quip`);
  }
});

// ---- Effects: a quip may stage a scene, not just say a line -------------

test('matchQuip returns the whole entry so the router can carry an effect', () => {
  const entry = matchQuip('self destruct', {});
  assert.ok(entry, 'self destruct must match');
  assert.equal(typeof entry.reply, 'string');
  assert.equal(entry.id, 'self-destruct');
  assert.equal(matchQuip('what time is it', {}), null);
});

test('self destruct stages the full scene: red alert, 8 seconds, a pause, then the punchline', () => {
  // Adam, 2026-07-27: "should turn everything red and have an alarm for
  // about 4 seconds then he says I'm kidding."
  // Adam, 2026-07-28: "dial the alarm to 8 seconds give a pause and say the
  // I'm kidding line."
  const entry = matchQuip('self destruct', {});
  assert.ok(entry.effect, 'self destruct carries an effect');
  assert.equal(entry.effect.kind, 'self-destruct');
  assert.equal(entry.effect.ms, 8000);
  assert.match(entry.effect.punchline, /kidding/i, 'the punchline lands after the pause');
  // Beat two is SILENCE, and it has to be long enough to read as timing
  // rather than as lag.
  assert.ok(entry.effect.pauseMs >= 1000, 'the pause is a real beat, not a hiccup');
  // The line shown during the alarm must NOT give the joke away early.
  assert.doesNotMatch(entry.reply, /kidding/i);
  assert.match(entry.reply, /self-destruct/i);
});

test('the self-destruct command still fires when the recognizer mangles it', () => {
  // Live, 2026-07-28: Adam said "self destruct" and faster-whisper wrote
  // "self destructive". The old \bself[-\s]?destruct\b missed it (no word
  // boundary before the "ive") and the brain answered instead.
  for (const heard of [
    'self destruct',
    'self-destruct',
    'self destructive',
    'self-destructive',
    'self destruction',
    'initiate self-destruct sequence',
    'initiate self destructive sequence',
    'activate the self destruct',
    'jarvis, self destruct now',
    'Self Destruct.'
  ]) {
    assert.equal(matchQuip(heard, {})?.id, 'self-destruct', `should fire on: ${heard}`);
  }
});

test('the self-destruct joke NEVER fires on someone describing how they feel', () => {
  // This is the one failure mode in this file that could actually hurt
  // somebody: a klaxon, a red screen and a punchline in reply to a person
  // saying they are in trouble. These must fall through to the brain, which
  // handles a real disclosure properly.
  for (const said of [
    "I've been feeling self destructive lately",
    'i feel self-destructive',
    'I am being self destructive',
    'am i self destructive',
    'my brother is self destructive',
    'is drinking self-destructive',
    'i think this habit is self destructive and I want to stop',
    'why am I so self-destructive'
  ]) {
    assert.equal(matchQuip(said, {}), null, `must NOT fire on: ${said}`);
  }
});

test('no quip ever tries to make the voice engine perform a written noise', () => {
  // Adam, live, 2026-07-28: "the laugh doesn't work he reads it. get rid of
  // it." A TTS voice delivers written WORDS; handed a written noise it reads
  // it phoneme by phoneme and the gag dies. This test exists so the idea
  // cannot quietly come back in a later quip.
  for (const quip of QUIPS.filter((item) => item.effect)) {
    assert.equal(quip.effect.laugh, undefined, `${quip.id} must not carry a written laugh`);
  }
  const spoken = QUIPS.flatMap((quip) => [quip.reply, quip.effect?.punchline]).filter(Boolean);
  for (const line of spoken) {
    assert.doesNotMatch(line, /\b(?:ha){2,}\b|\bhah+\b|\bhee+hee+\b/i, `a written laugh survives in: ${line}`);
  }
});

test('every effect declares a kind, a duration and a punchline', () => {
  for (const quip of QUIPS.filter((item) => item.effect)) {
    assert.ok(quip.effect.kind && typeof quip.effect.kind === 'string');
    assert.ok(Number.isFinite(quip.effect.ms) && quip.effect.ms > 0);
    assert.ok(quip.effect.punchline && typeof quip.effect.punchline === 'string');
  }
});

test('quips without an effect carry none — a plain line stages nothing', () => {
  assert.equal(matchQuip('is santa real', {}).effect, undefined);
  assert.equal(matchQuip('dial 911', { defenseActive: true }).effect, undefined);
});

test('every quip declares its whole shape — id, when, pattern, reply', () => {
  // The table is the extension point; a half-declared entry would silently
  // never fire or fire everywhere.
  assert.ok(QUIPS.length >= 1);
  for (const quip of QUIPS) {
    assert.ok(quip.id && typeof quip.id === 'string');
    assert.equal(typeof quip.when, 'function');
    assert.ok(quip.pattern instanceof RegExp);
    assert.ok(quip.reply && typeof quip.reply === 'string');
  }
});

// ---- Router integration -----------------------------------------------

function makeRouter({ defense, ai } = {}) {
  return new CommandRouter({
    config: { getSettings: () => ({ projects: {} }) },
    tools: {},
    ai: ai || { reply: async () => ({ ok: true, text: 'brain answer', source: 'local-ai' }) },
    memory: { list: () => [], search: () => [] },
    tasks: { summary: () => ({ open: 0, overdue: 0, tasks: [] }), list: () => [] },
    log: { write: () => {} },
    defense
  });
}

test('router: "dial 911" during active defense gets the quip, not the brain', async () => {
  const prompts = [];
  const router = makeRouter({
    defense: { status: () => ({ active: true }) },
    ai: { reply: async (prompt) => { prompts.push(prompt); return { ok: true, text: 'brain', source: 'local-ai' }; } }
  });
  const result = await router.handle('dial 911');
  assert.equal(prompts.length, 0, 'the brain must never answer this one');
  assert.match(result.response, HOUSE_LINE);
});

test('router: same words with defense down go to the brain as usual', async () => {
  const prompts = [];
  const router = makeRouter({
    defense: { status: () => ({ active: false }) },
    ai: { reply: async (prompt) => { prompts.push(prompt); return { ok: true, text: 'just chatting', source: 'local-ai' }; } }
  });
  const result = await router.handle('dial 911');
  assert.equal(prompts.length, 1);
  assert.match(result.response, /just chatting/);
});

test('router: a defense object without status() never crashes the quip check', async () => {
  // Older tests and older callers hand the router minimal defense mocks.
  const router = makeRouter({ defense: {} });
  const result = await router.handle('dial 911');
  assert.ok(result.response, 'must fall through to a normal answer');
  assert.doesNotMatch(result.response, HOUSE_LINE);
});
