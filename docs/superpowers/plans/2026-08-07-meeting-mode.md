# Meeting Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** JARVIS listens to a live meeting, keeps the transcript and rolling notes on disk, and answers a typed question on a global hotkey using a brief Adam wrote.

**Architecture:** The Python voice service already runs a Silero-VAD segmenter; it gains a second mode that emits every speech segment instead of matching a wake word. All logic above that lives in JavaScript where the test suite is — a transcript buffer, a brief parser, a disk store, a debounced notes generator, and a session that wires them together. The renderer gets an always-on-top panel.

**Tech Stack:** Electron, Node 20 (`node --test` + `node:assert/strict`), Python 3 (faster-whisper, Silero VAD via openwakeword), Anthropic via the existing `AIService`.

**Spec:** `docs/superpowers/specs/2026-08-07-meeting-mode-design.md`

## Global Constraints

- **Tests run with `npm test`** (`node --test`). Test files live in `test/*.test.js`, use `require('node:test')` and `require('node:assert/strict')`, and open with a comment saying *why* the test exists. Follow `test/camera-window-bounds.test.js` as the house style.
- **`node:test` is the only test runner.** Do not add Jest, Mocha, or a Python test runner.
- **Never lose audio silently.** The existing wake segmenter drops a segment when a transcription is already running (`local_voice.py:322`, `_wake_pass_busy`). That is correct for a wake word and wrong for a meeting. Meeting mode counts drops and reports them; it never discards silently.
- **Meeting mode suspends the wake word.** One microphone, one audio queue. Ending a meeting restores the previous wake state.
- **stdout is the JSON protocol** in `local_voice.py`. Diagnostics go to stderr via `log()`. Never `print()` to stdout.
- **Every notes file opens with the consent line** — exact text in Task 4.
- **No transcript content in stderr logs.** The existing wake path only logs transcripts behind `JARVIS_WAKE_DEBUG=1`; meeting mode logs counts, never text.
- **The hotkey is `Ctrl+Shift+J`**, overridable in settings. The rolling summary interval defaults to **120000 ms**, overridable in settings.

---

## File Structure

**Created:**
- `core/meeting/meeting-transcript.js` — accumulates segments, windows text for prompts
- `core/meeting/meeting-brief.js` — parses the brief, builds the prep-sheet prompt
- `core/meeting/meeting-store.js` — writes prep sheet, transcript, notes to disk
- `core/meeting/meeting-notes.js` — debounced rolling summary via `AIService`
- `core/meeting/meeting-session.js` — orchestrates the above; owns wake suspend/restore
- `src/meeting-window.html`, `src/meeting-window.js` — the always-on-top panel
- `test/meeting-transcript.test.js`, `test/meeting-brief.test.js`, `test/meeting-store.test.js`, `test/meeting-notes.test.js`, `test/meeting-session.test.js`

**Modified:**
- `scripts/local_voice.py` — mode flag, meeting segmenter, `meeting-start` / `meeting-stop` commands
- `core/local-voice-service.js` — `meeting:segment` event, `startMeeting()` / `stopMeeting()`
- `main.js` — panel window, IPC handlers, global shortcut
- `core/defaults.js` — new settings keys
- `src/settings-tabs.js` — MEETINGS tab

---

### Task 1: Python meeting mode

**Files:**
- Modify: `scripts/local_voice.py:129-145` (constructor), `:265-330` (segmenter), `:357-384` (run loop)

**Interfaces:**
- Consumes: nothing (first task)
- Produces: stdin commands `{"type":"meeting-start"}` and `{"type":"meeting-stop"}`; stdout event `{"type":"meeting-segment","text":str,"dropped":int}` where `dropped` is the cumulative count of segments skipped because a transcription pass was still running.

> **This is the one task with no automated test.** The repo has no Python test runner and `npm test` is `node --test`; adding an unrunnable Python suite is worse than an honest manual gate. Verification is a real smoke run against the real model, with exact expected output below. Everything above this layer is unit-tested in Tasks 2–6.

- [ ] **Step 1: Add the mode flag to the constructor**

In `VoiceService.__init__`, after `self._wake_pass_busy = False` (line 142), add:

```python
        # 'wake' or 'meeting'. One audio queue feeds one consumer: if both the
        # wake loop and the meeting loop called audio_queue.get(), each frame
        # would land in only one of them and both would hear half a room. Every
        # loop therefore checks this BEFORE consuming.
        self.mode = "wake"
        self._meeting_pass_busy = False
        self._meeting_dropped = 0
```

- [ ] **Step 2: Gate the existing wake loops so they stop consuming in meeting mode**

In `transcribe_wake_loop`, immediately inside `while self.running:` and **before** the `self.audio_queue.get(...)` call (line 287), insert:

```python
            if self.mode != "wake":
                time.sleep(0.05)
                continue
```

Apply the identical guard in `wake_loop` before its own `audio_queue.get()` (line 195).

- [ ] **Step 3: Add the meeting segmenter**

Add this method to `VoiceService`, directly after `transcribe_wake_loop`:

