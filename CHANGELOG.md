# JARVIS Changelog

## 0.20.0 — August 6, 2026

### Added — the ULTRON orb, and voices that actually move the orbs
- A ninth skin: **Ultron** — a rotating holographic wireframe sphere with four
  bright cross meridians, a hot equator band, a counter-rotating shell of
  partial arcs, a fast spiral core, a surging center, orbiting debris,
  drifting code-text, and scan rings. Ported to plain canvas from the
  MIT-licensed ULTRON orb by Sagar Tamang. Pick it in Settings → Orb.
- **Talking now moves every orb, not just brightens it** — the voice level
  accelerates each skin's animation clock, so speech reads as rings spinning
  up, plasma churning, filaments racing, the constellation swirling.
- **The floating orb finally hears the voice too**: levels are relayed to the
  widget window, so the minimized orb moves while JARVIS speaks and listens
  instead of sitting still.

### Added — cinematic finishing pass for every orb skin
- All eight orb skins now get a shared post-FX layer (`src/orbs/orb-fx.js`)
  applied after their final composite: a faint chromatic-aberration fringe at
  the orb's edge, a warm (gold) / cool (obsidian) color grade, a subtle ±1%
  flicker, and a soft vignette on large canvases. Adapted from the
  MIT-licensed ULTRON orb by Sagar Tamang. The floating widget keeps the full
  effect at every size it can reach; only the 64px defense sentinel drops to
  grade-only. Everything scales down with the dim/error state and the flicker
  is suppressed under reduced motion. Plasma's WebGL renderer does the
  equivalent pass in-shader.
- Every skin's brightness now rides a rare "surge" envelope — mostly calm
  with occasional dramatic swells, noticeably livelier while thinking.
  Starfield also gains a scan ring sweeping the sphere's latitudes.
- New shared helper module `src/orbs/orb-utils.js` consolidates the math the
  skins used to copy-paste (seeded RNGs, color mixing, easing) plus the new
  envelope helpers, with unit tests (`test/orb-utils.test.js`).

### Fixed — orb performance
- The Original skin was silently rendering twice per frame forever: its
  constructor started one animation loop and the host's synchronous unpause
  started a second. It now renders once.
- Six skins (classic, starfield, zen, neural, aurora, original) kept
  animating at full rate while their window was hidden; they now stop on
  `visibilitychange` and resume on return, like halation and plasma always
  did.

## 0.19.0 — August 3, 2026

### Added — FAMILY CALLS: video-call JARVIS JR over Tailscale
- Pair once in Settings → CALLS (show a 6-digit code on one PC, type it on the
  other), then call from the strip above the camera grid. Two-way video +
  audio via WebRTC, PC-to-PC over the tailnet — no cloud, no accounts, no cost.
- The line is a second Tailscale-only server (port 27184, mobile-server mold):
  refuses to start without Tailscale, one paired peer, shared-secret auth on
  every request, one call at a time. This build never auto-answers; the
  JR build's 20-second auto-answer arrives with the kid-side release.

### Fixed — PRIVACY.md now describes what the app actually does
- Rewritten from the code rather than from intent. The old version was last
  edited 2026-07-24, before the Kokoro voice shipped and before the Pro gate was
  removed, and it was **wrong in seven places** — including its central promise.
- **"Local mode sends nothing off the PC" was false.** The default TTS engine is
  Kokoro, whose model (~326 MB) is downloaded from huggingface.co. Setting up
  local voice also downloads the openWakeWord `hey_jarvis` model and a
  faster-whisper model. A fresh install talks to the internet before you enable
  anything. There is now a dedicated "What gets downloaded the first time"
  section saying so.
- **"API keys are never written in plain text" was conditionally false.** Only
  the OpenAI key refuses to save when Windows secure storage is unavailable;
  every other secret silently falls back to plain text in `settings.json`. The
  page now names that hole instead of glossing it.
