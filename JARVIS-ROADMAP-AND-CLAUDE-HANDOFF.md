# JARVIS Roadmap and Claude Handoff

Updated: July 13, 2026  
Current release: 0.10.0  
Primary user: Adam — a programming novice. Explain every manual step in plain English, one action at a time.

## Roadmap status (as of 0.10.0)

Everything buildable-and-testable locally is DONE. Phases 1, 2, 3 complete.
Phase 4: screen vision + privacy indicator + action timeline done; browser
automation deferred. Phase 5: backup and project dashboards done; calendar,
email, smart-home need external OAuth/integrations. Phase 6: privacy/support
docs done; the rest needs a purchase, hosting, or a clean VM.

## What genuinely remains (each needs something outside the code)

- **Playwright browser tools (4.3/4.4)** — pulls a ~300 MB browser; decide if
  that's acceptable for the free giveaway before building.
- **Calendar (5.1) and Email (5.2)** — require Google/Microsoft OAuth sign-in
  that only Adam can complete; build the tool, Adam authorizes.
- **Smart-home (5.4)** — needs specific device APIs/allowlists.
- **In-app updater (6.2)** — needs a hosting URL to publish an update feed.
- **Code-signing certificate (6.3)** — a purchase; removes SmartScreen warnings.
- **Public repo + checksums (6.5)**, **clean-VM test (6.1)** — manual.

Note: Phases 1–3 and the buildable parts of 4–6 are complete (see CHANGELOG.md).

## The goal

Build a useful, cinematic Windows personal assistant that is free by default, runs locally, tracks Adam's work, remembers notes, finds and opens files, and performs approved computer actions. It should feel inspired by a futuristic JARVIS interface without pretending to be fully autonomous or bypassing Windows security.

The default experience must not require API credits. Ollama supplies local conversation. An optional separately billed OpenAI API connection exists for users with slower GPUs or users who want stronger reasoning.

## What works now

- Electron desktop application with a cinematic amber holographic sphere.
- Floating always-on-top sphere widget when minimized.
- Local tasks, reminders, project context, memories, and activity history.
- Approved-folder file search, visible explorer, ranked matches, and file opening.
- PDF, DOCX, XLSX, CSV, text, Markdown, JSON, and common code-file reading.
- Document summaries and content search.
- Safe creation of notes, folders, and Markdown reports.
- Approval cards before copy, move, rename, organization, Recycle Bin, shutdown, or similar actions.
- Ollama local conversation using an installed compatible model; currently defaults to `qwen3:8b`.
- Optional OpenAI Cloud Brain using encrypted Windows credential storage.
- Free local speech recognition with faster-whisper.
- Free local “Hey Jarvis” wake word with openWakeWord.
- Removable floating modules that drag, resize from eight directions, stack, and save their layout.
- Windows installer named `JARVIS-FREE-SETUP.exe`.

## Release 0.6.0 repair status

The following problems were repaired:

- Dragging no longer puts the module several inches behind the cursor.
- Modules move without turning on Edit Layout.
- Modules resize from every edge and corner with the appropriate cursor.
- Interaction is rendered once per animation frame for smoother movement.
- Modules stay within the usable workspace.
- Clicking a module brings it to the front, and stacking order is saved.
- Newly enabled modules attempt to use open screen space.
- Explorer navigation stops at approved roots.
- Explorer item counts, displayed paths, and Windows directory junctions are corrected.
- Local voice setup only reports success after every dependency and model is actually ready.
- The correct openWakeWord model name, `hey jarvis`, is used.
- Voice failures are visible in Settings, and the service automatically restarts.

Verification at handoff:

- 16 automated tests pass.
- JavaScript syntax checks pass.
- Python voice script compiles.
- Production dependency audit reports zero known vulnerabilities.
- The 0.6.0 installer passed a complete 7-Zip/NSIS archive test: 142 files verified.
- Installer SHA-256: `99ac5574187bf06fb0a12684c3029ac04669c3eb31dcc885c523f7c386a47f1a`

## Roadmap

### Phase 1 — Stabilize 0.6.x

Do this before adding major features.

1. Test 0.6.0 on Adam's actual Windows laptop.
2. Confirm drag and resize behavior at 100%, 125%, and 150% Windows display scaling.
3. Confirm modules remain usable after changing screen resolution or connecting a second monitor.
4. Test fresh local-voice installation and repair installation.
5. Add a simple microphone test showing live input level, transcription, and detected wake phrase.
6. Add a Diagnostics page with large green/red checks and a one-click “Copy Diagnostic Report” button.
7. Correct the README so it describes the single EXE installer and always-available module movement.

