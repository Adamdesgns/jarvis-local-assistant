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
- Cannot send messages, spend money, or run shell commands — by architecture, not policy
- All data in one folder (`%APPDATA%\jarvis-local-assistant`) you can back up,
  export, or delete. See [PRIVACY.md](PRIVACY.md) and [SUPPORT.md](SUPPORT.md)

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
