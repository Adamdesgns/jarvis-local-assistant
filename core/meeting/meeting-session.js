const { MeetingTranscript } = require('./meeting-transcript');
const { MeetingNotes } = require('./meeting-notes');
const { parseBrief, buildPrepPrompt, buildAnswerSystem } = require('./meeting-brief');

const MAX_ASK_CHARS = 6000;

// System prompt for the fire-and-forget prep sheet request. Kept separate from
// buildPrepPrompt's instructions-plus-brief text so the call can pass
// `systemOverride`: AIService only skips prepending the general chat history
// (ai-service.js:202-204) when a systemOverride is present. Splitting the
// "how to answer" half out as a system prompt, and sending buildPrepPrompt's
// output (the brief plus the ask) as the user text, gets that for free.
const PREP_SHEET_SYSTEM = [
  'You are helping the user prepare for a sales call that is about to start.',
  'You will be given their brief on what they sell and who they are about to talk to.',
  'Reply with exactly the three numbered sections asked for, and nothing else.',
  'Be concrete and use their real pricing where relevant. Do not invent numbers',
  'that are not in the brief.'
].join('\n');

// One meeting, start to finish. Everything it depends on is injected, which is
// what lets the whole chain be tested with a fake microphone and a fake model.
//
// The invariant this class exists to hold: the wake word is suspended for
// exactly as long as the meeting runs, and is restored on every exit path
// including the failure ones.
class MeetingSession {
  constructor({ voice, ai, store, readBrief, onState, intervalMs = 120000, now = Date.now }) {
    this.voice = voice;
    this.ai = ai;
    this.store = store;
    this.readBrief = readBrief;
    this.onState = onState || (() => {});
    this.intervalMs = intervalMs;
    this.now = now;
    this.handle = null;
    this.transcript = null;
    this.notes = null;
    this.brief = null;
    this.warning = '';
    // Latches `handle.lastError` at the moment `stop()` nulls the handle.
    // Without this, the instant the user presses stop the only evidence that
    // the disk was failing disappears with the handle — right when "did this
    // actually save?" is the question that matters most. Do not "simplify"
    // this back to reading `this.handle.lastError` directly.
    this.storeErrorLatch = null;
  }

  get active() { return this.handle !== null; }

  // Two separate error fields, not one merged string. `notesError` means the
  // model is failing — coaching degrades, but the recording is fine and there
  // is nothing on disk to worry about. `storeError` means the disk is failing
  // — the thing the user actually needs to react to, because a transcript
  // that has silently stopped being written is unrecoverable once the call
  // ends. Collapsing these into one field would leave the panel unable to
  // tell "your notes are stale" apart from "you are not recording this call",
  // and the user's response to each is completely different.
  get state() {
    return {
      active: this.active,
      dir: this.handle ? this.handle.dir : '',
      notes: this.notes ? this.notes.latest : '',
      notesError: this.notes ? this.notes.lastError : null,
      // Live handle while a meeting is active; latched value afterwards, so a
      // disk failure survives the `stop()` call that nulls `this.handle`.
      storeError: this.handle ? this.handle.lastError : this.storeErrorLatch,
      segments: this.transcript ? this.transcript.segmentCount : 0,
      warning: this.warning
    };
  }

  #publish() { this.onState(this.state); }

  async start({ briefName, prospect, title }) {
    if (this.active) return;
    this.warning = '';
    // A new meeting starts clean — last meeting's disk failure must not
    // appear to belong to this one.
    this.storeErrorLatch = null;
    this.transcript = new MeetingTranscript();

    // The brief is optional on purpose. Losing the recording because a file was
    // renamed would be a far worse failure than coaching without it.
    let raw = '';
    try {
      raw = this.readBrief(briefName);
    } catch {
      this.warning = 'Brief could not be read — recording without coaching.';
    }
    this.brief = parseBrief(raw);
    if (!this.warning && this.brief.warnings.length) {
      this.warning = this.brief.warnings[0];
    }

    this.handle = this.store.open(new Date(this.now()), title || prospect);
    this.notes = new MeetingNotes({
      ai: this.ai,
      transcript: this.transcript,
      intervalMs: this.intervalMs,
      now: this.now
    });

    this.voice.startMeeting();
    this.#publish();

    // Fire-and-forget: the prep sheet is useful, but waiting on a model round
    // trip before the microphone is live would mean missing the first thing said.
    this.#writePrepSheet(prospect).catch(() => {});
  }