Definition of done: Adam can install it, connect Ollama, repair voice, move modules, and diagnose failures without opening PowerShell.

### Phase 2 — Better daily assistant

1. Add recurring tasks and reminder notifications.
2. Add a morning briefing: due tasks, recent files, project notes, calendar summary when connected, and PC status.
3. Add task editing, priorities, due-date filters, and project filters.
4. Add searchable memory with edit and forget controls.
5. Add pinned folders and recent files inside File Explorer.
6. Add “watch this folder” and notify when matching files change.
7. Add saved routines such as “Start work” that open approved apps and folders.

### Phase 3 — Smarter local brain

1. Replace long router conditionals with a structured tool-calling layer.
2. Give Ollama a documented set of safe tools rather than unrestricted shell access.
3. Add conversation sessions and project-specific context.
4. Add retrieval over selected documents with a local index and citations to filenames/pages.
5. Let the user choose small, balanced, or advanced Ollama model presets based on available RAM/VRAM.
6. Add response cancellation and streaming so JARVIS feels immediate.
7. Keep deterministic commands—file operations, tasks, approvals—outside the model whenever practical.

### Phase 4 — Screen and browser assistance

1. Add an explicit “Look at my screen” action with a visible privacy indicator.
2. Explain screenshots locally when a compatible vision model is installed; optionally use Cloud Brain.
3. Add Playwright browser tools limited to approved sites and actions.
4. Require confirmation before form submission, posting, sending, purchasing, or account changes.
5. Show a live action timeline: what JARVIS is viewing, planning, and doing.

### Phase 5 — Integrations

1. Calendar read access and optional event creation with confirmation.
2. Email summaries and drafts; never send without confirmation.
3. Anvil, The Bench, and Adamscraft project dashboards.
4. Optional smart-home tools with device allowlists.
5. Import/export settings and encrypted backup of user-created data.

### Phase 6 — Giveaway quality

1. Test on a clean Windows virtual machine and on PCs without developer tools.
2. Add an in-app updater or a simple signed update installer.
3. Purchase a code-signing certificate when distribution volume justifies it.
4. Add license, privacy statement, clear data locations, uninstall behavior, and support instructions.
5. Create a public repository with reproducible build instructions and release checksums.
6. Never bundle Ollama models without verifying their licenses and redistribution terms.

## Non-negotiable product rules

- Free local mode remains the default.
- Do not require a ChatGPT subscription; ChatGPT subscriptions do not include API usage.
- Never store an OpenAI key as plain text. Continue using Electron `safeStorage`.
- Never allow arbitrary model-generated PowerShell or shell commands.
- Approved-folder boundaries must be enforced in the Electron main process, not only in the interface.
- File deletion goes to the Recycle Bin and requires approval.
- Sending messages, email, purchases, account changes, shutdown, and destructive actions require explicit confirmation.
- Do not silently weaken Windows Defender, Smart App Control, or other security controls.
- Preserve existing user settings and data during updates.
- Keep one obvious giveaway file: `JARVIS-FREE-SETUP.exe`.
- Instructions for Adam must be very short and literal. Do not say “run the script” without stating exactly where it is and what to click.

## Technical map

| Area | Files |
|---|---|
| Electron lifecycle, windows, IPC, tray | `main.js` |
| Safe renderer API | `preload.js` |
| Interface | `src/index.html`, `src/styles.css`, `src/renderer.js` |
| Sphere animation | `src/hologram.js` |
| Module geometry | `src/layout-engine.js` |
| Commands and approvals | `core/router.js`, `core/security.js` |
| File/application tools | `core/tool-service.js` |
| Document operations | `core/document-service.js` |
| Ollama | `core/ollama-service.js`, `core/ai-service.js` |
| Voice supervisor | `core/local-voice-service.js` |
| Python voice worker | `scripts/local_voice.py` |
| Voice installer | `scripts/setup-local-voice.ps1` |
| Settings and migration | `core/defaults.js`, `core/config-store.js` |
| Installer | `scripts/jarvis-installer.nsi` |
| Automated tests | `test/` |

## Development commands

From the `JARVIS-V2` project folder:

