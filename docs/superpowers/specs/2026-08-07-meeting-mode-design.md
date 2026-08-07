# Meeting mode

**Date:** 2026-08-07
**Status:** approved by Adam, ready for an implementation plan
**Goal, in his words:** *"I want J.A.R.V.I.S. to have a meeting mode where he
listens to you. Takes notes, gives you answers to questions as they're asked and
helps you with the interview. If it's a sales call he can give tips and pointers
on what to say how to start."*

## Why

Adam sells custom JARVIS builds. The calls that decide whether that happens —
sales calls, scoping interviews — are the ones where he is least able to look
anything up, because he is talking. Meeting mode is JARVIS listening to that
call, keeping the notes so he does not have to, and being available on a keypress
when he wants a second opinion mid-sentence.

## Decisions made with Adam, and why

These four answers shaped everything below. Recording them because each closed off
a materially different build.

**1. Microphone first; the audio source is swappable.** JARVIS only hears the mic
today — every capture path (`src/renderer.js:1277`, `src/call-ui.js:64`,
`src/mobile/mobile.js:185`) is `getUserMedia`. On a video call with headphones
on, that means JARVIS hears Adam's half and none of the prospect's, which guts
the feature. Windows can capture system audio via Electron loopback, but it is a
multi-session job.

Mic-first was chosen anyway, because **a Zoom call taken on speakers puts both
sides into the mic** — echo cancellation is already enabled on the existing
capture path — so a mic-only build is testable on a real sales call immediately.
The riskier unknown is not audio capture (a solved problem with a known Windows
answer) but whether live coaching is useful or merely distracting, and that is
answered faster against the easy audio path. Loopback is phase 2 and slots in
behind the same segment interface without touching anything downstream.

**2. On-demand only. JARVIS never interrupts.** He listens and takes notes
silently; help is pulled deliberately. This removes the hardest problem in the
feature — deciding whether a question was aimed at Adam — and removes the risk of
an answer appearing at the exact wrong moment.

Consequence: **the ask must be silent**, because saying "JARVIS, thoughts?" out
loud on a sales call is not an option. A global hotkey raises the panel, with a
text box for a specific question. Talking to him out loud stays available for
in-person meetings, where it is not awkward.

**3. Claude is the brain. Transcripts leave the machine.** Adam's call, on his own
business. Two consequences are carried in the build rather than argued about:
a visible listening indicator, and a consent line stamped at the top of every
notes file (see Privacy below).

**4. Coaching is grounded in a brief Adam writes, not generic sales advice.**
Generic advice is what any chatbot gives; the value is in "he just balked at
price, here is the line that has worked." Cost of that choice: the brief is a
file Adam has to write and keep current.

**Cost is not a constraint and should not drive design choices here.** An
hour-long call is roughly 12,000 tokens of transcript. At Opus 5 rates ($5/M in,
$25/M out), a call with eight pulls costs about 30¢; adding the rolling summary
takes it to roughly 80¢, before prompt caching on the growing transcript brings
it down again.

## What it does

1. **Before the call**, Adam picks a brief and says who he is about to talk to.
   JARVIS produces a **prep sheet**: how to open, the objections most likely to
   come up with this prospect, and questions worth asking. This is the piece that
   answers "how to start" — the opening is decided before dialling, not live.
2. **During the call**, a floating always-on-top panel shows a **rolling summary**
   that refreshes every couple of minutes: what has been covered, what Adam
   committed to, what is still unanswered.
3. **On the hotkey**, the panel takes focus and Adam can type a question. JARVIS
   answers from the brief plus everything said so far.
4. **After the call**, the meeting is on disk: prep sheet, full transcript,
   final notes, decisions, and action items.

## Architecture

Six new pieces, each with one job, plus wiring. Most of this is assembly —
the machinery already exists.

### Reused as-is

- **`scripts/local_voice.py:265` (`transcribe_wake_loop`)** already runs a
  Silero-VAD-gated segmenter that chops the mic into speech segments and puts
  each through faster-whisper. Continuous transcription is that loop with the
  wake-word matching removed — not a new pipeline.
- **`core/ai-service.js`** for Claude calls, including its existing adapters.
- **`core/config-store.js`** for settings.
- **`main.js:496`** (the orb widget) as the always-on-top window pattern;
  **`main.js:371`** as the generic window factory.
- **`core/transcript.js`** as the precedent for how plain-text records get
  written — not extended, because its whole design is a 24–48 hour rolling
  window and meeting records must persist.

### New