- **Whole features were missing from "what leaves your computer":** cloud
  cameras (Ring, Blink at `rest-prod.immedia-semi.com`, Nest via Google), the
  Browser module (every page you visit, plus DuckDuckGo for typed searches), and
  the mobile companion's Tailscale-bound server.
- **The Pro/Lemon Squeezy section described a product that no longer exists.**
  Replaced with the honest position: the buttons are gone, but the code that
  could reach `api.lemonsqueezy.com` is still present and still wired to
  internal channels, and never runs on its own.
- **The conversation record was undocumented.** JARVIS keeps a rolling
  plain-text transcript of both sides for ~2 days; that now has its own section
  explaining what it is and how to delete it.
- The data-folder listing was incomplete — `schedules.json`, `crash.log`, the
  dated transcript files, and `cameras\` were all missing.

### Removed — 223 MB of ffmpeg that never did anything
- The installer no longer carries `ffmpeg-for-homebridge`'s binary. It arrived
  as a transitive dependency (`ring-client-api` → `@homebridge/camera-utils` →
  `ffmpeg-for-homebridge`) and was packed twice, once as `ffmpeg.exe` and once
  as its own download cache — **223 MB for something no line of JARVIS ever
  called.** The installer drops from 282 MB to 209 MB.
- **Cameras are unaffected**, because none of them used it: local and Nest
  cameras hand a plain `rtsp://` URL to `go2rtc.exe`, and Ring's live view
  sends the renderer's WebRTC offer straight to Ring's cloud with no local
  helper at all. `ring-client-api`'s ffmpeg features (`streamVideo`,
  `recordToFile`) are the ones that need it, and JARVIS calls neither — it
  never even calls `setFfmpegPath`.
- **The binary goes, the JS module stays.** `@homebridge/camera-utils` does a
  static top-level `import` of `ffmpeg-for-homebridge`, so deleting the whole
  package would break that import and take Ring down with it. The package's own
  `index.js` checks whether the binary exists and exports `undefined` when it
  doesn't, and camera-utils then falls back to `'ffmpeg'` on PATH — a missing
  binary is an anticipated state, not a crash. Verified by renaming the binary
  away and re-running everything: 798/798 tests, 25/25 camera tests, and a load
  probe across camera-utils, ring-client-api, and JARVIS's own Ring driver.
- **Why it matters beyond size:** the binary is built `--enable-gpl
  --enable-nonfree` and declares no licence. FFmpeg's own documentation says
  nonfree builds are unredistributable, so shipping it in a public download was
  never legal regardless of GPL compliance. Harmless on your own machine;
  a blocker for any published release.
- Not yet confirmed against real hardware: a live Ring stream. The code path is
  proven, the account test is Adam's.

### Added — THE BROWSER (stage 1): surf inside JARVIS
- A new **Browser** module (Modules → Browser): tabs (up to five), address bar,
  back/forward/reload, dressed in your skin with the active-tab underline in
  your orb's colour. Type an address or just type words — words become a
  DuckDuckGo search.
- **Web pages are strangers in the house.** Every page runs in its own
  walled-off session with no path to JARVIS's files, settings, keys, or
  controls — enforced in the main process, not by politeness.
