# JARVIS JR — Private Desktop Assistant for Kids (Windows)

The parental-controls edition of
[JARVIS](https://github.com/Adamdesgns/jarvis-local-assistant): a JARVIS-style
voice assistant that runs on **your own PC** — no subscription, no account, no
telemetry — locked down for kids (ages ~5–12) behind a parent PIN. It's its own
build with its own installer and its own `%APPDATA%\jarvis-jr` data folder: it
never shares data with the grown-up JARVIS and can run side by side with it.

**[⬇ Download the latest JARVIS-JR-Setup.exe](https://github.com/Adamdesgns/jarvis-jr/releases/latest)**

> ⚠️ **Get the file named `JARVIS-JR-Setup`** — the grown-up build is
> `JARVIS-Setup` and looks almost identical. Only `JARVIS-JR-Setup` has the
> parent PIN and content lock.
>
> Windows SmartScreen will warn about an unknown publisher — this is a free,
> unsigned app. Click **More info → Run anyway**.

## The parental-controls model, in five lines

- A parent sets it up first — PIN, birthdate, and a checklist of what's
  allowed — before a kid ever sees a desk; nothing about that gate can be
  skipped or redone without the PIN.
- Every reply is age-banded off that birthdate, and adjusts automatically
  as the kid gets older — no re-setup required.
- A content-lock guard checks every message before it ever reaches the AI
  brain; dangerous or grown-up topics get a fixed, honest deflection
  instead of an explanation, no matter what the model would have said.
- The checklist is deny-by-default and gates what JARVIS JR even builds —
  a control left off (cameras, the terminal, the browser, file search)
  isn't hidden, it's simply not constructed that run.
- Checklist and PIN changes need the parent PIN and take effect the next
  time JARVIS JR starts; the panel says so, so nothing shifts mid-session.

**Privacy stance:** the activity log records topic refusals so a parent
can see what got blocked and why, but never a cry for help — if a kid
says something that sounds like they're in danger, JARVIS JR answers with
care and points them to a trusted adult (and 988, in the US) without ever
writing that moment to the log, on purpose.

**Games:** two built-in games, tic tac toe and rock paper scissors, played
by typing "play tic tac toe" or "play rock paper scissors" and then tapping
— boards, chips, and difficulty are all taps, never voice. The kid picks
easy, normal, or hard before each game. Difficulty here is honest, not
decorative: on easy, JARVIS deliberately plays worse so a kid can actually
win; on hard, it plays close to its best and reads a repeated pattern
(throw rock five times in a row and don't be surprised when it starts
answering with paper). Wins, losses, draws, and best streak live in JARVIS
JR's own scores file and survive a restart. Games are gated by the same
checklist as everything else — turn Games off in the parent panel and
"play tic tac toe" is just an ordinary sentence again, no overlay, no
special refusal.

## What it can do (all behind the parent checklist)

Everything the grown-up JARVIS does, JARVIS JR can do too — but each capability
is off unless a parent turns it on:

- **Voice** — "Hey Jarvis" wake word + push-to-talk, fully on-device; free local
  speech recognition, spoken replies in JARVIS's own local voice.
- **Homework & tasks** — age-appropriate homework hints, tasks, timers, quips.
- **Files & documents** *(off by default)* — read and summarize PDF/Word/Excel/CSV
  from a folder the parent approves.
- **Cameras, browser, terminal, screen reading, apps** *(each off by default)* —
  handed down one checkbox at a time, never all-or-nothing.
- **Rock-paper-scissors camera** *(off by default)* — the webcam reads the kid's
  hand during the game, on this PC only.

## Install

1. Download **`JARVIS-JR-Setup-0.18.0.exe`** from
   [Releases](https://github.com/Adamdesgns/jarvis-jr/releases/latest) and run it.
   It installs as **"JARVIS JR"** alongside the grown-up JARVIS — it does not
   replace it.
2. On first launch, set the **parent PIN and birthdate** and pick the checklist
   of what's allowed. This gate can't be skipped.
3. In Settings, click **INSTALL / REPAIR LOCAL VOICE** for the on-device voice
   (needs [Python 3.12](https://www.python.org/downloads/) — fetched via winget
   if missing).
4. Optional: install [Ollama for Windows](https://ollama.com/download/windows)
   and click **CONNECT / REPAIR OLLAMA** for a fully-local conversation brain.

JARVIS JR checks this repo's releases on launch and tells you when a newer
version exists. Nothing ever installs automatically.

## Build from source

```bash
npm install
npm test           # test suite
npm run start:jr   # run the JR build from source
```

Package the JR installer:

```bash
npm run dist:jr
```

Output: `dist\JARVIS-JR-Setup-0.18.0.exe`.

## License

MIT — see [LICENSE](LICENSE). Provided as-is; see [DISCLAIMER.txt](DISCLAIMER.txt).
