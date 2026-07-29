# JARVIS — Free Private Desktop Assistant for Windows

A JARVIS-style assistant that runs on **your own PC**. No subscription, no
account, no telemetry. Say **"Hey Jarvis"** — the wake word and speech
recognition run 100% locally. An animated amber holographic interface with a
floating orb when minimized.

**[⬇ Download the latest JARVIS-FREE-SETUP.exe](https://github.com/Adamdesgns/jarvis-local-assistant/releases/latest)**

> Windows SmartScreen will warn about an unknown publisher — this is a free,
> unsigned app. Click **More info → Run anyway**. Verify your download against
> the SHA-256 checksum posted with each release.

## What it does

**Voice**
- "Hey Jarvis" wake word + push-to-talk — both fully on-device
- Free local speech recognition (faster-whisper); spoken replies in Windows voices
- Voice Diagnostics panel: green/red checks, live mic test, one-click repair

**Daily assistant**
- Tasks with priorities, due dates, and repeats — "remind me to drain the compressor every morning"
- Morning briefing: tasks, overdue items, latest note, PC status
- Searchable memory with edit/forget; saved routines like "Start work"
- Desktop notifications for reminders and watched folders

**Files & documents**
- Voice file search across folders **you approve** — nowhere else
- Reads and summarizes PDF, Word, Excel, CSV, and text files
- **Ask your documents questions** — answers only from your files, cited down to the PDF page
- Built-in explorer: pinned folders, recent files, folder watching, safe organizing

**Brains — your choice**
- **Free local mode (default):** conversation via [Ollama](https://ollama.com), entirely on your PC
- **Optional cloud:** Claude (Anthropic) or OpenAI with your own prepaid API key,
  encrypted with Windows secure storage, removable anytime
- **"Look at my screen"** — describes your screen via the cloud brain, always
  behind a red on-screen indicator

**Safety by design**
- Deletes go to the Recycle Bin and always ask first; so do moves, renames, and shutdown
- Cannot send messages or buy anything, and the AI holds no shell — commands you type in
  THE TERMINAL run through a guard that asks first, and the model can never reach it
- Cloud AI calls (which cost API credits) run only with your own key; unattended night
  jobs stop at a per-night budget you set, metered against deliberately pessimistic
  token prices so the cap trips early, not late
- All data in one folder (`%APPDATA%\jarvis-local-assistant`) you can back up,
  export, or delete. See [PRIVACY.md](PRIVACY.md) and [SUPPORT.md](SUPPORT.md)

## JARVIS JR — a separate build for kids

JARVIS JR is the parental-controls variant of JARVIS: its own build, its
own installer, its own `%APPDATA%\jarvis-jr` folder — never shares data
with the grown-up JARVIS, and can run side by side with it. Run it from
source with `npm run start:jr`; package its installer with `npm run
dist:jr`.

**The parental-controls model, in five lines:**
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

## Install

1. Download **JARVIS-FREE-SETUP.exe** from [Releases](https://github.com/Adamdesgns/jarvis-local-assistant/releases/latest) and run it.
2. In Settings, click **INSTALL / REPAIR LOCAL VOICE** and watch the progress line (needs [Python 3.12](https://www.python.org/downloads/) — the installer fetches it via winget if missing).
3. Optional: install [Ollama for Windows](https://ollama.com/download/windows) and click **CONNECT / REPAIR OLLAMA** for local conversation.
4. Optional: add a Claude or OpenAI API key for the cloud brain and screen vision.

JARVIS checks this repo's releases on launch and tells you when a newer
version exists. Nothing ever installs automatically.

## Build from source

```bash
npm install
npm test        # 32 tests
npm start       # run from source
```

Package the installer: `npx electron-builder --win dir`, then compile
`scripts\jarvis-installer.nsi` with NSIS `makensis`. Output:
`dist\JARVIS-FREE-SETUP.exe`.

## License

MIT — see [LICENSE](LICENSE). Provided as-is; see [DISCLAIMER.txt](DISCLAIMER.txt).