- **Deny by default:** pages asking for camera, mic, or location are refused
  automatically (you'll see a quiet note). Downloads are switched off entirely
  for now. Links that try to open new windows open new tabs instead, and only
  real web addresses load — nothing from disk, ever.

### Added — DEFENSE MODE: when something is wrong, the whole window is the situation board
- Say **"defense mode"** (or press the new ⛨ button in the bar) and the desk
  drops away: **every camera goes live at once** on a fullscreen wall, with a
  red banner naming exactly what fired and when. **Esc always exits** — so does
  "stand down."
- **JARVIS rides the banner as a red sentinel** — whichever orb soul you run
  goes crimson while the mode is up, and he still reacts: listening, thinking,
  speaking. Your normal gold or obsidian comes back the moment you stand down.
- A side rail shows the **active National Weather Service alert** for your
  county — straight from the source, free, no account — plus **local headlines**
  from RSS feeds you pick in Settings → CAMERAS.
- JARVIS **reads the situation aloud once** on entry: what fired, what the
  official alert says to do, what the headlines say. Local brain by default,
  cloud only if you already set a key.
- **Opt-in automatic triggers, both OFF by default:** a severe-weather
  *warning* for your county (never a watch), or camera motion at night while a
  system is armed. Every automatic entry **announces itself with a 15-second
  wave-off** — no silent takeovers, ever.
- **Hard rails, welded in and tested:** defense mode watches and tells — it
  never calls anyone, never dials emergency services, never arms or disarms
  anything. It talks only to the weather service and the feeds you saved, and
  scheduled/overnight runs can never enter it. Cameras are Pro, so defense mode
  rides the same license.

### Added — THE TERMINAL (stage 1): watch him think
- A new **Terminal** module. Turn it on from Modules. Matrix rain falls behind
  it in **whichever colour your orb is wearing** — gold sphere, gold rain;
  obsidian sphere, mint rain.
- It's a console onto JARVIS: what you asked, what he answered, the steps he
  took, new activity, and what the night shift got up to — each line stamped
  with the time and tagged with where it came from.
- **Type in it and it talks to JARVIS**, exactly as the command bar does. Voice,
  command bar and console all land in the same place.
- **No raw Windows commands yet** — that's stage 2. Type `npm install` or `dir`
  and it tells you so plainly rather than pretending to understand. Plain
  English like "type hello into notepad" still works normally.
- The rain only runs while the module is on screen, and stops completely under
  REDUCED MOTION or Windows' own "reduce motion" setting.

## 0.18.0 — July 24, 2026

### Added — JARVIS Pro: a $29 one-time unlock for the bells and whistles
- The core assistant stays **free forever**: voice, tasks, briefings, file
  search, document Q&A, both brains, and Ask Claude.
- **Pro** ($29 once, no subscription, up to 3 PCs) unlocks: cameras, the phone
  companion, scheduled tasks, autonomy, screen reading, "look at my screen,"
  screen driving, and night shift.
- New Settings → PRO tab: paste the license key from your purchase email and
  press ACTIVATE. CHECK LICENSE and DEACTIVATE THIS PC (frees the seat for
  another machine) sit beside it. Gated toggles wear a small PRO badge.
- **Privacy kept intact:** activation is one call to Lemon Squeezy when you
  press the button — never automatic, never on a timer. Once activated,
  JARVIS stays licensed **fully offline, forever**; a network failure can
  never lock a paid feature. See PRIVACY.md.
- Honest migration: if you had Pro features switched on before this version,
  your settings are left exactly as they were — the features pause until a
  license is activated, then come back to life with no reconfiguring.
- Enforced in code, not politeness: the license gate lives in the main
  process (`core/license-gate.js`, same discipline as screen-guard), the
  renderer cannot write license state, and mutation-style tests fail if any
  gate is deleted.

### Added — Choose your JARVIS: eight orb souls
- The sphere is no longer one look. Pick from **Classic, Plasma, Neural, Zen,
  Halation, Aurora, Starfield** or the **Original** ball, in **gold** or
  **obsidian** — Settings → GENERAL, with a live preview.
- Your choice follows you everywhere: the main window, the floating
  minimize-orb on your desktop, and the phone companion (which can also just
  say "match the desktop").
- Shape and colour are separate choices, so any soul works in either colourway.

### Added — Night Shift: he works while you sleep
- Turn it on in Settings → NIGHT SHIFT and JARVIS runs jobs between midnight
  and 6am, leaving **drafts** for you to read in the morning.
- **It cannot send and cannot delete** — drafts only, by design. There are caps
  on jobs per night and minutes of work, and the **cloud spending limit starts
  at $0** until you deliberately raise it.
- A quiet **heartbeat** checks in periodically during the day and speaks only
  when something genuinely needs you — card-only during quiet hours, and it
  mentions a finding once instead of nagging.

### Added — Battle mode
- Say **"battle me"**, "rap battle" or "spit some bars" and JARVIS trades
  verses with you. Keeps it PG-13.

### Changed — A new look, top to bottom
- One **design-token system** now drives every colour, size and animation
  curve in the app, so nothing drifts out of step again.
- The window went **pitch black with glass panels**. The old hacker-console
  scanlines, corner notches and 6px micro-text are gone.
- The **command bar can be closed** now — shut it and just talk to him.
- Animation is yours to pick: FULL CINEMATIC, FAST, or REDUCED MOTION (and
  the system "reduce motion" setting is respected automatically).

### Changed — Settings split into eight tabs
- The one long scroll is now **GENERAL · BRAINS · CAMERAS · AUTOMATION ·
  ABILITIES · PHONE · PRO · SYSTEM**. Everything saves exactly as before.

### Changed — Cameras: the picture is the tile
- The camera grid shows the picture itself as the tile instead of a label with
  a thumbnail bolted on.
- **Signing cameras in now lives in Settings → CAMERAS**, not in the camera
  module. The module is for watching; Settings is for linking. The module's
  ADD button takes you straight there.

### Fixed
- **The installer reported the wrong version.** It hardcoded 0.11.2 while the
  app had moved on to 0.18.0, so Windows "Installed apps" showed a version
  seven releases old. There is now one version string and a test that fails the
  build if it ever drifts from package.json again.
- **Camera sign-in forms all painted at once.** A `display:flex` rule outranked
  the browser's own "hidden" rule, so switching brand tabs never actually hid
  anything and all four forms stacked on top of each other.
- **The Modules drawer clipped with no way to scroll** — the overhaul had
  dropped its scrolling rule.
- **Long toggle descriptions ran into the next setting's title** (Night Shift's
  text collided with HEARTBEAT). Rows can grow now instead of being pinned to a
  fixed height.
