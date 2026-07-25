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

- [x] **THE TERMINAL, stage 1: the module** — an in-app terminal panel, matrix-rain
      styled, themed to the active skin AND the chosen orb accent (gold/obsidian —
      read `orbSkin`/`orbColor` settings). Stage 1 is a JARVIS console: live feed of
      agent steps, activity, night-shift log, with command input routed to JARVIS
      itself (same pipeline as the command bar). NO raw shell in stage 1.
      **Done 2026-07-25** on branch `terminal`, merged. `src/terminal-log.js` (pure,
      14 tests) + `src/terminal-ui.js` (rain + append-only view) + a `terminal`
      module in the renderer. Rig at `test/rigs/terminal.html` — serve the repo
      root and open it; `rain.renderOnce()` paints a frame without rAF so the
      canvas can be checked in a background tab.
- [x] **THE TERMINAL, immersive pass** — **Done 2026-07-25** (`0ba845d`), Adam's ask:
      a FULL button (Esc exits) puts the console on the whole window via
      `body.terminal-full`, and the rain got named intensity levels — brighter in
      the module, `bold` at fullscreen, with glowing white heads. `rainStyle()` is
      pure and tested. Guards: closing the console exits fullscreen first, and
      Defense Mode drops it on entry so two fullscreen layers never stack.
- [ ] **THE TERMINAL, stage 2: real commands** — user-typed Windows commands run in
      the terminal (user-driven only; the AI still never gets arbitrary shell).
      Confirm-card before anything destructive. Display-only for AI output.
      **Build notes from the 2026-07-25 research pass — read before starting:**
      - Scaffolding to reuse, do NOT rebuild: `shellHint()`/`SHELL_WORDS` in
        `src/terminal-log.js` is the classifier seed and the seam is already cut
        at the renderer's `submit()`; `showApproval()` + `resolveApproval` is the
        confirm-card pattern; `core/tool-service.js` is the safe-spawn precedent
        (argv array, `shell:false`); `core/screen-guard.js`'s frozen DENY/APPROVE
        regex tiers are the exact mold for the command classifier.
      - **Settle the name collision first.** `core/defaults.js` registers an app
        named `terminal` (`wt.exe`), so "open terminal" already launches Windows
        Terminal *externally* while the in-app module is also called terminal.
        Harmless until stage 2 gives the module command execution — then one of
        the two routes bypasses the confirm card. Decide the wording in the spec.
      - cwd policy ties to `documentService.approvedRoots()`; needs a real deny
        list (format, `del /f`, reg, bcdedit, vssadmin, net user), a timeout/kill
        for hung processes, and `unattendedSafe: false` (the guard test enforces).
- [x] **0.18.0 release stamp** — version bump + CHANGELOG entry covering the merged
      pile (orb souls everywhere, tabbed settings, Night Shift, battle mode).
      Done 2026-07-24: package.json was already 0.18.0 via the Pro merge; the
      CHANGELOG now covers the whole pile, and the NSIS installer's hardcoded
      0.11.2 was replaced with a single `JARVIS_VERSION` define guarded by
      `test/installer-version.test.js`.

## NEXT

- [x] **THE BROWSER, stage 1: surf inside JARVIS** — **BUILT 2026-07-25** (branch
      `browser-stage1`, unmerged). `<webview>` (NOT WebContentsView — it would paint
      over approval cards) + main-process wall: `core/browser-guard.js` rewrites
      every attach (no preload, forced `persist:jarvis-browser` partition, no node),
      permissions deny-all, downloads blocked, http/https only, new windows → tabs,
      cap 5. Chrome in `src/browser-tabs.js` (pure, tested) + `src/browser-ui.js`;
      rig `test/rigs/browser.html`. Live webview check is Adam's hands-on pass.
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

- [x] **DEFENSE MODE phases 1–3 BUILT** *(2026-07-25, branch `defense-mode`, unmerged)* — the
      situation-board posture: every camera live on a fullscreen wall, banner naming the
      trigger + time, Esc/"stand down" always exits. NWS county alerts (warning tier only)
      + opt-in auto-triggers with the 15-second announce-and-wave-off, RSS headlines, and
      the spoken read. HARD RAILS tested: watches and tells / allowlisted network /
      no unattended entry / rides the camera Pro gate. Spec + plan in `docs/superpowers/`.
- [ ] **DEFENSE MODE phase 4** — live video in the board via a saved stream URL;
      depends on THE BROWSER above.
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
