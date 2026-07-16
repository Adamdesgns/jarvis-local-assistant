# JARVIS Changelog

## Unreleased (command-center-skin branch)

### Added — Command Center skin (switchable)
- New SKIN setting: switch between Classic Amber and a cyan Command Center
  dashboard, saved and applied without a restart. Classic stays the default.
- The Command Center shows real data — CPU/RAM/GPU, projects, tasks, activity,
  and a glanceable cameras panel — and its colour tracks JARVIS's state
  (listening, thinking, speaking, working).
- Command bar, dock, FOCUS mode, and minimize-to-orb all use the real app
  actions; documents open as an overlay. Weather and Network panels are
  coming next.

## Unreleased (autonomy-engine branch)

### Added — Autonomy engine + camera reactions (slice 1)
- New AUTONOMY settings section: master switch plus four rules, all off by
  default.
- JARVIS can speak the doorbell aloud, speak motion alerts, show a
  "someone's here" card with the camera picture, and quiet daytime motion
  pop-ups (night window configurable, default 9 PM–7 AM).
- Autonomy only announces: nothing is sent, spent, deleted, or executed
  without the usual approval card. Everything it does shows in the
  Activity log.

### Fixed
- Ring arm/disarm works: system ids are passed through unchanged instead of
  being coerced to numbers (Ring location ids are non-numeric).

## 0.11.2 — July 14, 2026

### Fixed
- Voice can no longer get stuck at "Starting local voice" forever. The
  service now detects a failed or stalled engine start, restarts it once
  automatically, and otherwise says plainly to run Repair Voice. (The
  engine itself was healthy; the app lost track of it after an upgrade.)
- Long answers are readable: the response box grows with the reply,
  keeps line breaks, and scrolls instead of clipping to one line.

## 0.11.1 — July 14, 2026

### Fixed
- Opening a folder no longer freezes JARVIS: folder opens launch Explorer
  as a detached process instead of a blocking shell call. This freeze was
  also why diagnostics showed the wake word as not ready.
- AI tool calls are wrapped in a timeout and cannot hang a reply forever.
- Approval dialogs clean up their state even if resolving fails.
- Casual greetings ("how are you doing") get a quick local answer instead
  of a full AI round-trip; spoken replies retry when Windows voices load late.

(Credit: explorer fix and hardening from a Codex debugging session; a voice
change from that session that dead-locked wake-word startup was rejected.)

## 0.11.0 — July 13, 2026

- In-app update check (Settings > About & Updates): compares against the
  latest GitHub release and offers a download link. Nothing installs
  automatically. A quiet check runs at launch and notifies only when newer.
- Public repository: https://github.com/Adamdesgns/jarvis-local-assistant
- README rewritten for the public download page.

## 0.10.0 — July 13, 2026

Roadmap sweep: finished Phase 3, and delivered the buildable parts of
Phases 4, 5, and 6.

### Added
- **Document Q&A with citations** (Phase 3.4): "Ask my documents: <question>"
  retrieves the most relevant passages across your approved files and answers
  using only them, citing each claim [1][2] by filename and PDF page or text
  section. Cited files are clickable.
- **Look at my screen** (Phase 4.1/4.2/4.5): captures your screen and describes
  it with the cloud vision model, behind a red "viewing your screen" indicator,
  logged to Activity, with a live action timeline. Refuses clearly with no key.
- **Backup & Restore** (Phase 5.5): export your tasks, notes, folders, and
  routines to a file; import merges without deleting. API keys never exported.
- **Project dashboards** (Phase 5.3): "Show my Anvil dashboard" summarizes one
  project's tasks, notes, and recent files.
- **Privacy & Support docs** (Phase 6.4): PRIVACY.md and SUPPORT.md, bundled in
  the installer.

### Deferred (need heavy downloads or external accounts)
- Playwright browser automation (Phase 4.3/4.4) — ~300 MB browser download.
- Calendar and email integrations (Phase 5.1/5.2) — require OAuth sign-in.
- Code-signing certificate and public repo (Phase 6.3/6.5).

## 0.9.0 — July 13, 2026

### Added
- **Claude Cloud Brain**: Anthropic's Claude models (Haiku 4.5, Sonnet 5,
  Opus 4.8) now sit beside OpenAI and Ollama as a cloud option. Encrypted
  key storage, SAVE KEY & TEST, and a Cloud Provider choice that decides
  which cloud answers when both keys are saved.