- **The schedule list rendered with stray bullets and wrong indentation**, and
  DOWNLOAD UPDATE could appear on boot when there was no update. Both were the
  app's own security policy silently blocking inline styles — the renderer
  console is completely clean now, so real errors can't hide in the noise.

510 tests pass.

## 0.17.0 — July 23, 2026

### Added — JARVIS's hands (slice 2, BETA): he can click and type for you
- Say **"click Save"**, **"type hello world into Notepad"**, **"open the File menu and click Save"**, **"select budget.xlsx in Explorer"**, or **"switch to Notepad"**. Off by default — Settings → SCREEN DRIVING (BETA).
- **File Explorer and Notepad only** in this first version. Chrome comes later, behind its own dedicated clean profile.
- **You see the plan first.** Every job shows a numbered plan card and waits for your OK. Steps that save, send, delete, download or overwrite pause again individually mid-job.
- **A STOP window stays on top the whole time** showing the current step in plain English. Press it, hit Escape, or say "stop" — everything ends instantly. The orb turns to a fast "HANDS ON SCREEN" state and a chime marks start and end.
- **Named buttons, never blind clicks.** JARVIS presses controls by their accessibility name through Windows UI Automation. If a control isn't there, or two share a name, he stops and asks — he never guesses at screen coordinates.
- **Hard walls, enforced in code, re-checked before every single press:** financial windows (banks, brokers, anything that spends) are blocked permanently with no off switch; sign-in and password surfaces refused; password fields never typed into; system/admin windows refused; a Windows permission prompt (UAC) ends the job and hands you the machine. Never runs unattended, on a schedule, or from the phone.
- **Honest logging**: every action is logged with what was pressed and where; anything typed is recorded as a fingerprint (hash) and length — never the text itself.

## 0.16.0 — July 20, 2026

