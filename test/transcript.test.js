const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Transcript, dayKey } = require('../core/transcript');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-transcript-'));
}

// A fixed local wall-clock time, built from local parts so the assertions
// below mean the same thing in any timezone the tests run in.
function at(year, month, day, hour = 12, minute = 0, second = 0) {
  return new Date(year, month - 1, day, hour, minute, second);
}

test('a line lands in a plain-text file named for the local day', () => {
  const root = tempRoot();
  const transcript = new Transcript(root);
  const now = at(2026, 7, 28, 14, 32, 7);

  assert.equal(transcript.append('you', 'what is on my calendar', now), true);

  const file = path.join(root, 'transcripts', '2026-07-28.txt');
  assert.equal(fs.readFileSync(file, 'utf8'), '[14:32:07] YOU: what is on my calendar\n');
});

test('both sides are recorded and labelled', () => {
  const root = tempRoot();
  const transcript = new Transcript(root);
  const now = at(2026, 7, 28, 9, 5, 1);

  transcript.append('you', 'self destruct', now);
  transcript.append('jarvis', 'Self-destruct sequence initiated. Stand by.', now);

  const body = fs.readFileSync(transcript.fileFor(now), 'utf8');
  assert.match(body, /YOU: self destruct/);
  assert.match(body, /JARVIS: Self-destruct sequence initiated\./);
});

test('an unknown speaker is recorded as the user, never silently dropped', () => {
  const root = tempRoot();
  const transcript = new Transcript(root);
  const now = at(2026, 7, 28);

  transcript.append(undefined, 'a line from somewhere', now);

  assert.match(fs.readFileSync(transcript.fileFor(now), 'utf8'), /YOU: a line from somewhere/);
});

test('empty and whitespace-only lines are not recorded', () => {
  const root = tempRoot();
  const transcript = new Transcript(root);
  const now = at(2026, 7, 28);

  assert.equal(transcript.append('jarvis', '', now), false);
  assert.equal(transcript.append('jarvis', '   \n\t ', now), false);
  assert.equal(transcript.append('jarvis', null, now), false);
  assert.equal(transcript.append('jarvis', undefined, now), false);
  assert.equal(fs.existsSync(transcript.fileFor(now)), false);
});

test('newlines are flattened so one exchange is always one line', () => {
  // Multi-line replies are ordinary (lists, code). If they kept their breaks
  // the file would stop being scannable by eye, which is its only job.
  const root = tempRoot();
  const transcript = new Transcript(root);
  const now = at(2026, 7, 28, 8, 0, 0);

  transcript.append('jarvis', 'first line\nsecond line\n\nthird', now);

  const body = fs.readFileSync(transcript.fileFor(now), 'utf8');
  assert.equal(body, '[08:00:00] JARVIS: first line second line third\n');
  assert.equal(body.split('\n').filter(Boolean).length, 1);
});

test('yesterday survives, but anything older is pruned on the next append', () => {
  // The window Adam asked for is 24-48 hours: today plus yesterday.
  const root = tempRoot();
  const transcript = new Transcript(root);
  const dir = path.join(root, 'transcripts');
  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(path.join(dir, '2026-07-27.txt'), 'yesterday\n');
  fs.writeFileSync(path.join(dir, '2026-07-26.txt'), 'two days ago\n');
  fs.writeFileSync(path.join(dir, '2026-07-20.txt'), 'last week\n');

  transcript.append('you', 'hello', at(2026, 7, 28, 10, 0, 0));

  assert.equal(fs.existsSync(path.join(dir, '2026-07-28.txt')), true, 'today');
  assert.equal(fs.existsSync(path.join(dir, '2026-07-27.txt')), true, 'yesterday stays');
  assert.equal(fs.existsSync(path.join(dir, '2026-07-26.txt')), false, 'older goes');
  assert.equal(fs.existsSync(path.join(dir, '2026-07-20.txt')), false, 'older goes');
});

test('pruning only ever deletes files it could have written itself', () => {
  const root = tempRoot();
  const transcript = new Transcript(root);
  const dir = path.join(root, 'transcripts');
  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(path.join(dir, 'notes.txt'), 'something of his');
  fs.writeFileSync(path.join(dir, 'README.md'), 'not ours');
  fs.writeFileSync(path.join(dir, '2026-07-01.txt'), 'ours, and old');

  const removed = transcript.prune(at(2026, 7, 28));

  assert.equal(removed, 1);
  assert.equal(fs.existsSync(path.join(dir, 'notes.txt')), true);
  assert.equal(fs.existsSync(path.join(dir, 'README.md')), true);
  assert.equal(fs.existsSync(path.join(dir, '2026-07-01.txt')), false);
});

test('read returns the window oldest-first, with a day heading', () => {
  const root = tempRoot();
  const transcript = new Transcript(root);

  transcript.append('you', 'yesterday question', at(2026, 7, 27, 16, 0, 0));
  transcript.append('jarvis', 'yesterday answer', at(2026, 7, 27, 16, 0, 2));
  transcript.append('you', 'today question', at(2026, 7, 28, 9, 0, 0));

  const text = transcript.read(at(2026, 7, 28, 10, 0, 0));

  assert.match(text, /--- 2026-07-27 ---/);
  assert.match(text, /--- 2026-07-28 ---/);
  assert.ok(
    text.indexOf('2026-07-27') < text.indexOf('2026-07-28'),
    'oldest day first, so it reads in the order it happened'
  );
  assert.match(text, /YOU: yesterday question/);
  assert.match(text, /JARVIS: yesterday answer/);
});

test('read is empty, not an error, before anything has been said', () => {
  const transcript = new Transcript(tempRoot());
  assert.equal(transcript.read(at(2026, 7, 28)), '');
});

test('a write that cannot happen returns false instead of throwing', () => {
  // The directory path is occupied by a FILE, so mkdir/append must fail.
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'transcripts'), 'in the way');
  const transcript = new Transcript(root);

  assert.equal(transcript.append('jarvis', 'this cannot be written', at(2026, 7, 28)), false);
  assert.equal(transcript.prune(at(2026, 7, 28)), 0);
  assert.equal(transcript.read(at(2026, 7, 28)), '');
});

test('the day key follows local time, not UTC', () => {
  // 7pm Central on the 28th is already the 29th in UTC. An ISO slice would
  // put an evening conversation in tomorrow's file.
  const evening = at(2026, 7, 28, 19, 30, 0);
  assert.equal(dayKey(evening), '2026-07-28');
});

test('the window walks calendar days, so a 23-hour DST day still keeps two', () => {
  const root = tempRoot();
  const transcript = new Transcript(root);
  const dir = path.join(root, 'transcripts');
  fs.mkdirSync(dir, { recursive: true });

  // US spring-forward 2026: March 8 is 23 hours long.
  fs.writeFileSync(path.join(dir, '2026-03-07.txt'), 'the day before the change\n');
  transcript.append('you', 'after the change', at(2026, 3, 8, 12, 0, 0));

  assert.equal(fs.existsSync(path.join(dir, '2026-03-07.txt')), true);
  assert.equal(fs.existsSync(path.join(dir, '2026-03-08.txt')), true);
});
