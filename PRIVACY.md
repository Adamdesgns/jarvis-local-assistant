# JARVIS Privacy & Data

Last checked against the code on **2026-07-30** (v0.18.0).

JARVIS is built to keep your data on your own computer, and most of the time it
does. But "local-first" is not the same as "never touches the internet," and
this page is meant to be accurate rather than reassuring. Everything below was
verified against the source, not summarised from intent.

## What stays on your computer

- **Tasks, notes, activity history, and schedules** — plain files in your JARVIS
  data folder. Not encrypted; anything with access to your Windows account can
  read them.
- **Settings** — your folders, projects, routines, and preferences.
- **Your conversations** — see *Your conversation record* below. Kept as plain
  text for about two days.
- **API keys** — encrypted with Windows secure storage (DPAPI) whenever it is
  available, which on a normal Windows install it is. **The exact behaviour when
  it is not available differs by key:** the OpenAI key refuses to save at all
  and you get an error, while other secrets fall back to being written in plain
  text inside `settings.json`. That fallback is a real hole and it is being
  named here rather than glossed over. Keys are never included in a backup
  export.
- **Speech recognition** — once the models are downloaded, your audio is
  transcribed on your own CPU and the audio itself is never uploaded anywhere.

## What gets downloaded the first time

This is the part the previous version of this page got wrong, so it now has its
own section. **A fresh install reaches out to the internet even if you never
turn on a single optional feature.**

- **The voice JARVIS speaks with.** The default text-to-speech engine is Kokoro
  (`ttsEngine: 'kokoro'`), and the model `onnx-community/Kokoro-82M-ONNX` is
  downloaded from **huggingface.co** — roughly 326 MB. Until it lands, JARVIS
  talks with the built-in Windows voice.
- **The wake word.** Setting up local voice downloads the openWakeWord
  `hey_jarvis` model (~1.3 MB).
- **Speech-to-text.** The same setup downloads a faster-whisper model
  (`small.en` by default), which comes from **huggingface.co**.

These are one-time downloads of software, not uploads of your data — nothing
about you is sent to get them. But they are network connections to third parties
on a default install, and you should know they happen.

## Where your data lives

Everything is under your Windows user profile:

```
%APPDATA%\jarvis-local-assistant\
  settings.json        your preferences and (usually encrypted) keys
  tasks.json           your task list
  memory.json          your saved notes
  schedules.json       your scheduled tasks
  activity.jsonl       a structured log of commands you have run
  crash.log            errors, so a crash can be diagnosed
  2026-07-30.txt       your conversation record, one file per day (~2 days kept)
  voice\               the local voice environment and downloaded models
  cameras\             the camera streaming helper's local config
```

Windows and Electron also keep their own files in that folder (`Preferences`,
`Local State`, cache databases). Those are the browser engine's, not JARVIS's.

To see it, press Win+R, paste `%APPDATA%\jarvis-local-assistant`, and press Enter.

## Your conversation record

JARVIS keeps a rolling plain-text record of what you said and what he said back,
one file per day, and deletes anything older than about two days automatically.
It is prose, meant for you to read or copy. It is **not** encrypted.

This exists so you can go back and find something from yesterday. If you would
rather it did not exist, delete the `.txt` files in the data folder — they are
regenerated only as you keep talking.

## What leaves your computer

**Nothing in this list happens unless the relevant feature is on.** But several
of these are easy to turn on without thinking of them as network features, so
they are all spelled out.

- **Cloud Brain (optional, off by default).** If you add an OpenAI or Anthropic
  API key and set Brain Mode to Cloud or Auto, the text of your conversation and
  any document passages you ask about are sent to that provider
  (`api.openai.com` / `api.anthropic.com`) to generate a reply. Your files
  themselves are not uploaded — only the relevant text.
- **Local Brain.** Ollama runs on your own machine at `127.0.0.1:11434`.
  Conversation text sent to it does not leave the PC.
- **Cameras (optional).** Cloud cameras talk to their makers' servers, because
  that is the only way they work:
  - **Ring** — your sign-in produces a token that JARVIS keeps; live view sends
    your browser's video-call offer straight to Ring's cloud, and snapshots come
    from Ring's servers.
  - **Blink** — `rest-prod.immedia-semi.com`.
  - **Nest** — Google (`smartdevicemanagement.googleapis.com`,
    `oauth2.googleapis.com`, `nestservices.google.com`).
  - **Local RTSP cameras** stay on your own network; the streaming helper
    (`go2rtc`) listens only on `127.0.0.1`.
- **The Browser module (optional).** It is a real web browser, so every page you
  open is an ordinary internet connection. Anything you type in the address bar
  that is not a web address becomes a **DuckDuckGo** search. Pages run walled
  off from JARVIS's files, settings, and keys, and cannot ask for your camera,
  microphone, or location.
- **Mobile companion (optional, off by default).** JARVIS starts a small server
  so your phone can reach him. It binds **only** to your Tailscale address (and
  loopback) — never to your regular network and never to the open internet. If
  Tailscale is not running, it refuses to start rather than falling back to
  something less private.
- **Update check.** On launch, JARVIS asks the public GitHub release page
  whether a newer version exists (`api.github.com`). No account, no personal
  data — the same request a browser makes when you visit the page. Nothing
  installs itself.
- **License checks (dormant).** JARVIS is free and there are no license buttons
  in the app any more. To be straight about it: the code that could contact the
  store (`api.lemonsqueezy.com`) is still present and still wired to internal
  channels, so it *could* be called even though nothing in the interface calls
  it. It never runs on its own and never runs at launch.

## What JARVIS does not do

- No analytics, no telemetry, no crash reporting to us, no accounts.
- No usage data of any kind is sent anywhere.
- Your files are never uploaded. When a cloud brain is answering a question
  about a document, only the relevant passages of text are sent.
- Nothing "phones home" to check up on you.

## Deleting your data

- Remove a single API key: Settings → the matching Brain card → REMOVE KEY.
- Delete your conversation record: delete the dated `.txt` files in the data
  folder.
- Remove everything: uninstall JARVIS (see below), then delete the
  `%APPDATA%\jarvis-local-assistant` folder.

## Uninstalling

Open Windows Settings → Apps → JARVIS Local Assistant → Uninstall, or run
"Uninstall JARVIS" from the Start menu. Uninstalling removes the program and its
shortcuts. Your data folder is left in place on purpose so a reinstall keeps
your tasks and notes; delete it manually if you want a clean wipe.
