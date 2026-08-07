const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MeetingSession } = require('../core/meeting/meeting-session');
const { MeetingStore } = require('../core/meeting/meeting-store');

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
