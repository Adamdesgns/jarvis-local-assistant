# JARVIS Changelog

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
