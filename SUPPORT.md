# JARVIS Support

Short, practical fixes for the most common issues. JARVIS is free software
provided as-is (see LICENSE); there is no paid support line.

## Voice does not work

Open **Settings → Voice Diagnostics**. Green rows are working; red rows say
exactly what to fix. Then:

1. Press **REPAIR VOICE** and wait for it to finish (it installs a small Python
   environment and the free models — a few minutes the first time).
2. Press **TEST MICROPHONE** and say a short phrase; it plays back what it heard.
3. Press **TEST "HEY JARVIS"** to confirm the wake word.
4. If anything is still red, press **COPY DIAGNOSTIC REPORT** and keep it — it
   describes the failing layer and contains no personal data or secrets.

## The Cloud Brain will not connect

- Make sure you pasted the key for the matching provider (OpenAI keys start with
  `sk-`; Anthropic keys start with `sk-ant-`).
- Cloud Brains use **prepaid API credit**, which is separate from any ChatGPT or
  Claude subscription. Add credit on the provider's billing page.
- Press **SAVE KEY & TEST**; the error message tells you what the provider
  rejected.

## Ollama (local conversation) is offline

Your tasks, notes, and file tools still work without it. To enable local
conversation, install [Ollama for Windows](https://ollama.com/download/windows),
then in Settings press **CONNECT / REPAIR OLLAMA**.

## Modules moved somewhere I can't reach

Open the **MODULES** menu → **RESET DEFAULT LAYOUT**.

## Where is my data?

See PRIVACY.md. Everything is under `%APPDATA%\jarvis-local-assistant`.

## Reporting a problem

Note the JARVIS version (Settings footer), what you did, and what happened. If it
is voice-related, include the diagnostic report. Keep a backup of your data via
**Settings → Backup & Restore → Export My Data** before troubleshooting.