### Fixed
- The task list did not refresh when a task was added through the command
  bar or voice (e.g. "add buying pipe dope to my list and tell me
  everything"). The task was saved correctly but the module kept showing
  "NOTHING PENDING" until an unrelated redraw. It now updates immediately.

## 0.8.1 — July 13, 2026

- The assistant brain now follows a Fable-style working prompt: lead with
  the outcome, plain honest sentences, never claim unconfirmed actions,
  check tools before guessing, and route destructive requests to the
  approval-carded commands.

## 0.8.0 — July 13, 2026

Phase 3 of the roadmap: the smarter local brain.

### Added
- Structured tool calling: the local Ollama model can use a documented set
  of safe tools (add tasks, list tasks, save and search notes, search
  files, open approved apps, read the clock) — capped at two tool rounds.
  Destructive and approval-gated actions are deliberately not callable by
  the model; they remain deterministic router commands with approval cards.
- Conversation sessions: follow-up questions work, kept per project; say
  "new conversation" to clear the context. The active project is part of
  the model's context.
- Streaming replies: local answers appear as they generate, with a STOP
  button (or Escape) that cancels cleanly.
- Model size presets: Small (qwen3:4b), Balanced (qwen3:8b), Advanced
  (qwen3:14b), or a custom model name.
- Document Q&A: "Ask my documents: what preheat does P91 need?" retrieves
  excerpts from approved folders and answers only from them, citing the
  source filenames.

### Verification
- 25 automated tests pass; syntax checks pass; audit reports 0
  vulnerabilities.

## 0.7.0 — July 13, 2026

Phase 2 of the roadmap: the daily-assistant release.

### Added
- Recurring tasks: "Remind me to X every day/week/month". Completing a
  repeating task schedules the next occurrence in the future.
- Morning briefing ("Good morning" or the START BRIEFING quick button):
  open and overdue tasks, next due items, latest note, and PC status.
- Task editing: click a title to edit it in place, click the priority chip
  to cycle low/normal/high, and TODAY / PROJECT filters.
- Searchable memory with click-to-edit notes, forget buttons, and the
  "forget about X" voice command.
- File Explorer home view with pinned folders (star button) and the last
  files opened through JARVIS.
- Watch folders (eye button): a Windows notification fires when files in a
  watched folder change, debounced to one notice per real change.
- Saved routines: "Start work" opens the routine's approved apps and
  project folders.

### Fixed
- Broken Windows junctions (Documents\My Music etc.) no longer appear in
  the File Explorer as dead folders.
- The explorer Up button stops at approved roots instead of erroring.

### Verification
- 21 automated tests pass; syntax checks pass; audit reports 0
  vulnerabilities.

## 0.6.1 — July 13, 2026

The 0.6.0 release was built in a cloud workspace that was lost before its
source could be downloaded. 0.6.1 rebuilds that work on Adam's own PC, where
the source is version-controlled with git so it cannot vanish again.

### Added
- Voice Diagnostics panel (Settings → Voice Diagnostics): seven green/red
  checks (microphone permission, microphone device, Python environment,
  speech model, wake-word model, service running, wake word listening),
  a live input-level meter, Test Microphone with transcript playback,
  a 15-second Test "Hey Jarvis", Repair Voice, and Copy Diagnostic Report.
- Module layout engine: drag modules by their header at any time, resize
  from all eight edges and corners, click to bring to front, stacking order
  saved, modules stay inside the workspace, and newly enabled modules look
  for open screen space.

### Fixed
- Install/Repair Local Voice previously launched an invisible PowerShell
  window that could hang forever. It now runs inside the app with each step
  streamed into the Diagnostics panel, and the voice service restarts
  automatically when it finishes.
- Deleting a file is approval-gated to the Recycle Bin (regression test added).

### Verification
- 13 automated tests pass; JavaScript syntax checks pass; the Python voice
  script compiles on Python 3.12; production dependency audit: 0 known
  vulnerabilities. Voice install verified end-to-end on Adam's laptop.

## 0.5.0 and earlier

Built in cloud sessions; see JARVIS-ROADMAP-AND-CLAUDE-HANDOFF.md for the
feature history.
