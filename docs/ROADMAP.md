# JARVIS Roadmap — the Night Crew's work queue

This is the build queue for overnight autonomous sessions ("the night crew") and
the product's future-updates list. The human-facing master copy lives in Adam's
vault; this repo copy is what the night crew reads and updates.

**Rule: every release headlines ONE wow feature** people can see in a
screenshot or a 15-second clip, plus quiet fixes underneath.

## How the night crew works this list

- Pick the TOPMOST unchecked item in NOW (or its next unchecked stage).
- Branch `night/YYYY-MM-DD-<slug>` off `main`. NEVER commit to `main`.
- TDD like the rest of this repo (node:test, pure modules, `npm test` green).
- Check the box here (on your branch), write `docs/night-reports/YYYY-MM-DD.md`
  (what shipped, how to try it, what's left), push the branch, stop.
- Too big for one night? Build a clean slice, leave the box unchecked, and say
  exactly where you stopped in the report.

## NOW

- [ ] **THE TERMINAL, stage 1: the module** — an in-app terminal panel, matrix-rain
      styled, themed to the active skin AND the chosen orb accent (gold/obsidian —
      read `orbSkin`/`orbColor` settings). Stage 1 is a JARVIS console: live feed of
      agent steps, activity, night-shift log, with command input routed to JARVIS
      itself (same pipeline as the command bar). NO raw shell in stage 1.
- [ ] **THE TERMINAL, stage 2: real commands** — user-typed Windows commands run in
      the terminal (user-driven only; the AI still never gets arbitrary shell).
      Confirm-card before anything destructive. Display-only for AI output.
- [ ] **0.18.0 release stamp** — version bump + CHANGELOG entry covering the merged
      pile (orb souls everywhere, tabbed settings, Night Shift, battle mode).

## NEXT

- [ ] **THE BROWSER, stage 1: surf inside JARVIS** — embedded browser module
      (WebContentsView/webview): address bar, back/forward, tabs, chrome styled to
      skin + orb accent. Walled off from JARVIS internals: isolated session/partition,
      no nodeIntegration, no preload leakage, downloads + mic/camera permissions
      locked down. Web pages are strangers in the house.
- [ ] **THE BROWSER, stage 2: JARVIS reads the page** — "summarize this page",
      grounded answers from the current tab only.
- [ ] **MORE MAINFRAME SKINS** — full-window themes beyond Classic amber and
      Command Center blue: Retro (the old scanline/CRT look, it's in git history),
      Matrix (pairs with the terminal), obsidian mono. `body[data-skin]` already
      supports this; each skin is mostly CSS + a settings option.
- [ ] **EVERY ORB GETS ITS OWN PERSONALITY** *(Adam, 2026-07-24)* — the eight souls are
      looks only today. The chosen soul should also decide who JARVIS *is*: voice pick,
      phrasing, how clipped or chatty, greeting and wake response. Picking Starfield vs
      Plasma should feel like a different character, not different wallpaper. Design
      first (one dial vs a written character per soul; system prompt vs voice vs both).
      HARD RAIL: personality changes tone only — never permissions, never the wording of
      approval/safety cards, never what unattended runs may do.
- [ ] **Cinematic orb souls, round 2** — volumetric nebula w/ god rays, liquid-metal
      ferrofluid, glass caustics, storm core w/ lightning, galaxy spiral.
      (Electron offscreen rendering: NO bufferless gl_VertexID draws — a prior
      WebGL variant hard-crashed the renderer. Conventional WebGL or canvas-2D.)
- [ ] **Kokoro voice wiring** — Voicebox v0.5.0 is installed; wire it, pick preset.

## LATER

- [ ] **THE CREW — a team of agents, JARVIS as lead** *(Adam, 2026-07-26)* — the eight
      orb souls stop being looks and become **specialists**: a files hand, a night-shift
      worker, a watcher on the cameras, a researcher. JARVIS stays the lead — you always
      talk to JARVIS, and JARVIS decides who on the crew takes the job and reports the
      answer back in his own voice. Cycle the orb on the widget/hologram screen to see who
      is currently working: the orb wears that crew member's soul while they hold the job,
      then settles back to JARVIS. Builds directly on **EVERY ORB GETS ITS OWN PERSONALITY**
      (NEXT) — do that one first; a crew of characters is worthless if the characters
      aren't written yet.
      Design questions to settle before any code: is a crew member a *system prompt +
      voice* (cheap, safe, ships soon) or a *separate tool allowlist + its own agent loop*
      (real delegation, much bigger)? Does the user pick the specialist, or does JARVIS
      route silently? What does the orb do when two are working at once?
      Prerequisite: the **activity-log `actor` field** — the log has to be able to say
      *which* crew member did a thing before more than one of them can act.
      HARD RAILS: a crew member is never a way around a permission. Every approval card,
      approved-folder boundary, and `unattendedSafe: false` guard applies identically to
      every member — no specialist gets powers JARVIS himself doesn't have, and no crew
      member may hand a job to another to escape a confirmation. Local mode still works
      with the whole crew.
- [ ] **THE BROWSER, stage 3: JARVIS surfs for you** — folded into the Hands v2
      track: plan cards, STOP window, hard blocks on banking/sign-in pages.
- [ ] **Hands v2** — Chrome behind a dedicated clean profile (CDP), wider app allowlist.
- [ ] **JARVIS DESKTOP mode** — fullscreen live-in mode: orb centerpiece, launcher,
      files, browser, terminal, cameras, voice. The road to "JARVIS OS".
- [ ] **JARVIS OS (endgame)** — shell replacement (registry Shell swap). Hard
      requirements: bulletproof one-keypress escape hatch to Explorer, crash-proofing,
      opt-in only. Reframes JARVIS from app to way-of-using-your-computer.
- [ ] **Autonomy slices 2+4** — proactive day, multi-step unattended brain.
- [ ] **Event-triggered night jobs** — react to events, not just the clock.
- [ ] **Phone:** "hand me a file", Siri Shortcut wake, live camera video.
- [ ] **Camera v1.1:** clip browser, two-way talk, Nest Pub/Sub alerts.
- [ ] **Command Center panels:** Weather + Network.

## Hard rules for ALL overnight work (non-negotiable)

- Local mode stays the default experience; never plain-text keys (safeStorage);
  no arbitrary model-generated shell; approved-folder limits enforced in the
  Electron main process; confirmations for destructive actions; don't weaken
  Windows security. New actuating tools are `unattendedSafe: false` until a
  human says otherwise (the guard test enforces this).
- Branches only. Never push to `main`. Never tag or release.
- All tests green before pushing (`npm test`); add tests for new pure logic.
