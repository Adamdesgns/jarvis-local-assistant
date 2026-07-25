const test = require('node:test');
const assert = require('node:assert');
const {
  ROUTINES, MAX_TIMER_SECONDS, detectTimer, detectRoutine, describeDuration, describeRoutine, routineSeconds
} = require('../core/kid-routines');

test('timers are parsed from the ways a child actually asks', () => {
  assert.deepEqual(detectTimer('set a timer for 5 minutes'), { seconds: 300, label: 'Timer' });
  assert.deepEqual(detectTimer('set a timer for 30 seconds'), { seconds: 30, label: 'Timer' });
  assert.deepEqual(detectTimer('start a timer for two minutes'), { seconds: 120, label: 'Timer' });
  assert.deepEqual(detectTimer('time me for ten seconds'), { seconds: 10, label: 'Timer' });
  assert.deepEqual(detectTimer('5 minute timer'), { seconds: 300, label: 'Timer' });
  assert.deepEqual(detectTimer('set a 3 minute timer'), { seconds: 180, label: 'Timer' });
  assert.deepEqual(detectTimer('put on a timer for 1 hour'), { seconds: 3600, label: 'Timer' });
});

test('a timer is capped at an hour, however long the child asks for', () => {
  assert.equal(detectTimer('set a timer for 9 hours').seconds, MAX_TIMER_SECONDS);
  assert.equal(detectTimer('set a timer for 500 minutes').seconds, MAX_TIMER_SECONDS);
});

test('sentences that merely mention time are not timers', () => {
  for (const phrase of [
    'what is the time',
    'how long is a minute',
    'i waited five minutes for the bus',
    'tell me a story about a timer',
    'set the table'
  ]) {
    assert.equal(detectTimer(phrase), null, `false catch on: ${phrase}`);
  }
});

test('a zero or wordless duration is not a timer', () => {
  assert.equal(detectTimer('set a timer for 0 minutes'), null);
  assert.equal(detectTimer('set a timer for banana minutes'), null);
  assert.equal(detectTimer('set a timer'), null);
});

test('durations are spoken the way a person would say them', () => {
  assert.equal(describeDuration(30), '30 seconds');
  assert.equal(describeDuration(1), '1 second');
  assert.equal(describeDuration(60), '1 minute');
  assert.equal(describeDuration(300), '5 minutes');
  assert.equal(describeDuration(90), '1 minute and 30 seconds');
  assert.equal(describeDuration(0), '0 seconds');
});

test('each routine phrase reaches its own routine', () => {
  assert.equal(detectRoutine('morning routine').key, 'morning');
  assert.equal(detectRoutine('help me get ready for school').key, 'morning');
  assert.equal(detectRoutine('bedtime routine').key, 'bedtime');
  assert.equal(detectRoutine('i need to get ready for bed').key, 'bedtime');
  assert.equal(detectRoutine('brush my teeth').key, 'brush-teeth');
  assert.equal(detectRoutine('teeth timer').key, 'brush-teeth');
  assert.equal(detectRoutine('homework time').key, 'homework');
  assert.equal(detectRoutine('tidy my room').key, 'tidy-up');
  assert.equal(detectRoutine('help me calm down').key, 'calm');
  assert.equal(detectRoutine("i'm angry").key, 'calm');
});

test('unrelated sentences do not start a routine', () => {
  for (const phrase of [
    'what is a routine',
    'tell me a story about the morning',
    'why do we brush our teeth',
    'what is homework for'
  ]) {
    assert.equal(detectRoutine(phrase), null, `false catch on: ${phrase}`);
  }
});

test('every routine is complete and sane enough to read out loud', () => {
  for (const [key, routine] of Object.entries(ROUTINES)) {
    assert.equal(routine.key, key);
    assert.ok(routine.title && routine.intro && routine.finish, `${key} is missing its copy`);
    assert.ok(routine.steps.length >= 4, `${key} needs steps`);
    for (const step of routine.steps) {
      assert.ok(step.text.length > 5, `${key} has an empty step`);
      assert.ok(step.seconds > 0 && step.seconds <= 1800, `${key} has an unusable step length`);
    }
  }
});

test('the toothbrush routine really is two minutes, in four fair quarters', () => {
  assert.equal(routineSeconds(ROUTINES['brush-teeth']), 120);
  assert.ok(ROUTINES['brush-teeth'].steps.every((step) => step.seconds === 30));
});

test('the calming routine ends by pointing at a real grown-up', () => {
  assert.match(ROUTINES.calm.finish, /grown-?up/i);
});

test('a routine describes itself with its step count and total time', () => {
  const spoken = describeRoutine(ROUTINES.bedtime);
  assert.match(spoken, /5 steps/);
  assert.match(spoken, /minutes/);
  assert.equal(describeRoutine(null), '');
});
