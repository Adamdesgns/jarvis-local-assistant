const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MeetingStore, CONSENT_LINE } = require('../core/meeting/meeting-store');

// Two promises are being kept here. The transcript is appended segment by
// segment as the call runs, so a crash costs the last sentence rather than the
// meeting — the test asserts the file is on disk mid-call, not just at stop.
// And every notes file opens with the consent line, because this records
// another person's speech and that fact should survive being emailed on.

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-meeting-'));
}

test('store: transcript is on disk after each segment, not at the end', () => {
  const root = tmpRoot();
  const m = new MeetingStore({ root }).open(new Date('2026-08-07T14:30:00'), 'Dave call');
  m.appendSegment('first sentence');
  const onDisk = fs.readFileSync(path.join(m.dir, 'transcript.txt'), 'utf8');
  assert.match(onDisk, /first sentence/, 'written before the meeting ended');
  m.appendSegment('second sentence');
  const after = fs.readFileSync(path.join(m.dir, 'transcript.txt'), 'utf8');
  assert.match(after, /first sentence[\s\S]*second sentence/, 'appends, never overwrites');
});

test('store: notes file opens with the consent line', () => {
  const root = tmpRoot();
  const m = new MeetingStore({ root }).open(new Date('2026-08-07T14:30:00'), 'Dave call');
  m.writeNotes('- talked about price');
  const notes = fs.readFileSync(path.join(m.dir, 'notes.md'), 'utf8');
  assert.ok(notes.startsWith(CONSENT_LINE), 'consent first, before any content');
  assert.match(notes, /talked about price/);
});

test('store: notes are replaced on rewrite, not appended', () => {
  const root = tmpRoot();
  const m = new MeetingStore({ root }).open(new Date('2026-08-07T14:30:00'), 'Dave call');
  m.writeNotes('- first pass');
  m.writeNotes('- second pass');
  const notes = fs.readFileSync(path.join(m.dir, 'notes.md'), 'utf8');
  assert.doesNotMatch(notes, /first pass/, 'the rolling summary supersedes itself');
  assert.match(notes, /second pass/);
});

test('store: folder name is sortable and carries the title', () => {
  const root = tmpRoot();
  const m = new MeetingStore({ root }).open(new Date('2026-08-07T14:30:00'), 'Dave at Lucedale Auto');
  assert.match(path.basename(m.dir), /^2026-08-07-1430-dave-at-lucedale-auto$/);
});

test('store: a title with path separators cannot escape the root', () => {
  const root = tmpRoot();
  const m = new MeetingStore({ root }).open(new Date('2026-08-07T14:30:00'), '../../etc/passwd');
  assert.ok(m.dir.startsWith(root), 'stays inside the meetings folder');
});

test('store: an untitled meeting still gets a folder', () => {
  const root = tmpRoot();
  const m = new MeetingStore({ root }).open(new Date('2026-08-07T14:30:00'), '');
  assert.match(path.basename(m.dir), /^2026-08-07-1430-meeting$/);
});

// The governing rule for this feature is that nothing takes down the
// meeting: a write failure here must not throw out of appendSegment and
// through the session that calls it. It also must not vanish silently — the
// user has to be told the transcript stopped being written. Removing the
// meeting directory after open() gives a genuinely missing path, so the
// append hits a real ENOENT rather than a mocked one.
test('store: appendSegment does not throw when the write fails, and the failure is visible', () => {
  const root = tmpRoot();
  const m = new MeetingStore({ root }).open(new Date('2026-08-07T14:30:00'), 'Dave call');
  fs.rmSync(m.dir, { recursive: true, force: true });
  assert.doesNotThrow(() => m.appendSegment('lost sentence'), 'a disk error must not end the meeting');
  assert.equal(typeof m.lastError, 'string', 'the caller can see the write failed');
  assert.ok(m.lastError.length > 0);
});

test('store: a healthy write leaves no error recorded', () => {
  const root = tmpRoot();
  const m = new MeetingStore({ root }).open(new Date('2026-08-07T14:30:00'), 'Dave call');
  m.appendSegment('all is well');
  assert.equal(m.lastError, null, 'nothing failed, so nothing should be recorded');
});