```python
    def meeting_loop(self) -> None:
        """Same VAD segmentation as the wake loop, but every segment is
        transcribed and emitted rather than matched against a name.

        Difference that matters: the wake loop DROPS a segment when a pass is
        already running, because a missed wake word gets said again. A missed
        sentence in a meeting is gone. We still refuse to queue passes (a
        backlog is how a noisy room becomes a hot CPU), but we count every drop
        and ship the count so the app can tell the user it is falling behind.
        """
        PRE_ROLL = 8
        END_SILENCE = 9
        MAX_BLOCKS = 50
        MIN_SPEECH = 5
        VAD_THRESHOLD = 0.5

        pre_roll: deque = deque(maxlen=PRE_ROLL)
        capturing: list = []
        speech_blocks = 0
        silent_blocks = 0

        while self.running:
            if self.mode != "meeting":
                time.sleep(0.05)
                continue
            try:
                frame = self.audio_queue.get(timeout=0.25)
            except queue.Empty:
                continue
            if self.vad is None:
                continue
            try:
                speech = float(self.vad.predict(frame, frame_size=640)) >= VAD_THRESHOLD
            except Exception as exc:
                log(f"VAD error: {exc}")
                continue

            if not capturing:
                pre_roll.append(frame)
                if speech:
                    capturing = list(pre_roll)
                    speech_blocks = 1
                    silent_blocks = 0
                continue

            capturing.append(frame)
            if speech:
                speech_blocks += 1
                silent_blocks = 0
            else:
                silent_blocks += 1

            if silent_blocks >= END_SILENCE or len(capturing) >= MAX_BLOCKS:
                segment = capturing
                capturing = []
                pre_roll.clear()
                try:
                    self.vad.reset_states()
                except Exception:
                    pass
                if speech_blocks >= MIN_SPEECH:
                    if self._meeting_pass_busy:
                        self._meeting_dropped += 1
                        log(f"meeting: transcription behind, dropped {self._meeting_dropped}")
                    else:
                        self._meeting_pass_busy = True
                        threading.Thread(
                            target=self._run_meeting_pass, args=(segment,), daemon=True
                        ).start()
                speech_blocks = 0
                silent_blocks = 0

    def _run_meeting_pass(self, blocks) -> None:
        import numpy as np

        try:
            audio = np.concatenate(blocks).astype(np.float32) / 32768.0
            model = self.get_wake_whisper()
            segments, _info = model.transcribe(
                audio,
                beam_size=1,
                language="en",
                vad_filter=False,
                condition_on_previous_text=False,
                without_timestamps=True,
            )
            text = " ".join(segment.text.strip() for segment in segments).strip()
            if text:
                # Counts only in the log — never the transcript. An always-on
                # log of everything said in the room is not the privacy posture.
                emit("meeting-segment", text=text, dropped=self._meeting_dropped)
        except Exception as exc:
            log(f"Meeting transcription error: {exc}")
        finally:
            self._meeting_pass_busy = False
```

- [ ] **Step 4: Start the meeting thread and handle the new commands**

In `run()`, after the wake-thread block (line 363) and before `for line in sys.stdin:`, add:

```python
        threading.Thread(target=self.meeting_loop, daemon=True).start()
```

Then inside the stdin loop, after the `transcribe` branch (line 379), add:

```python
            if command.get("type") == "meeting-start":
                self.mode = "meeting"
                self._meeting_dropped = 0
                # Frames captured while the wake loop owned the queue are stale
                # by the time the mode flips; starting clean beats transcribing
                # the tail of whatever was said before the meeting began.
                while True:
                    try:
                        self.audio_queue.get_nowait()
                    except queue.Empty:
                        break
                emit("meeting-started")
            if command.get("type") == "meeting-stop":
                self.mode = "wake"
                emit("meeting-stopped", dropped=self._meeting_dropped)
```

- [ ] **Step 5: Smoke test against the real model**

Run from the repo root:

```bash
python scripts/local_voice.py --diagnose
```

Expected: JSON on stdout reporting `ok` true for the transcribe path (Silero VAD present, a whisper model cached). If it reports missing models, run `python scripts/local_voice.py --prepare` first.

Then start the service and drive it by hand:

```bash
python scripts/local_voice.py --service
```

Paste this line into stdin and press Enter:

```
{"type":"meeting-start"}
```

Expected on stdout: `{"type": "meeting-started"}`. Now speak two or three sentences aloud. Expected: one `meeting-segment` line per sentence, e.g.

```
{"type": "meeting-segment", "text": "this is a test of meeting mode", "dropped": 0}
```

Then paste:

```
{"type":"meeting-stop"}
```

Expected: `{"type": "meeting-stopped", "dropped": 0}`, and speaking further produces no more segments.

**Confirm the wake word still works:** with the service still running, say "Hey JARVIS". Expected: a `wake` event. If no wake event fires after `meeting-stop`, the mode guard in Step 2 is wrong — check that the guard `continue`s rather than `break`s.

- [ ] **Step 6: Commit**

```bash
git add scripts/local_voice.py
git commit -m "feat(meeting): add meeting mode to the local voice service"
```

---

### Task 2: Transcript buffer

**Files:**
- Create: `core/meeting/meeting-transcript.js`
- Test: `test/meeting-transcript.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `class MeetingTranscript` with `append(text)`, `fullText()`, `recentText(maxChars)`, `segmentCount` (getter, number), `isEmpty` (getter, boolean).

- [ ] **Step 1: Write the failing test**

Create `test/meeting-transcript.test.js`:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx node --test test/meeting-transcript.test.js`
Expected: FAIL — `Cannot find module '../core/meeting/meeting-transcript'`

- [ ] **Step 3: Write minimal implementation**

Create `core/meeting/meeting-transcript.js`:

```javascript
// The running record of one meeting, in memory. Deliberately not a store: this
// holds text and hands out windows of it. Writing to disk is meeting-store's
// job, and keeping the two apart is what lets every prompt-shaping decision
// here be unit-tested without touching the filesystem.
class MeetingTranscript {
  constructor() {
    this.segments = [];
  }

  get segmentCount() { return this.segments.length; }

  get isEmpty() { return this.segments.length === 0; }

  // Blank segments happen: whisper returns '' for a cough that cleared the VAD
  // gate. Storing them would pad the prompt with empty lines for no reason.
  append(text) {
    const clean = typeof text === 'string' ? text.trim() : '';
    if (!clean) return false;
    this.segments.push(clean);
    return true;
  }

  fullText() { return this.segments.join('\n'); }

  // The tail of the conversation, under maxChars, cut on segment boundaries so
  // a prompt never opens mid-sentence. If the newest segment alone busts the
  // budget it is still returned whole — an over-long prompt is recoverable, an
  // empty one silently answers from nothing.
  recentText(maxChars) {
    if (this.segments.length === 0) return '';
    const kept = [];
    let used = 0;
    for (let i = this.segments.length - 1; i >= 0; i -= 1) {
      const seg = this.segments[i];
      const cost = seg.length + (kept.length ? 1 : 0);
      if (used + cost > maxChars && kept.length) break;
      kept.unshift(seg);
      used += cost;
    }
    return kept.join('\n');
  }
}

module.exports = { MeetingTranscript };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx node --test test/meeting-transcript.test.js`
Expected: PASS — 6 tests, 0 failures

