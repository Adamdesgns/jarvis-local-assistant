const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MeetingSession } = require('../core/meeting/meeting-session');
const { MeetingStore, CONSENT_LINE } = require('../core/meeting/meeting-store');

// The whole chain, exercised with a fake microphone and a fake model. The
// wake-word tests are the ones that matter most: a regression there means
// JARVIS answers out loud in front of a client, which is the single most
// embarrassing failure this feature can have.

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-session-'));
}

function fakeVoice() {
  return {
    started: 0,
    stopped: 0,
    startMeeting() { this.started += 1; },
    stopMeeting() { this.stopped += 1; }
  };
}

function fakeAi(reply = 'ok') {
  return {
    calls: [],
    async cloudReply(text, context) {
      this.calls.push({ text, context });
      return { ok: true, text: reply };
    }
  };
}

function session(overrides = {}) {
  const root = tmpRoot();
  return new MeetingSession({
    voice: fakeVoice(),
    ai: fakeAi(),
    store: new MeetingStore({ root }),
    readBrief: () => '# Business\nI sell voice assistants.\n# Pricing\n$2,500',
    onState: () => {},
    now: () => 0,
    ...overrides
  });
}

test('session: starting suspends the wake word, stopping restores it', async () => {
  const voice = fakeVoice();
  const s = session({ voice });
  await s.start({ briefName: 'default', prospect: 'Dave', title: 'Dave call' });
  assert.equal(voice.started, 1, 'told the voice service to enter meeting mode');
  assert.ok(s.active);
  await s.stop();
  assert.equal(voice.stopped, 1, 'wake word restored on stop');
  assert.equal(s.active, false);
});

test('session: segments reach both the transcript and the disk', async () => {
  const s = session();
  await s.start({ briefName: 'default', prospect: 'Dave', title: 'Dave call' });
  s.handleSegment({ text: 'he asked about price', dropped: 0 });
  const onDisk = fs.readFileSync(path.join(s.state.dir, 'transcript.txt'), 'utf8');
  assert.match(onDisk, /he asked about price/);
});

test('session: a dropped segment raises a warning the panel can show', async () => {
  const s = session();
  await s.start({ briefName: 'default', prospect: 'Dave', title: 'Dave call' });
  s.handleSegment({ text: 'something', dropped: 3 });
  assert.match(s.state.warning, /behind/i);
});

test('session: segments arriving before start are ignored, not crashed on', () => {
  const s = session();
  assert.doesNotThrow(() => s.handleSegment({ text: 'stray', dropped: 0 }));
  assert.equal(s.active, false);
});

test('session: segments arriving after stop are ignored, not crashed on', async () => {
  const s = session();
  await s.start({ briefName: 'default', prospect: 'Dave', title: 'Dave call' });
  await s.stop();
  assert.doesNotThrow(() => s.handleSegment({ text: 'stray', dropped: 0 }));
  assert.equal(s.active, false);
});

test('session: ask sends the brief and the transcript', async () => {
  const ai = fakeAi('say this');
  const s = session({ ai });
  await s.start({ briefName: 'default', prospect: 'Dave', title: 'Dave call' });
  s.handleSegment({ text: 'he says it is too expensive', dropped: 0 });
  const answer = await s.ask('what do I say?');
  assert.equal(answer.text, 'say this');
  const last = ai.calls[ai.calls.length - 1];
  assert.match(last.text, /too expensive/, 'transcript reached the model');
  assert.match(last.context.systemOverride, /\$2,500/, 'brief reached the model');
});

test('session: ask before a meeting starts explains itself instead of throwing', async () => {
  const s = session();
  const answer = await s.ask('anything?');
  assert.equal(answer.ok, false);
  assert.match(answer.text, /no meeting/i);
});

test('session: a missing brief still starts the meeting as a scribe', async () => {
  const s = session({ readBrief: () => { throw new Error('ENOENT'); } });
  await s.start({ briefName: 'gone', prospect: 'Dave', title: 'Dave call' });
  assert.ok(s.active, 'recording matters more than coaching');
  assert.match(s.state.warning, /brief/i);
});

test('session: the wake word is restored even if writing the prep sheet failed', async () => {
  const voice = fakeVoice();
  const s = session({
    voice,
    ai: { async cloudReply() { throw new Error('no key'); } }
  });
  await s.start({ briefName: 'default', prospect: 'Dave', title: 'Dave call' });
  assert.ok(s.active, 'a failed prep sheet must not stop the meeting');
  await s.stop();
  assert.equal(voice.stopped, 1);
});

// --- Correction 1: skipHistory does not exist; the real flags must be used ---
// so meeting content never leaks into the shared 'general' history and
// unrelated chat never leaks into the meeting prompt.

