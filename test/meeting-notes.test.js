const test = require('node:test');
const assert = require('node:assert/strict');
const { MeetingNotes } = require('../core/meeting/meeting-notes');
const { MeetingTranscript } = require('../core/meeting/meeting-transcript');

// This is the only thing calling Claude continuously, so the tests are about
// restraint and survival: it must not fire on an unchanged transcript, must not
// fire more often than the interval, and a failed call must never take the
// meeting down — the spec's rule is that transcription keeps running no matter
// what the model does.

function fakeAi(reply) {
  const calls = [];
  return {
    calls,
    async cloudReply(text, context) {
      calls.push({ text, context });
      if (reply instanceof Error) throw reply;
      return { ok: true, text: reply };
    }
  };
}

function clock(start = 0) {
  const c = { t: start, now: () => c.t, advance: (ms) => { c.t += ms; } };
  return c;
}

test('notes: does not call the model with an empty transcript', async () => {
  const ai = fakeAi('notes');
  const transcript = new MeetingTranscript();
  const notes = new MeetingNotes({ ai, transcript, intervalMs: 1000, now: () => 10_000 });
  assert.equal(await notes.maybeRefresh(), false);
  assert.equal(ai.calls.length, 0);
});

test('notes: refreshes once the interval has passed', async () => {
  const ai = fakeAi('- covered pricing');
  const transcript = new MeetingTranscript();
  transcript.append('we talked about price');
  const c = clock(0);
  const notes = new MeetingNotes({ ai, transcript, intervalMs: 1000, now: c.now });
  assert.equal(await notes.maybeRefresh(), false, 'not before the first interval');
  c.advance(1001);
  assert.equal(await notes.maybeRefresh(), true);
  assert.equal(notes.latest, '- covered pricing');

  const { context } = ai.calls[0];
  assert.equal(context.untrustedContent, true, 'meeting speech must never enter the shared history');
  assert.match(
    context.systemOverride,
    /COVERED/,
    'notes instructions must live in systemOverride so ai-service skips the general history read'
  );
  assert.ok(!('skipHistory' in context), 'the invented flag must be gone, not silently reintroduced');
});

test('notes: will not refresh again when nothing new was said', async () => {
  const ai = fakeAi('- covered pricing');
  const transcript = new MeetingTranscript();
  transcript.append('we talked about price');
  const c = clock(0);
  const notes = new MeetingNotes({ ai, transcript, intervalMs: 1000, now: c.now });
  c.advance(1001);
  await notes.maybeRefresh();
  c.advance(5000);
  assert.equal(await notes.maybeRefresh(), false, 'same transcript, no second call');
  assert.equal(ai.calls.length, 1);
});

test('notes: a model failure is recorded and the notes survive', async () => {
  const transcript = new MeetingTranscript();
  transcript.append('we talked about price');
  const c = clock(0);
  const notes = new MeetingNotes({
    ai: fakeAi(new Error('rate limited')),
    transcript,
    intervalMs: 1000,
    now: c.now
  });
  notes.latest = '- earlier notes';
  c.advance(1001);
  await assert.doesNotReject(() => notes.maybeRefresh());
  assert.match(notes.lastError, /rate limited/);
  assert.equal(notes.latest, '- earlier notes', 'the last good notes are not wiped');
});

test('notes: a failed call does not spin into a retry storm and the component still works after', async () => {
  const calls = [];
  let shouldThrow = true;
  const ai = {
    calls,
    async cloudReply(text, context) {
      calls.push({ text, context });
      if (shouldThrow) throw new Error('rate limited');
      return { ok: true, text: '- recovered' };
    }
  };
  const transcript = new MeetingTranscript();
  transcript.append('first thing');
  const c = clock(0);
  const notes = new MeetingNotes({ ai, transcript, intervalMs: 1000, now: c.now });

  c.advance(1001);
  assert.equal(await notes.maybeRefresh(), true, 'guards passed, a refresh was attempted');
  assert.equal(calls.length, 1);
  assert.match(notes.lastError, /rate limited/);

  // Same instant, no new segments. lastRunAt and lastSegmentCount were
  // committed BEFORE the failing await, so a second attempt right now must
  // be blocked by the same guards as any other call — proving a failure
  // cannot spin into a retry storm.
  assert.equal(await notes.maybeRefresh(), false, 'no immediate retry after a failure');
  assert.equal(calls.length, 1, 'the model was not called again');

  // Once real conditions recur (interval elapsed, new segment), the earlier
  // failure must not have wedged the component.
  shouldThrow = false;
  transcript.append('second thing');
  c.advance(1001);
  assert.equal(await notes.maybeRefresh(), true);
  assert.equal(calls.length, 2);
  assert.equal(notes.latest, '- recovered');
  assert.equal(notes.lastError, null);
});

test('notes: prior notes are given to the model so it can build on them', async () => {
  const ai = fakeAi('- updated');
  const transcript = new MeetingTranscript();
  transcript.append('first thing');
  const c = clock(0);
  const notes = new MeetingNotes({ ai, transcript, intervalMs: 1000, now: c.now });
  c.advance(1001);
  await notes.maybeRefresh();
  transcript.append('second thing');
  c.advance(1001);
  await notes.maybeRefresh();
  assert.match(ai.calls[1].text, /- updated/, 'second call sees the first result');
});
