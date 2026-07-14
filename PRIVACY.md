# JARVIS Privacy & Data

JARVIS is built to keep your data on your own computer. This page explains, in
plain English, what is stored, where it lives, and what leaves your PC.

## What stays on your computer (always)

- **Tasks, notes, and activity history** — plain files in your JARVIS data folder.
- **Settings** — your folders, projects, routines, and preferences.
- **API keys** — encrypted with Windows secure storage (DPAPI). They are never
  written in plain text and are never included in a backup export.
- **Local voice** — the "Hey Jarvis" wake word and speech-to-text run entirely
  on your PC. Audio is transcribed locally and is not uploaded anywhere.

## Where the data lives

Everything is under your Windows user profile:

```
%APPDATA%\jarvis-local-assistant\
  settings.json      your preferences and (encrypted) keys
  tasks.json         your task list
  memory.json        your saved notes
  activity.jsonl     a log of commands you have run
  voice\             the local voice environment and models
```

To see it, press Win+R, paste `%APPDATA%\jarvis-local-assistant`, and press Enter.

## What leaves your computer (only if you turn it on)

- **Cloud Brain (optional).** If you add an OpenAI or Anthropic API key and set
  Brain Mode to Cloud or Auto, the text of your conversation and any document
  passages you ask about are sent to that provider to generate a reply. Your
  files themselves are not uploaded — only the relevant text. Local mode
  (the default) sends nothing off the PC.
- Nothing else is transmitted. JARVIS has no analytics, telemetry, or accounts.

## Deleting your data

- Remove a single API key: Settings → the matching Brain card → REMOVE KEY.
- Remove everything: uninstall JARVIS (see below), then delete the
  `%APPDATA%\jarvis-local-assistant` folder.

## Uninstalling

Open Windows Settings → Apps → JARVIS Local Assistant → Uninstall, or run
"Uninstall JARVIS" from the Start menu. Uninstalling removes the program and
its shortcuts. Your data folder is left in place on purpose so a reinstall
keeps your tasks and notes; delete it manually if you want a clean wipe.