test('session: ask marks the transcript as untrusted content and overrides the system prompt', async () => {
  const ai = fakeAi('answer');
  const s = session({ ai });
  await s.start({ briefName: 'default', prospect: 'Dave', title: 'Dave call' });
  await s.ask('what now?');
  const last = ai.calls[ai.calls.length - 1];
  assert.equal(last.context.untrustedContent, true, 'ask must not leak into general chat history');
  assert.equal(typeof last.context.systemOverride, 'string');
  assert.equal(last.context.skipHistory, undefined, 'skipHistory does not exist on AIService and must not be relied on');
});

test('session: the prep sheet call also marks untrusted content and carries a systemOverride', async () => {
  const ai = fakeAi('prep');
  const s = session({ ai });
  await s.start({ briefName: 'default', prospect: 'Dave', title: 'Dave call' });
  // start() fires the prep sheet request fire-and-forget; give it a tick.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ai.calls.length, 1);
  const call = ai.calls[0];
  assert.equal(call.context.untrustedContent, true, 'prep sheet must not leak into general chat history');
  assert.equal(typeof call.context.systemOverride, 'string', 'prep sheet needs its own system prompt so unrelated chat history is skipped');
  assert.equal(call.context.skipHistory, undefined, 'skipHistory does not exist on AIService and must not be relied on');
});

// --- Correction 2: store write failures must be surfaced, distinctly from ---
// notes/model failures, so the panel can tell "the model is failing" apart
// from "the disk is failing".

test('session: a failing store surfaces a distinct storeError, separate from the notes error', async () => {
  const root = tmpRoot();
  const store = new MeetingStore({ root });
  const s = session({ store });
  await s.start({ briefName: 'default', prospect: 'Dave', title: 'Dave call' });
  // Break the transcript write path by removing the directory the handle
  // points at, then force a write and confirm the handle reports lastError.
  fs.rmSync(s.state.dir, { recursive: true, force: true });
  s.handleSegment({ text: 'this will fail to write', dropped: 0 });
  assert.ok(s.state.storeError, 'the disk failure must be visible in state');
  assert.equal(s.state.notesError, null, 'a disk failure must not be reported as a model/notes failure');
});

test('session: state exposes notesError and storeError as independent fields when both are healthy', async () => {
  const s = session();
  await s.start({ briefName: 'default', prospect: 'Dave', title: 'Dave call' });
  assert.equal(s.state.notesError, null);
  assert.equal(s.state.storeError, null);
});

// --- Correction 3: storeError must survive stop(), which nulls the handle ---
// it reads from. Otherwise the one question a post-meeting UI most needs to
// answer — "did this recording actually save?" — becomes unanswerable the
// instant the user presses stop.

test('session: storeError survives stop(), so a disk failure is still visible after the meeting ends', async () => {
  const root = tmpRoot();
  const store = new MeetingStore({ root });
  const s = session({ store });
  await s.start({ briefName: 'default', prospect: 'Dave', title: 'Dave call' });
  fs.rmSync(s.state.dir, { recursive: true, force: true });
  s.handleSegment({ text: 'this will fail to write', dropped: 0 });
  assert.ok(s.state.storeError, 'sanity check: the failure is visible while the meeting is still active');
  await s.stop();
  assert.equal(s.active, false);
  assert.ok(s.state.storeError, 'the disk failure must still be visible after stop() nulls the handle');
});

test('session: starting a new meeting clears the previous meeting\'s storeError', async () => {
  const root = tmpRoot();
  const store = new MeetingStore({ root });
  const s = session({ store });
  await s.start({ briefName: 'default', prospect: 'Dave', title: 'Dave call' });
  fs.rmSync(s.state.dir, { recursive: true, force: true });
  s.handleSegment({ text: 'this will fail to write', dropped: 0 });
  await s.stop();
  assert.ok(s.state.storeError, 'sanity check: the latch is holding the failure from the first meeting');

  await s.start({ briefName: 'default', prospect: 'Dave', title: 'Second call' });
  assert.equal(s.state.storeError, null, 'a new meeting must not inherit the previous one\'s disk failure');
});

test('session: a healthy meeting reports no storeError before or after stop()', async () => {
  const s = session();
  await s.start({ briefName: 'default', prospect: 'Dave', title: 'Dave call' });
  s.handleSegment({ text: 'all good', dropped: 0 });
  assert.equal(s.state.storeError, null, 'no storeError while active and writes are succeeding');
  await s.stop();
  assert.equal(s.state.storeError, null, 'no storeError after a clean stop()');
});

// --- Whole-branch review, Finding 1: local-voice-service.js:169 throws
// 'Local voice is not running.' whenever Python isn't writable — the normal
// state when Python isn't installed, the spawn watchdog gave up, or the
// process died mid-call. Both calls into it were unguarded, so a throw from
// either one used to wedge the session permanently: start() left `active`
// true with Python never told to enter meeting mode, and stop() threw again
// before ever nulling the handle, so there was no way back short of
// restarting the app. These two tests are the fix's contract: start() must
// roll back and rethrow, and stop() must always finish tearing down.