- [ ] **Step 5: Commit**

```bash
git add core/meeting/meeting-transcript.js test/meeting-transcript.test.js
git commit -m "feat(meeting): add transcript buffer with segment-boundary windowing"
```

---

### Task 3: Brief parsing and the prep sheet

**Files:**
- Create: `core/meeting/meeting-brief.js`
- Test: `test/meeting-brief.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `parseBrief(raw)` → `{ ok: boolean, sections: object, warnings: string[] }` where `sections` maps a lowercased heading to its body text; `buildPrepPrompt(brief, prospect)` → string; `buildAnswerSystem(brief)` → string.

- [ ] **Step 1: Write the failing test**

Create `test/meeting-brief.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseBrief, buildPrepPrompt, buildAnswerSystem } = require('../core/meeting/meeting-brief');

// The brief is the whole reason this coaching beats a generic chatbot, and it
// is a file Adam maintains by hand — so it will be half-finished, mis-headed,
// or empty at some point. None of those may throw: meeting mode still has to
// start and record. The warnings exist so the panel can say what is missing
// instead of quietly giving generic advice.

const GOOD = `# Business
I build custom JARVIS voice assistants for small businesses.

# Pricing
Setup from $2,500. Monthly support $200.

# Objections
"Too expensive" - point at the labour it replaces.
"We already have Alexa" - Alexa is not local and not private.
`;

test('brief: pulls each heading into a section', () => {
  const brief = parseBrief(GOOD);
  assert.ok(brief.ok);
  assert.match(brief.sections.business, /custom JARVIS voice assistants/);
  assert.match(brief.sections.pricing, /\$2,500/);
  assert.match(brief.sections.objections, /already have Alexa/);
});

test('brief: an empty file is not ok but does not throw', () => {
  const brief = parseBrief('');
  assert.equal(brief.ok, false);
  assert.ok(brief.warnings.length > 0);
});

test('brief: text with no headings is kept as the business section', () => {
  const brief = parseBrief('I sell voice assistants.');
  assert.ok(brief.ok, 'a plain paragraph is still usable');
  assert.match(brief.sections.business, /I sell voice assistants/);
});

test('brief: warns about the sections coaching actually needs', () => {
  const brief = parseBrief('# Business\nI sell things.');
  assert.ok(brief.warnings.some((w) => /pricing/i.test(w)));
  assert.ok(brief.warnings.some((w) => /objections/i.test(w)));
});

test('brief: prep prompt carries the brief and the prospect', () => {
  const prompt = buildPrepPrompt(parseBrief(GOOD), 'Dave at Lucedale Auto');
  assert.match(prompt, /Dave at Lucedale Auto/);
  assert.match(prompt, /\$2,500/, 'pricing reaches the model');
  assert.match(prompt, /open/i, 'asks for an opening');
});

test('brief: prep prompt survives an unknown prospect', () => {
  const prompt = buildPrepPrompt(parseBrief(GOOD), '');
  assert.ok(prompt.length > 0);
  assert.doesNotMatch(prompt, /undefined|null/);
});

