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