### Added — Living-with-it fixes from real use
- **Interrupt anytime**: press Escape, the stop button, or say "JARVIS, stop" (or "stop", "quiet", "nevermind") to cut off a spoken reply mid-sentence — it now stops his voice, not just his thinking.
- **Close apps on request**: "close Chrome", "quit Notepad", "close File Explorer". Closes gracefully (apps can prompt to save); never force-kills, and never touches the Windows shell — the taskbar, Start menu and desktop always survive a "close File Explorer".
- **Speaks with other windows open**: fixed a Chromium quirk that silently paused JARVIS's voice when another window (like File Explorer) covered him.
- **Phone photos get findable names**: a photo sent from iOS used to land as a meaningless GUID JARVIS couldn't find. It now arrives as e.g. "Phone photo 2026-07-20 12-16.png", and the Send screen has an optional name field. Genuinely-named files are left alone.

## 0.15.0 — July 20, 2026

### Added — File authority: moves, copies, renames and organizing happen on request without an approval card; "delete" means the Recycle Bin and is refused when the bin cannot hold the item; permanent erasure remains impossible.

## 0.14.0 — July 19, 2026

### Added — JARVIS Mobile v2: bottom tabs, cameras on the phone (stills + alerts), phone-to-PC file sending, macOS-style look, HTTPS pairing QR
- Three-tab navigation: Chat, Cameras, Send. All tabs update with your system's light/dark theme.
- **Cameras**: view fresh snapshots from your Ring doorbell and other cameras, tap to refresh, receive badges and alerts for motion/doorbell events.
- **Send**: pick photos and files from your iPhone library, choose a destination folder on your PC, upload with file size validation (max 25 MB). Uploaded files appear immediately in that folder.
- **Pairing redesign**: Settings → MOBILE now shows a MOBILE PUBLIC URL (your private HTTPS Tailscale address). The QR code opens that address and pre-fills the six-digit code — no typing needed.
- **macOS-style design**: cleaner layout, real JARVIS app icon (re-add to home screen if upgrading), polished Typography and spacing.
- Voice messages still work in Chat over HTTPS (requires the secure pairing address, not HTTP).

## 0.13.0 — July 19, 2026

### Added — Scheduled tasks: reminders, agent requests, camera checks and daily briefings on a timer (off by default)
- Four task types: SPEAK (announce reminders aloud), ASK (run agent questions with file/tool access),
  BRIEFING (daily summary of tasks and PC status), and CAMERA (look at a camera and describe what you see).
- Master switch in Settings to enable/disable all tasks at once.
- Quiet hours (default 9 PM–7 AM) suppress audio but keep tasks visible on screen and in Activity log.
- Catch-up on restart: if JARVIS closes and a task's due time passes, it fires once on reopen with a late marker.
- Single timer with no polling: the schedule module creates exactly one OS timer at a time, pointed at the next due task.
- All task types are read-only and unattended: no approvals, no side effects beyond logging and display.
- Fully IPC-aware: task fires broadcast to all UI windows so Activity feeds and screens update in real time.

## 0.12.0 — July 18, 2026

### Added — JARVIS Mobile: phone chat + voice over Tailscale
- Send and receive chat messages from your iPhone while away from home.
- Press-and-hold for voice messages; replies stream as audio and text.
- Pair by scanning a QR code from Settings, revoke anytime from the device list.
- Runs over Tailscale (zero-config VPN); never exposed to the internet.
- Off by default. Turn on in Settings → MOBILE → PHONE ACCESS.

## Unreleased (agentic-brain branch)

### Added — Agentic brain (multi-step tools on every model)
- JARVIS can now take several steps from one request — search, read a file,
  then act — on the local brain AND the cloud brain. (Previously the cloud
  brain had no tools at all; it could only talk.)
- New tool: it can read a file's contents (approved folders only), not just
  find it — so "find the invoice, read the total, add a task" works end to end.
- One provider-agnostic loop drives Ollama, OpenAI, and Claude alike, so all
  three brains have the same abilities; only the model's raw smarts differ.
- Each step shows as a live status line while it works. Destructive actions
  still only happen through approval cards.

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
