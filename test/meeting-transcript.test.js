const test = require('node:test');
const assert = require('node:assert/strict');
const { MeetingTranscript } = require('../core/meeting/meeting-transcript');

// The transcript is what every prompt is built from, so the two things worth
// pinning are that nothing said is ever lost, and that a long call cannot grow
// an unbounded prompt. recentText() is the windowing that keeps an hour-long
// meeting from sending 12k tokens on every hotkey press.

test('transcript: keeps every segment in order', () => {
  const t = new MeetingTranscript();
  t.append('first thing');
  t.append('second thing');
  assert.equal(t.segmentCount, 2);
  assert.equal(t.fullText(), 'first thing\nsecond thing');
});

test('transcript: ignores blank and whitespace-only segments', () => {
  const t = new MeetingTranscript();
  t.append('  ');
  t.append('');
  t.append(null);
  assert.equal(t.segmentCount, 0);
  assert.ok(t.isEmpty);
});

test('transcript: trims each segment but keeps internal spacing', () => {
  const t = new MeetingTranscript();
  t.append('  so the price  is  fixed   ');
  assert.equal(t.fullText(), 'so the price  is  fixed');
});

test('transcript: recentText returns the tail, not the head', () => {
  const t = new MeetingTranscript();
  t.append('a'.repeat(50));
  t.append('b'.repeat(50));
  const recent = t.recentText(60);
  assert.ok(recent.endsWith('b'.repeat(50)), 'keeps the most recent words');
  assert.ok(recent.length <= 60);
});

test('transcript: recentText never splits mid-segment', () => {
  const t = new MeetingTranscript();
  t.append('short one');
  t.append('a much longer second segment here');
  // Budget fits only the second segment, so the first is dropped whole.
  const recent = t.recentText(40);
  assert.equal(recent, 'a much longer second segment here');
});

test('transcript: recentText returns the last segment even if it alone exceeds the budget', () => {
  const t = new MeetingTranscript();
  t.append('x'.repeat(200));
  assert.equal(t.recentText(50).length, 200, 'better a long prompt than an empty one');
});