  async #writePrepSheet(prospect) {
    if (!this.brief || !this.brief.ok) return;
    try {
      // Two real AIService flags stand in for the invented `skipHistory`,
      // which AIService never read — it was silently ignored, so both of
      // these leaks were live against the real service:
      //   1. `systemOverride` makes ai-service.js use PREP_SHEET_SYSTEM as the
      //      system prompt and skip prepending `#history(project)`
      //      (ai-service.js:202-204). Without it, whatever the user was
      //      chatting about earlier leaks into the prep-sheet prompt.
      //   2. `untrustedContent: true` is what actually makes `#remember`
      //      skip writing this exchange into the shared history
      //      (ai-service.js:56-64). Without it, the brief and prospect name
      //      get pushed into the general assistant's capped session and
      //      evict the user's real conversation.
      const result = await this.ai.cloudReply(buildPrepPrompt(this.brief, prospect), {
        systemOverride: PREP_SHEET_SYSTEM,
        untrustedContent: true
      });
      if (result && result.text && this.handle) this.handle.writePrepSheet(String(result.text));
    } catch (error) {
      this.warning = `Prep sheet unavailable: ${error.message}`;
      this.#publish();
    }
  }

  handleSegment({ text, dropped }) {
    if (!this.active) return;
    if (this.transcript.append(text)) this.handle.appendSegment(text.trim());
    if (dropped > 0) {
      this.warning = `Transcription is running behind — ${dropped} segment(s) missed.`;
    }
    this.#publish();
    this.notes.maybeRefresh().then((ran) => {
      if (!ran) return;
      if (this.handle && this.notes.latest) this.handle.writeNotes(this.notes.latest);
      this.#publish();
    });
  }

  async ask(question) {
    if (!this.active) return { ok: false, text: 'There is no meeting running.' };
    try {
      // Same two real flags as the prep sheet, for the same reason: this is a
      // live transcript of someone else's speech reaching the model mid-call,
      // so it must not leak into the shared 'general' history (`untrustedContent`)
      // and must not be answered with whatever the user's unrelated chat
      // history was saying five minutes ago (`systemOverride`). Dropping
      // `untrustedContent` here because "systemOverride already stops the
      // history leak" is a mistake — it only stops history from leaking IN,
      // not this exchange from leaking OUT into later requests.
      const result = await this.ai.cloudReply(
        `${question}\n\nWhat has been said so far:\n${this.transcript.recentText(MAX_ASK_CHARS)}`,
        { systemOverride: buildAnswerSystem(this.brief), untrustedContent: true }
      );
      return { ok: result.ok !== false, text: String(result.text || '') };
    } catch (error) {
      return { ok: false, text: `Could not answer: ${error.message}` };
    }
  }

  async stop() {
    if (!this.active) return;
    // Restored first, before anything that can throw. A meeting that ends with
    // the wake word still suspended leaves JARVIS deaf until a restart.
    this.voice.stopMeeting();
    if (this.notes && this.notes.latest && this.handle) {
      try { this.handle.writeNotes(this.notes.latest); } catch { /* already reported via lastError */ }
    }
    // Capture before nulling the handle — otherwise a disk failure mid-meeting
    // vanishes the instant stop() completes, exactly when a UI would want to
    // ask "did this actually save?".
    if (this.handle) this.storeErrorLatch = this.handle.lastError;
    this.handle = null;
    this.#publish();
  }
}

module.exports = { MeetingSession, MAX_ASK_CHARS };
