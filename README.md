# JARVIS — Private Local Assistant

A free Windows desktop assistant with a cinematic amber interface. It runs on
your own PC: local conversation through Ollama, free local speech recognition,
a "Hey Jarvis" wake word, tasks, memories, file search, and document reading —
no subscription and no API credits required. An optional OpenAI "Cloud Brain"
can be connected for stronger reasoning; it is separate and prepaid.

## Install

1. Double-click **JARVIS-FREE-SETUP.exe** and pick an install folder.
2. JARVIS opens by itself when the installer finishes.
3. In Settings, select **INSTALL / REPAIR LOCAL VOICE** and watch the progress
   line until it says local voice is installed. No other window will open.
4. Optional: install [Ollama for Windows](https://ollama.com/download/windows)
   and select **CONNECT / REPAIR OLLAMA** for local conversation.

## If voice does not work

Open **Settings → VOICE DIAGNOSTICS**. Green rows are working; red rows say
exactly what to fix. Use **TEST MICROPHONE** to hear back what JARVIS heard,
**TEST "HEY JARVIS"** to check the wake word, **REPAIR VOICE** to reinstall,
and **COPY DIAGNOSTIC REPORT** to share the results (it contains no secrets).

## Moving things around

Every module drags by its title bar at any time — no edit mode needed — and
resizes from every edge and corner. Click a module to bring it forward. Use
**MODULES** in the top bar to add or remove panels and **EDIT LAYOUT** only if
you want the handles highlighted. Layouts save automatically.

## For developers

```bash
npm install
npm test        # 13 tests
npm start       # run from source
```

Build the giveaway installer with `scripts\build-installer.bat` (produces
`dist\JARVIS-FREE-SETUP.exe`). Data lives in `%APPDATA%\jarvis-local-assistant`;
API keys are encrypted with Windows secure storage. Security boundaries:
allow-listed app launching, approved-folder file access, Recycle Bin deletion
behind approval cards, and no model-generated shell commands, ever.
