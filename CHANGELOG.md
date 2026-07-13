# JARVIS Changelog

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
