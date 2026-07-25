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

## JARVIS JUNIOR (the children's build)

JARVIS JUNIOR keeps its own folder, `%APPDATA%\jarvis-junior\`, with the same
files plus `star-chart.json` (the job list, the stars earned, and rewards
traded in). It is a separate install: nothing is shared with the grown-up
JARVIS on the same PC, and an API key saved in one is not visible to the
other.

Two things a parent should know before handing it over:

- **The grown-up screen lists the questions it declined to answer** — the
  "ask a grown-up" ones, so you can have the conversation yourself. Ordinary
  chat is in `activity.jsonl` like any other command.
- **Messages that sound like distress are answered but not listed.** If a
  child says something suggesting they are hurting themselves or that someone
  is hurting them, JARVIS JUNIOR responds with care and points them at a
  trusted adult — and does not put it on the grown-up screen. A child who is
  not safe at home has to be able to say so without the family computer
  reporting it to the family. It is a deliberate choice, and it is the one
  place the children's build keeps something back from a parent.

## Deleting your data

- Remove a single API key: Settings → the matching Brain card → REMOVE KEY.
- Remove everything: uninstall JARVIS (see below), then delete the
  `%APPDATA%\jarvis-local-assistant` folder.

## Uninstalling

Open Windows Settings → Apps → JARVIS Local Assistant → Uninstall, or run
"Uninstall JARVIS" from the Start menu. Uninstalling removes the program and
its shortcuts. Your data folder is left in place on purpose so a reinstall
keeps your tasks and notes; delete it manually if you want a clean wipe.