test('brief: answer system prompt forbids inventing pricing', () => {
  const sys = buildAnswerSystem(parseBrief(GOOD));
  assert.match(sys, /\$2,500/);
  assert.match(sys, /do not invent/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx node --test test/meeting-brief.test.js`
Expected: FAIL — `Cannot find module '../core/meeting/meeting-brief'`

- [ ] **Step 3: Write minimal implementation**

Create `core/meeting/meeting-brief.js`:

```javascript
// Adam's brief, turned into prompt material. Everything here is pure string
// work so the prompts can be tested without an API key.
//
// The parser is deliberately forgiving. This is a file a human edits between
// calls, so a missing heading or an empty file must degrade to "record anyway,
// say what is missing" — never to a thrown error thirty seconds before a
// sales call.

const WANTED = ['business', 'pricing', 'objections'];

function parseBrief(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  const sections = {};
  const warnings = [];

  if (!text) {
    return { ok: false, sections, warnings: ['The brief is empty, so coaching will be generic.'] };
  }

  const lines = text.split(/\r?\n/);
  let current = null;
  let buffer = [];
  const flush = () => {
    if (current && buffer.length) sections[current] = buffer.join('\n').trim();
    buffer = [];
  };

  for (const line of lines) {
    const heading = line.match(/^#{1,3}\s+(.+?)\s*$/);
    if (heading) {
      flush();
      current = heading[1].toLowerCase();
    } else {
      if (!current) current = 'business';
      buffer.push(line);
    }
  }
  flush();

  for (const key of WANTED) {
    if (!sections[key]) warnings.push(`No "${key}" section — advice on that will be generic.`);
  }

  return { ok: Object.keys(sections).length > 0, sections, warnings };
}

function briefBlock(brief) {
  return Object.entries(brief.sections)
    .map(([name, body]) => `${name.toUpperCase()}\n${body}`)
    .join('\n\n');
}

function buildPrepPrompt(brief, prospect) {
  const who = String(prospect || '').trim() || 'an unnamed prospect';
  return [
    `I am about to get on a call with ${who}.`,
    '',
    'Here is my brief on what I sell:',
    '',
    briefBlock(brief),
    '',
    'Give me, in this order and nothing else:',
    '1. How to open — two sentences I could actually say out loud.',
    '2. The three objections most likely from this specific prospect, each with the line that answers it.',
    '3. Three questions I should ask them.',
    '',
    'Be concrete and use my real pricing where it is relevant. Do not invent',
    'numbers that are not in the brief.'
  ].join('\n');
}

function buildAnswerSystem(brief) {
  return [
    'You are helping the user live, mid-conversation, on a call they are on right now.',
    'Answer in at most three short sentences. Lead with the answer — they are',
    'reading this while someone waits for them to speak.',
    '',
    'Everything you know about their business is below. Do not invent pricing,',
    'features, or commitments that are not here; if the answer is not in the',
    'brief or the transcript, say so plainly in one line.',
    '',
    briefBlock(brief)
  ].join('\n');
}

module.exports = { parseBrief, buildPrepPrompt, buildAnswerSystem };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx node --test test/meeting-brief.test.js`
Expected: PASS — 7 tests, 0 failures

- [ ] **Step 5: Commit**

```bash
git add core/meeting/meeting-brief.js test/meeting-brief.test.js
git commit -m "feat(meeting): parse the brief and build prep/answer prompts"
```

---

### Task 4: Disk store and the consent line

**Files:**
- Create: `core/meeting/meeting-store.js`
- Test: `test/meeting-store.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `CONSENT_LINE` (string); `class MeetingStore` with `constructor({ root })` and `open(startedAt, title)` → handle with `dir` (string), `appendSegment(text)`, `writePrepSheet(text)`, `writeNotes(text)`.

- [ ] **Step 1: Write the failing test**

Create `test/meeting-store.test.js`:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx node --test test/meeting-store.test.js`
Expected: FAIL — `Cannot find module '../core/meeting/meeting-store'`

- [ ] **Step 3: Write minimal implementation**

Create `core/meeting/meeting-store.js`:

```javascript
const fs = require('node:fs');
const path = require('node:path');

// Stamped at the top of every notes file. It travels with the document: the
// notes are the artefact that gets emailed or pasted somewhere months later,
// long after anyone remembers how they were produced.
const CONSENT_LINE =
  '> Transcribed live by JARVIS. This record includes another person\'s speech.\n';

const pad = (n) => String(n).padStart(2, '0');

// Local time, never UTC — "the 2:30 call" has to mean his 2:30. Same reasoning
// as core/transcript.js:26.
function folderName(date, title) {
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}`;
  // Anything that is not a letter, digit or dash becomes a dash. This is also
  // the path-traversal guard: '../../etc/passwd' cannot survive it.
  const slug = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${stamp}-${slug || 'meeting'}`;
}

class MeetingStore {
  constructor({ root }) {
    this.root = root;
  }

  open(startedAt, title) {
    const dir = path.join(this.root, folderName(startedAt, title));
    fs.mkdirSync(dir, { recursive: true });
    const transcriptPath = path.join(dir, 'transcript.txt');
    const notesPath = path.join(dir, 'notes.md');
    const prepPath = path.join(dir, 'prep-sheet.md');

    return {
      dir,
      // Appended on arrival rather than buffered: a crash mid-call should cost
      // the last sentence, not the meeting.
      appendSegment(text) {
        fs.appendFileSync(transcriptPath, `${text}\n`, 'utf8');
      },
      writePrepSheet(text) {
        fs.writeFileSync(prepPath, `${CONSENT_LINE}\n${text}\n`, 'utf8');
      },
      // Rewritten whole each refresh — the rolling summary supersedes itself,
      // and appending would leave the reader to work out which version is current.
      writeNotes(text) {
        fs.writeFileSync(notesPath, `${CONSENT_LINE}\n${text}\n`, 'utf8');
      }
    };
  }
}

module.exports = { MeetingStore, CONSENT_LINE, folderName };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx node --test test/meeting-store.test.js`
Expected: PASS — 6 tests, 0 failures

- [ ] **Step 5: Commit**

```bash
git add core/meeting/meeting-store.js test/meeting-store.test.js
git commit -m "feat(meeting): write transcript, notes and prep sheet to disk"
```

---

### Task 5: Rolling notes

**Files:**
- Create: `core/meeting/meeting-notes.js`
- Test: `test/meeting-notes.test.js`

**Interfaces:**
- Consumes: `MeetingTranscript` (Task 2)
- Produces: `class MeetingNotes` with `constructor({ ai, transcript, intervalMs, now })`, `async maybeRefresh()` → `boolean` (true when it called the model), `latest` (getter, string), `lastError` (getter, string or null).

- [ ] **Step 1: Write the failing test**

Create `test/meeting-notes.test.js`:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx node --test test/meeting-notes.test.js`
Expected: FAIL — `Cannot find module '../core/meeting/meeting-notes'`

- [ ] **Step 3: Write minimal implementation**

Create `core/meeting/meeting-notes.js`:

```javascript
// The rolling summary shown in the panel. This is the only component that
// calls the model on a timer, so it is also the only place that can quietly
// run up a bill or hammer the API — hence the two guards: an interval, and a
// transcript-length check so an idle stretch of silence costs nothing.
//
// `now` is injected so the interval is testable without waiting two minutes.

const MAX_TRANSCRIPT_CHARS = 6000;

class MeetingNotes {
  constructor({ ai, transcript, intervalMs = 120000, now = Date.now }) {
    this.ai = ai;
    this.transcript = transcript;
    this.intervalMs = intervalMs;
    this.now = now;
    this.latest = '';
    this.lastError = null;
    this.lastRunAt = now();
    this.lastSegmentCount = 0;
  }

  async maybeRefresh() {
    if (this.transcript.isEmpty) return false;
    if (this.transcript.segmentCount === this.lastSegmentCount) return false;
    if (this.now() - this.lastRunAt < this.intervalMs) return false;

    this.lastRunAt = this.now();
    this.lastSegmentCount = this.transcript.segmentCount;

    const prompt = [
      'You are keeping live notes on a call that is still happening.',
      '',
      'Rewrite the notes below to take account of what has been said since.',
      'Keep it to three short sections and nothing else:',
      'COVERED — what has been discussed.',
      'COMMITTED — anything I said I would do.',
      'OPEN — questions asked that have not been answered yet.',
      '',
      'Notes so far:',
      this.latest || '(nothing yet)',
      '',
      'Transcript:',
      this.transcript.recentText(MAX_TRANSCRIPT_CHARS)
    ].join('\n');

    try {
      const result = await this.ai.cloudReply(prompt, { skipHistory: true });
      if (result && result.ok !== false && result.text) {
        this.latest = String(result.text).trim();
        this.lastError = null;
      }
    } catch (error) {
      // Deliberately swallowed. The spec's rule is that nothing takes down the
      // meeting: transcription continues, the previous notes stay on screen,
      // and the panel shows this string.
      this.lastError = error.message || String(error);
    }
    return true;
  }
}

module.exports = { MeetingNotes, MAX_TRANSCRIPT_CHARS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx node --test test/meeting-notes.test.js`
Expected: PASS — 5 tests, 0 failures

- [ ] **Step 5: Commit**

```bash
git add core/meeting/meeting-notes.js test/meeting-notes.test.js
git commit -m "feat(meeting): add debounced rolling notes that survive model failures"
```

---

### Task 6: The session

**Files:**
- Create: `core/meeting/meeting-session.js`
- Test: `test/meeting-session.test.js`

**Interfaces:**
- Consumes: `MeetingTranscript` (2), `parseBrief` / `buildPrepPrompt` / `buildAnswerSystem` (3), `MeetingStore` (4), `MeetingNotes` (5)
- Produces: `class MeetingSession` with `constructor({ voice, ai, store, readBrief, onState, intervalMs, now })`, `async start({ briefName, prospect, title })`, `handleSegment({ text, dropped })`, `async ask(question)` → `{ ok, text }`, `async stop()`, `active` (getter, boolean), `state` (getter).

- [ ] **Step 1: Write the failing test**

Create `test/meeting-session.test.js`:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx node --test test/meeting-session.test.js`
Expected: FAIL — `Cannot find module '../core/meeting/meeting-session'`

- [ ] **Step 3: Write minimal implementation**

Create `core/meeting/meeting-session.js`:

```javascript
const { MeetingTranscript } = require('./meeting-transcript');
const { MeetingNotes } = require('./meeting-notes');
const { parseBrief, buildPrepPrompt, buildAnswerSystem } = require('./meeting-brief');

const MAX_ASK_CHARS = 6000;

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
  }

  get active() { return this.handle !== null; }

  get state() {
    return {
      active: this.active,
      dir: this.handle ? this.handle.dir : '',
      notes: this.notes ? this.notes.latest : '',
      error: this.notes ? this.notes.lastError : null,
      segments: this.transcript ? this.transcript.segmentCount : 0,
      warning: this.warning
    };
  }

  #publish() { this.onState(this.state); }

  async start({ briefName, prospect, title }) {
    if (this.active) return;
    this.warning = '';
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
      const result = await this.ai.cloudReply(buildPrepPrompt(this.brief, prospect), { skipHistory: true });
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
      const result = await this.ai.cloudReply(
        `${question}\n\nWhat has been said so far:\n${this.transcript.recentText(MAX_ASK_CHARS)}`,
        { systemOverride: buildAnswerSystem(this.brief), skipHistory: true }
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
      try { this.handle.writeNotes(this.notes.latest); } catch { /* already reported */ }
    }
    this.handle = null;
    this.#publish();
  }
}

module.exports = { MeetingSession, MAX_ASK_CHARS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx node --test test/meeting-session.test.js`
Expected: PASS — 8 tests, 0 failures

- [ ] **Step 5: Run the whole suite for regressions**

Run: `npm test`
Expected: every existing test still passes; 5 new files appear in the output.

- [ ] **Step 6: Commit**

```bash
git add core/meeting/meeting-session.js test/meeting-session.test.js
git commit -m "feat(meeting): add the session that owns wake suspend/restore"
```

---

### Task 7: Wire the voice service to the session

**Files:**
- Modify: `core/local-voice-service.js:129-158` (`#handle`), and add two public methods
- Modify: `core/defaults.js`
- Modify: `main.js`

**Interfaces:**
- Consumes: `MeetingSession` (6)
- Produces: `LocalVoiceService#startMeeting()`, `#stopMeeting()`, and the `meeting:segment` event carrying `{ text, dropped }`. Settings keys `meetingHotkey` (default `'Ctrl+Shift+J'`), `meetingNotesIntervalMs` (default `120000`), `meetingBriefsDir` (default `''` meaning the app's own folder).

- [ ] **Step 1: Add the event and the commands to the voice service**

In `core/local-voice-service.js`, inside `#handle(message)` alongside the existing `wake` branch (line 145), add:

```javascript
    if (message.type === 'meeting-segment') {
      this.emit('meeting:segment', { text: message.text || '', dropped: message.dropped || 0 });
      return;
    }
    if (message.type === 'meeting-started' || message.type === 'meeting-stopped') {
      this.emit('meeting:mode', { active: message.type === 'meeting-started' });
      return;
    }
```

Then add two public methods next to the existing `transcribe` method (line 229):

```javascript
  startMeeting() { this.#send({ type: 'meeting-start' }); }

  stopMeeting() { this.#send({ type: 'meeting-stop' }); }
```

- [ ] **Step 2: Add the settings defaults**

In `core/defaults.js`, add to the defaults object:

```javascript
  meetingHotkey: 'Ctrl+Shift+J',
  meetingNotesIntervalMs: 120000,
  meetingBriefsDir: '',
```

- [ ] **Step 3: Construct the session in main.js**

In `main.js`, near the other core services, add:

```javascript
const fsSync = require('node:fs');
const { MeetingSession } = require('./core/meeting/meeting-session');
const { MeetingStore } = require('./core/meeting/meeting-store');

const meetingRoot = path.join(app.getPath('userData'), 'meetings');
const briefsRoot = () =>
  config.getSettings().meetingBriefsDir || path.join(app.getPath('userData'), 'briefs');

const meetingSession = new MeetingSession({
  voice: localVoice,
  ai,
  store: new MeetingStore({ root: meetingRoot }),
  readBrief: (name) => fsSync.readFileSync(path.join(briefsRoot(), `${name}.md`), 'utf8'),
  onState: (state) => sendEverywhere('meeting:state', state),
  intervalMs: config.getSettings().meetingNotesIntervalMs || 120000
});

localVoice.on('meeting:segment', (segment) => meetingSession.handleSegment(segment));
```

- [ ] **Step 4: Add the IPC handlers**

In `main.js`, alongside the other `ipcMain.handle` calls:

```javascript
ipcMain.handle('meeting:start', async (_event, options) => {
  await meetingSession.start(options || {});
  return meetingSession.state;
});
ipcMain.handle('meeting:stop', async () => {
  await meetingSession.stop();
  return meetingSession.state;
});
ipcMain.handle('meeting:ask', async (_event, question) => meetingSession.ask(String(question || '')));
ipcMain.handle('meeting:state', async () => meetingSession.state);
ipcMain.handle('meeting:briefs', async () => {
  try {
    return fsSync.readdirSync(briefsRoot())
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace(/\.md$/, ''));
  } catch {
    return [];
  }
});
```

- [ ] **Step 5: Expose the channels in preload.js**

`preload.js` exposes **named methods only** — there is no generic `invoke(channel)`
helper, and adding one would widen the renderer's reach over IPC for no reason.
Add these alongside the existing entries in the `exposeInMainWorld('jarvis', {…})`
object, following the local `on(channel, callback)` helper defined at the top of
the file:

```javascript
  startMeeting: (options) => ipcRenderer.invoke('meeting:start', options),
  stopMeeting: () => ipcRenderer.invoke('meeting:stop'),
  askMeeting: (question) => ipcRenderer.invoke('meeting:ask', question),
  meetingState: () => ipcRenderer.invoke('meeting:state'),
  meetingBriefs: () => ipcRenderer.invoke('meeting:briefs'),
  onMeetingState: (callback) => on('meeting:state', callback),
```

- [ ] **Step 6: Verify the wiring by hand**

Run: `npm start`

Open DevTools on the main window and run:

```javascript
await window.jarvis.meetingState()
```

Expected: `{ active: false, dir: '', notes: '', error: null, segments: 0, warning: '' }`

- [ ] **Step 7: Commit**

```bash
git add core/local-voice-service.js core/defaults.js main.js preload.js
git commit -m "feat(meeting): wire voice segments and IPC into the meeting session"
```

---

### Task 8: The panel and the hotkey

**Files:**
- Create: `src/meeting-window.html`, `src/meeting-window.js`
- Modify: `main.js` (window creation + `globalShortcut`)

**Interfaces:**
- Consumes: IPC channels from Task 7
- Produces: `openMeetingPanel()` in `main.js`; the panel listens on `meeting:state`.

- [ ] **Step 1: Create the panel markup**

Create `src/meeting-window.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="tokens.css" />
    <link rel="stylesheet" href="styles.css" />
    <title>Meeting</title>
    <style>
      body { margin: 0; padding: 12px; font-size: 13px; }
      #warning { color: #f0a93b; margin-bottom: 8px; }
      #warning:empty { display: none; }
      #notes { white-space: pre-wrap; line-height: 1.5; }
      #answer { white-space: pre-wrap; margin-top: 12px; border-top: 1px solid #333; padding-top: 8px; }
      #answer:empty { display: none; }
      #question { width: 100%; box-sizing: border-box; margin-top: 8px; }
    </style>
  </head>
  <body>
    <div id="warning"></div>
    <div id="notes">Waiting for the meeting to start…</div>
    <div id="answer"></div>
    <input id="question" type="text" placeholder="Ask JARVIS… (Enter)" />
    <script src="meeting-window.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Create the panel script**

Create `src/meeting-window.js`:

```javascript
const notesEl = document.getElementById('notes');
const warnEl = document.getElementById('warning');
const answerEl = document.getElementById('answer');
const questionEl = document.getElementById('question');

function render(state) {
  notesEl.textContent = state.notes || 'Listening — notes appear after the first refresh.';
  // The model failing is shown, never hidden: the spec's rule is that the
  // meeting keeps recording and the panel says what went wrong.
  warnEl.textContent = state.error ? `Notes paused: ${state.error}` : (state.warning || '');
}

window.jarvis.onMeetingState(render);

questionEl.addEventListener('keydown', async (event) => {
  if (event.key !== 'Enter') return;
  const question = questionEl.value.trim();
  if (!question) return;
  questionEl.value = '';
  answerEl.textContent = 'Thinking…';
  const reply = await window.jarvis.askMeeting(question);
  answerEl.textContent = reply.text;
});

window.jarvis.meetingState().then(render);
```

- [ ] **Step 3: Create the window and register the hotkey**

In `main.js`, add:

```javascript
const { globalShortcut } = require('electron');

let meetingWindow = null;

function openMeetingPanel() {
  if (meetingWindow && !meetingWindow.isDestroyed()) {
    meetingWindow.show();
    meetingWindow.focus();
    return meetingWindow;
  }
  meetingWindow = new BrowserWindow({
    width: 380,
    height: 520,
    alwaysOnTop: true,
    skipTaskbar: false,
    title: 'Meeting',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  meetingWindow.loadFile(path.join(__dirname, 'src', 'meeting-window.html'));
  meetingWindow.on('closed', () => { meetingWindow = null; });
  return meetingWindow;
}

function registerMeetingHotkey() {
  const wanted = config.getSettings().meetingHotkey || 'Ctrl+Shift+J';
  globalShortcut.unregisterAll();
  const ok = globalShortcut.register(wanted, () => {
    const win = openMeetingPanel();
    win.focus();
  });
  if (!ok) {
    // Registration fails when another app already owns the combination. The
    // meeting must still run — the panel is reachable from the tray — so this
    // reports rather than throws.
    sendEverywhere('meeting:state', { ...meetingSession.state, warning: `Hotkey ${wanted} is taken by another app.` });
  }
  return ok;
}
```

Call `registerMeetingHotkey()` once the app is ready, and add to the existing `will-quit` handler:

```javascript
app.on('will-quit', () => { globalShortcut.unregisterAll(); });
```

- [ ] **Step 4: Verify by hand**

Run: `npm start`

Press `Ctrl+Shift+J`. Expected: a small always-on-top window titled "Meeting" appears, showing "Waiting for the meeting to start…". Drag another window over it and confirm it stays on top. Press `Ctrl+Shift+J` again with the panel already open — expected: it takes focus rather than opening a second window.

- [ ] **Step 5: Commit**

```bash
git add src/meeting-window.html src/meeting-window.js main.js
git commit -m "feat(meeting): add the always-on-top panel and global hotkey"
```

---

### Task 9: Settings tab and the end-to-end run

**Files:**
- Modify: `src/settings-tabs.js`
- Create: a starter brief at first run

**Interfaces:**
- Consumes: everything above

> **Adding a tab breaks an existing test.** `test/settings-tabs.test.js:6` asserts
> `TABS.length === 9`, and the test's own name says "nine tabs". Update the test
> first — that is the failing-test step for this task.

- [ ] **Step 1: Update the tab test to expect ten**

In `test/settings-tabs.test.js`, change the test name and the length assertion,
and add an assertion for the new tab:

```javascript
test('TABS: ten tabs, unique ids, GENERAL first, CAMERAS, CALLS, MEETINGS and FEATURES present, every tab labelled', () => {
  assert.equal(TABS.length, 10);
```

Then, next to the existing `cameras` assertion (line 11), add:

```javascript
  assert.ok(TABS.some((tab) => tab.id === 'meetings'), 'the MEETINGS tab must exist');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx node --test test/settings-tabs.test.js`
Expected: FAIL — `Expected values to be strictly equal: 9 !== 10`

- [ ] **Step 3: Add the tab**

In `src/settings-tabs.js`, add to the `TABS` array after the `calls` entry (line 12):

```javascript
    { id: 'meetings', label: 'MEETINGS' },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx node --test test/settings-tabs.test.js`
Expected: PASS

- [ ] **Step 5: Add the settings section markup**

In `src/index.html`, add this section inside the settings dialog. The
`data-tab="meetings"` attribute is what `sectionHidden()` reads; match the
surrounding `class` names used by the CAMERAS section so it inherits the dialog
styling:

```html
<section data-tab="meetings">
  <h3>MEETING MODE</h3>
  <p>JARVIS listens, keeps notes, and answers on your hotkey. The wake word is
     off while a meeting runs.</p>

  <label for="meeting-brief">Brief</label>
  <select id="meeting-brief"></select>

  <label for="meeting-prospect">Who are you talking to?</label>
  <input id="meeting-prospect" type="text" placeholder="Dave at Lucedale Auto" />

  <button id="meeting-start">START MEETING</button>
  <button id="meeting-stop">STOP MEETING</button>
  <p id="meeting-status"></p>

  <label for="meeting-hotkey">Hotkey</label>
  <input id="meeting-hotkey" type="text" />

  <label for="meeting-interval">Notes refresh (seconds)</label>
  <input id="meeting-interval" type="number" min="30" step="30" />
</section>
```

- [ ] **Step 6: Wire the controls**

In `src/renderer.js`, alongside the other settings wiring, add:

```javascript
async function initMeetingsTab() {
  const briefSel = document.getElementById('meeting-brief');
  const statusEl = document.getElementById('meeting-status');
  const briefs = await window.jarvis.meetingBriefs();
  briefSel.innerHTML = '';
  for (const name of briefs) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    briefSel.appendChild(option);
  }

  document.getElementById('meeting-start').addEventListener('click', async () => {
    const prospect = document.getElementById('meeting-prospect').value.trim();
    await window.jarvis.startMeeting({ briefName: briefSel.value, prospect, title: prospect });
  });
  document.getElementById('meeting-stop').addEventListener('click', async () => {
    await window.jarvis.stopMeeting();
  });

  window.jarvis.onMeetingState((state) => {
    statusEl.textContent = state.active
      ? `Recording — ${state.segments} segment(s). ${state.warning || ''}`
      : 'Not recording.';
  });
}
```

Call `initMeetingsTab()` where the other tabs initialise. Bind
`#meeting-hotkey` to the `meetingHotkey` setting and `#meeting-interval` to
`meetingNotesIntervalMs` (seconds in the field, milliseconds in the setting —
multiply by 1000 on save) using the same save helper the neighbouring settings
inputs use.

- [ ] **Step 7: Ship a starter brief**

In `main.js`, on app ready, create the briefs folder and write an example if none exists:

```javascript
const starterDir = briefsRoot();
if (!fsSync.existsSync(starterDir)) {
  fsSync.mkdirSync(starterDir, { recursive: true });
  fsSync.writeFileSync(path.join(starterDir, 'example.md'), [
    '# Business',
    'What you sell, in a sentence or two.',
    '',
    '# Pricing',
    'Your real numbers. JARVIS will not invent any that are not here.',
    '',
    '# Objections',
    '"Too expensive" - the answer that has worked.',
    '"We already have X" - the answer that has worked.',
    ''
  ].join('\n'), 'utf8');
}
```

- [ ] **Step 8: Run the whole suite**

Run: `npm test`
Expected: all tests pass, including the five new meeting files and the updated
`settings-tabs.test.js`.

- [ ] **Step 9: End-to-end verification**

Run: `npm start`

1. Settings → MEETINGS. Confirm `example` appears in the brief picker.
2. Edit `example.md` in the briefs folder to describe the JARVIS business, with real pricing.
3. Enter a prospect name and press **START MEETING**.
4. Speak for two minutes — read something aloud if easier. Expected: the panel shows notes after the first refresh, and `transcript.txt` in the meeting folder grows as you speak.
5. Press `Ctrl+Shift+J`, type "what should I say about price?", press Enter. Expected: an answer within a few seconds that uses the pricing from the brief.
6. **Say "Hey JARVIS" out loud.** Expected: **nothing happens** — the wake word is suspended.
7. Press **STOP MEETING**. Say "Hey JARVIS" again. Expected: he wakes.
8. Open the meeting folder. Expected: `transcript.txt`, `notes.md`, and `prep-sheet.md`, with `notes.md` and `prep-sheet.md` both opening with the consent line.

- [ ] **Step 10: Verify the failure path**

Remove the Anthropic key in Settings, start a meeting, and speak. Expected: the panel shows a "Notes paused: …" warning, **and `transcript.txt` still grows**. This is the spec's central rule and the one most likely to regress.

- [ ] **Step 11: Commit**

```bash
git add src/settings-tabs.js test/settings-tabs.test.js src/index.html src/renderer.js main.js
git commit -m "feat(meeting): add the MEETINGS settings tab and starter brief"
```

---

## Self-review notes

**Spec coverage.** Prep sheet → Task 6 (`#writePrepSheet`) + Task 3. Rolling panel → Tasks 5, 8. Hotkey answers → Tasks 6, 8. Files on disk → Task 4. Wake-word suspension → Tasks 1, 6, 9 step 4.6. Claude failure survival → Task 5, verified Task 9 step 5. Whisper backlog → Task 1 (`dropped`), surfaced Task 6. Crash safety → Task 4. Consent line → Task 4. Listening indicator → **Task 8's panel is the indicator**; it is always-on-top and visible for the meeting's duration.

**Known gap, deliberately left.** The three settled decisions in the spec name `Ctrl+Shift+J` and a 120000 ms interval; both are wired as settings in Task 7 and exposed in Task 9. The brief folder is `userData/briefs` rather than a picker, per the spec.

**Task 1 has no automated test.** Stated in the task. The repo has no Python runner and `npm test` is `node --test`; every layer above Python is covered.

**Three errors caught in review, fixed inline.** Worth recording so nobody
reintroduces them:

1. **There is no `window.jarvis.invoke`.** `preload.js` exposes named methods
   only (`bootstrap`, `voiceStatus`, `onTtsStatus`, …). The first draft of the
   panel called a generic `invoke(channel)` that does not exist and would have
   failed at runtime with no compile-time warning. Task 7 now adds named methods;
   Task 8 uses them. Do not add a generic bridge — it would widen the renderer's
   IPC reach for no gain.
2. **Adding a settings tab breaks `test/settings-tabs.test.js`**, which pins
   `TABS.length === 9`. Task 9 now opens by updating that test, so the break is
   the intended failing-test step rather than a surprise at `npm test`.
3. **Task 9's tab step was prose, not code.** Rewritten with the actual `TABS`
   entry, section markup, and renderer wiring.

---

## Corrections applied during execution (2026-08-07)

Tasks 1-6 were executed and reviewed. Three defects **in this plan's own code**
were caught by review and fixed in the implementation. The task text above is
left as written for the record; where it conflicts with this section, **this
section is correct**.

1. **Task 1 — `meeting_loop` depended on a VAD that is never created in the
   default configuration.** `initialize_wake()` only assigns `self.vad` in its
   `else` branch, taken when the assistant name is *not* Jarvis-like. With the
   default name, `self.vad` stays `None` forever and meeting mode would have
   emitted zero segments while reporting success. Fixed with an
   `ensure_meeting_ready()` method that establishes a VAD and a microphone
   stream regardless of which wake path ran. Two privacy leaks in that area
   were closed at the same time: a meeting started with the wake word disabled
   falsely announced `wakeReady: true` and never released the microphone, and a
   start that failed after opening the stream leaked it.

2. **Tasks 5 and 6 — `{ skipHistory: true }` does not exist.** This plan
   invented the flag; `core/ai-service.js` has no such option and ignores it.
   The real consequences were that meeting transcripts would be written into
   the shared `'general'` conversation history via `#remember`, and unrelated
   chat history would be read *into* meeting prompts. The real mechanisms are
   `systemOverride` (suppresses the history read, `ai-service.js:202-204`) and
   `untrustedContent: true` (suppresses `#remember`, `ai-service.js:60`). All
   three `cloudReply` call sites now pass both.

3. **Task 4 — unguarded filesystem writes.** `appendFileSync` / `writeFileSync`
   would throw out of `appendSegment` and end the meeting, contradicting this
   spec's own "nothing takes down the meeting" rule. The store now contains
   write failures and exposes `lastError`; `open()`'s `mkdirSync` deliberately
   still throws, because a missing folder means recording nowhere.

**Interface changes for Task 7.** The Python service can now also emit
`{"type": "meeting-error", "message": str}` — the JS side must handle it. The
session's `state` exposes `notesError` and `storeError` as separate fields, not
the single `error` field shown in Task 7's Step 6 expected output.

**Outstanding:** Task 1's microphone smoke test has never been run — no agent
had a microphone. It remains the real gate on the Python layer.