```bash
npm install
npm test
npm start
```

Before releasing, run:

```bash
node --check main.js
node --check preload.js
node --check src/renderer.js
node --check src/layout-engine.js
python3 -m py_compile scripts/local_voice.py
npm test
npm audit --omit=dev
```

The current custom Windows build process is:

```bash
HOME=/tmp/jarvis-home \
XDG_CACHE_HOME=/tmp/jarvis-cache \
ELECTRON_CACHE=/tmp/jarvis-cache/electron \
ELECTRON_BUILDER_CACHE=/tmp/jarvis-cache/electron-builder \
./node_modules/.bin/electron-builder --win dir

cd scripts
/tmp/jarvis-cache/electron-builder/nsis-3.0.4.1/nsis-3.0.4.1-1mx3n/linux/makensis -V2 jarvis-installer.nsi
```

Output: `dist/JARVIS-FREE-SETUP.exe`

If Claude is working directly on Windows, it may use the installed NSIS `makensis.exe` instead of the Linux cache path. Do not replace the custom installer with electron-builder's default installer without checking the giveaway experience.

## Known risks and likely next bugs

- Voice installation depends on Python 3.12, pip packages, model downloads, microphone permission, and Windows audio devices. Diagnostics must identify which layer failed.
- Display scaling and multiple monitors are the most likely sources of remaining module movement problems.
- openWakeWord's stock phrase is “Hey Jarvis,” not necessarily the single word “Jarvis.” Do not promise the single-word trigger until a compatible custom model is tested and licensed.
- faster-whisper currently uses CPU INT8 for compatibility. GPU transcription can be a later optional preset after installer testing.
- The renderer is becoming large. New features should be extracted into focused modules instead of continuing to expand one file.
- Search currently scans approved locations directly. Large folders will eventually need a cancellable local index.
- Ollama model output must never be treated as permission to perform a sensitive action.

## Instructions for Claude

1. Read this file, `README.md`, and `CHANGELOG.md` first.
2. Inspect the relevant code before changing anything.
3. Do not rewrite the application from scratch.
4. Preserve Adam's existing behavior and unrelated changes.
5. Fix one bounded issue at a time and add a regression test whenever possible.
6. Run the full test suite after every meaningful repair.
7. Do not claim a Windows feature works merely because the code compiles on Linux; state what still needs testing on Adam's laptop.
8. Update the version and changelog only when producing a real installer.
9. Give Adam one instruction at a time when he must do something manually.
10. At the end, provide: what changed, what was tested, the exact installer path, and the first three simple things Adam should test.

## Copy-and-paste prompt for Claude

```text
You are continuing the JARVIS V2 Windows desktop-assistant project. Start by reading JARVIS-ROADMAP-AND-CLAUDE-HANDOFF.md, README.md, and CHANGELOG.md in the JARVIS-V2 folder. The current release is 0.6.0.

Adam is a complete programming novice. Speak plainly, give one literal manual step at a time, and do as much of the technical work yourself as possible. Do not tell him to “run a script” without giving the exact filename, folder, and click/command.

Preserve the free local-first design: Electron interface, Ollama conversation, faster-whisper speech recognition, openWakeWord “Hey Jarvis,” approved-folder file tools, confirmation for sensitive actions, and the single JARVIS-FREE-SETUP.exe giveaway installer. Never add unrestricted shell execution, weaken Windows security, store keys in plain text, or confuse a ChatGPT subscription with OpenAI API credits.

First inspect the current files and run npm test. Then continue with this task:

[PASTE THE NEW TASK HERE]

Implement the smallest complete fix, add regression coverage, run all verification, and clearly separate what was automated from anything that still needs real Windows testing.
```

## Immediate recommended next task

Build a novice-friendly **Voice Diagnostics** panel before adding new assistant powers. It should show:

- Microphone permission: green or red.
- Selected microphone and live input level.
- Python voice environment installed: green or red.
- Speech model available: green or red.
- Wake-word model available: green or red.
- Background voice service running: green or red.
- A “Test Microphone” button that records a short phrase and displays the transcription.
- A “Test Hey Jarvis” button that listens for the trigger for 15 seconds.
- A “Repair Voice” button.
- A “Copy Diagnostic Report” button that omits secrets and personal document contents.

This is the highest-value next step because it turns the hardest part of setup into something Adam can understand and fix without coding.