| File | Job |
|---|---|
| `scripts/local_voice.py` — new `meeting` mode | Emits every speech segment as text; no wake matching, no command routing |
| `core/meeting/meeting-session.js` | Owns one meeting: start/stop, accumulates the transcript, holds the brief, emits state |
| `core/meeting/meeting-notes.js` | The rolling summary; the only thing calling Claude continuously. Debounced, skips when nothing new |
| `core/meeting/meeting-brief.js` | Loads and validates the brief, generates the prep sheet |
| `core/meeting/meeting-store.js` | Writes prep sheet, transcript, and notes to disk as the call runs |
| `src/meeting-window.html` / `.js` | The always-on-top panel |

IPC handlers and a Settings → MEETINGS tab wire it together.

### Data flow

Mic → Python segmenter → one event per speech segment → `meeting-session`
appends to the transcript **and writes it to disk immediately** → nudges
`meeting-notes` → debounced Claude call → panel re-renders.

Hotkey → panel focus → optional typed question → `meeting-session` assembles
brief + transcript so far + question → `ai-service` → answer rendered in panel.

Writing each segment to disk on arrival is deliberate: a crash mid-call costs the
last sentence, not the meeting.

## Meeting mode suspends the wake word

There is one microphone and one Python voice process. While a meeting runs,
**JARVIS stops listening for his name** and only transcribes.

This is not an implementation shortcut — it is the point. Without it, saying
"…the way JARVIS handles that…" on a sales call wakes the assistant in front of
the prospect. The hotkey exists precisely because the wake word is unavailable.
Ending the meeting restores the previous wake state.

## Privacy and consent

Adam's decision to use Claude is on record above. Two things ship with it:

- **A visible listening indicator** for the whole meeting, following the existing
  `screen:viewing` precedent in `main.js:1093`, which already announces to every
  window when JARVIS is looking at the screen.
- **A consent line stamped at the top of every notes file**, recording that the
  conversation was transcribed and when.

Two facts to carry forward rather than rediscover. **Transcribing another
person's speech has consent rules that vary by state** — Mississippi is
one-party, so Adam is clear, but a client on the other end may not be.
And **this makes Open Loop #51 urgent**: JARVIS has no terms of use, and
`PRIVACY.md` is not in `build.files`, so it does not ship inside the app. A
product that transcribes client calls to a cloud API and cannot show the user a
privacy policy is a real gap before any client build is sold.

## Error handling

The rule: **nothing takes down the meeting.**

- **Claude fails** (missing key, rate limit, network) → the panel shows the error
  inline and transcription keeps running. Adam still gets his transcript and
  notes file. A failed summary must never end the session.
- **Whisper falls behind** and segments back up → the panel says so and the
  rolling summary is dropped to keep transcription alive. Audio is never
  silently lost.
- **Crash mid-meeting** → the transcript is on disk up to the last segment.
- **No brief selected** → meeting mode still runs as a scribe. The prep sheet is
  skipped and the panel says why, rather than refusing to start.

## Testing

- **The pipeline** is tested by replaying a canned transcript through
  `meeting-session` with no audio and a stubbed Claude. Deterministic and fast,
  and it exercises the whole chain: segment accumulation, the notes debounce, the
  disk writes, and the hotkey assembly path.
- **Pure functions** — brief parsing, transcript windowing, consent stamping,
  the debounce trigger — get ordinary unit tests.
- **The wake-word suspension** gets an explicit test: starting a meeting disables
  the wake word and ending it restores the prior state. A regression here is
  embarrassing in front of a client.

**What tests cannot prove is whether the coaching is any good.** That needs Adam
on a real call, which is the whole reason the mic-first path was chosen.

## Out of scope for v1

- **Loopback / system audio** (headphones) — agreed phase 2, slots in behind the
  same segment interface.
- **Speaker labels** — needs diarization; wants loopback first to be worth much.
- **Anything proactive** — explicitly rejected; see decision 2.
- **Mobile** — the panel is a desktop window.

## Smaller decisions, settled so the plan does not have to guess

1. **Briefs live in a JARVIS-owned folder**, one markdown file per brief, listed
   by filename when a meeting starts. Not an arbitrary file picker: the brief is
   reread on every pull during a call, so it needs a stable path that survives
   the file being moved or renamed mid-meeting.
2. **The hotkey is `Ctrl+Shift+J`, and it is a setting.** It has to be a global
   shortcut, which means it must not collide with anything live in Zoom or
   Chrome — `Ctrl+Shift+M` is Zoom's mute and `Ctrl+Shift+A` its audio toggle,
   so both are out. If registration fails because something else already owns the
   combination, meeting mode still starts and the panel says which key is
   unavailable rather than failing silently.
3. **The rolling summary refreshes every two minutes, and it is a setting.** Two
   minutes is a starting guess, not a measured number — it is exposed from day
   one so it can be tuned on a real call instead of requiring a rebuild.