test('session: a failing startMeeting rolls back cleanly and leaves the session restartable', async () => {
  const brokenVoice = {
    startMeeting() { throw new Error('Local voice is not running.'); },
    stopMeeting() {}
  };
  const s = session({ voice: brokenVoice });
  await assert.rejects(
    () => s.start({ briefName: 'default', prospect: 'Dave', title: 'Dave call' }),
    /Local voice is not running/,
    'the caller (meeting:start\'s IPC handler) needs the failure, not a silent no-op'
  );
  assert.equal(s.active, false, 'a failed start must not wedge the session as active');
  assert.equal(s.handle, null, 'the handle must be released, not left dangling');

  // Recover without restarting the app: swap in a working voice service (the
  // real-world equivalent of Python getting installed or the watchdog
  // succeeding on retry) and confirm start() is not permanently stuck
  // bailing out at its "already active" guard.
  const workingVoice = fakeVoice();
  s.voice = workingVoice;
  await s.start({ briefName: 'default', prospect: 'Dave', title: 'Dave call' });
  assert.ok(s.active, 'a subsequent start with a working voice must succeed');
  assert.equal(workingVoice.started, 1);
});

test('session: a failing stopMeeting still lets stop() complete teardown, including the final notes write', async () => {
  const voice = fakeVoice();
  const s = session({ voice });
  await s.start({ briefName: 'default', prospect: 'Dave', title: 'Dave call' });
  s.handleSegment({ text: 'said something', dropped: 0 });
  const dir = s.state.dir;
  // This suite's fixed `now: () => 0` clock means a real notes refresh never
  // fires (see the dedicated refresh test below), so setting `latest`
  // directly is the direct way to put stop() in the state it needs to be in
  // to exercise its final-write branch.
  s.notes.latest = 'COVERED: pricing discussion';

  voice.stopMeeting = () => { throw new Error('Local voice is not running.'); };
  await s.stop();

  assert.equal(s.active, false, 'the handle must still be released even though stopMeeting threw');
  assert.equal(s.handle, null);
  assert.match(s.state.warning, /stopped/i, 'the failure is surfaced, not swallowed');
  const onDisk = fs.readFileSync(path.join(dir, 'notes.md'), 'utf8');
  assert.ok(onDisk.startsWith(CONSENT_LINE), 'the final notes write still ran, consent line first');
  assert.match(onDisk, /pricing discussion/);
});

// --- Whole-branch review: every test above pins `now: () => 0`, which makes
// MeetingNotes.maybeRefresh()'s interval check (`now() - lastRunAt <
// intervalMs`) permanently true, so a refresh never actually runs anywhere
// in this suite. That left handleSegment's writeNotes-on-refresh call, and
// therefore stop()'s final writeNotes guard too (`this.notes.latest` never
// became truthy), never exercised by real refresh timing. This test
// advances an injected clock past the interval so both paths genuinely run.

test('session: notes refresh writes to disk mid-call, and stop() writes the final notes', async () => {
  let clock = 0;
  const ai = fakeAi('COVERED: pricing discussion');
  // readBrief returns '' so the brief is not "ok" and the fire-and-forget
  // prep sheet call is skipped — keeps this test's single ai call
  // unambiguously the notes refresh, not the prep sheet.
  const s = session({ ai, now: () => clock, intervalMs: 1000, readBrief: () => '' });
  await s.start({ briefName: 'default', prospect: 'Dave', title: 'Dave call' });
  const notesPath = path.join(s.state.dir, 'notes.md');

  s.handleSegment({ text: 'first segment', dropped: 0 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(!fs.existsSync(notesPath), 'sanity check: interval has not elapsed, no refresh yet');

  clock = 1000;
  s.handleSegment({ text: 'second segment', dropped: 0 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ai.calls.length, 1, 'the interval elapsed, so maybeRefresh actually called the model');
  assert.ok(fs.existsSync(notesPath), 'the refresh wrote notes.md mid-call, not just at stop()');
  const midCall = fs.readFileSync(notesPath, 'utf8');
  assert.ok(midCall.startsWith(CONSENT_LINE), 'consent line first, before any content');
  assert.match(midCall, /pricing discussion/);

  // Prove stop() performs its own write rather than the file merely
  // surviving from the refresh above: delete it, then confirm stop()
  // recreates it.
  fs.unlinkSync(notesPath);
  await s.stop();
  assert.ok(fs.existsSync(notesPath), 'stop() wrote the final notes even though nothing else would have');
  const final = fs.readFileSync(notesPath, 'utf8');
  assert.ok(final.startsWith(CONSENT_LINE), 'consent line first in the final notes too');
});
