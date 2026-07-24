# JARVIS — Session Handoff (2026-07-15)

Hand this to a new chat to continue the JARVIS V2 project. It captures the
current state, everything done this session, the exact git layout, and the
pending decisions. **Read `JARVIS-ROADMAP-AND-CLAUDE-HANDOFF.md`, `README.md`,
and `CHANGELOG.md` first** — this file is the delta on top of those.

---

## 1. What JARVIS is (30 seconds)
Free, local-first **Windows desktop assistant** (Electron). Amber holographic
sphere UI with a floating orb when minimized. Local brain via **Ollama**, free
local speech (**faster-whisper**) + **"Hey Jarvis"** wake word, approved-folder
file tools, document Q&A, a **camera module** (Ring/Blink/Nest/RTSP), and
safety-gated actions. Current version **0.11.2**. Moving toward a paid product
later (licensing is a separate future project; nothing gated yet).

**Primary user: Adam — a complete programming novice.** Give ONE literal manual
step at a time, do as much technical work for him as possible, explain plainly.

## 2. Non-negotiable rules (from the main handoff — do not break)
Free local mode is the default · never store API keys as plaintext (Electron
`safeStorage`) · never run arbitrary model-generated shell · approved-folder
boundaries enforced in the **main** process · deletions go to Recycle Bin and
need approval · sensitive actions (send/spend/power/delete) need explicit
confirmation · don't weaken Windows security · **run `npm test` after every
change** · don't claim a Windows-only feature works from a Linux build · one
giveaway installer `JARVIS-FREE-SETUP.exe`. Commit only when Adam asks; **do NOT
push to GitHub / update the release link — Adam has explicitly deferred that.**

## 3. Git state — READ CAREFULLY
Branches:
- **`main`** — stable 0.11.2. Local only, **ahead of `origin/main` by 33 commits
  (unpushed)**. Don't push without Adam's OK.
- **`sphere-reactive`** — sphere performance/reactivity work (commit `d4a64e4`).
  **PARKED, not merged.** See §4B.
- **`autonomy-engine`** — the **current** branch. Holds only the autonomy roadmap
  doc so far (commit `89e9ba5`). This is where the autonomy build goes.
- `camera-module-phase1..5` — historical, already merged into main. Ignore.

⚠️ **Uncommitted, floating in the working tree (NOT committed on any branch):**
- `core/camera/camera-service.js` — the Ring arm/disarm bug fix (see §4A).
- `test/camera.test.js` — regression test for that fix.
- `docs/CAMERA-TESTING-CHECKLIST.md` (untracked) — camera test checklist.
- `scripts/install-windows.bat`, `scripts/jarvis-installer.nsi`,
  `JARVIS-SETUP-PROMPT.txt` — pre-existing, not from this session.

These follow whichever branch is checked out. **Decide with Adam where to commit
the camera fix + test + checklist** (likely `main` or a small `camera-fix`
branch) so they aren't lost.

## 4. What happened this session

### A. Camera module review + Ring fix (done; uncommitted)
Reviewed all of `core/camera/*` (Blink/Ring/Nest/RTSP drivers, `go2rtc-manager`,
ONVIF discovery), `main.js` camera IPC, `src/cameras-ui.js`, `preload.js`.
**Found and fixed one real bug:** Ring arm/disarm was broken because
`CameraService.setArmed` coerced the system id with `Number()`, turning Ring's
non-numeric location IDs into `NaN` (Blink's numeric IDs were unaffected). Fixed
to pass the id through unchanged; added a regression test. **60 tests pass.**
Wrote `docs/CAMERA-TESTING-CHECKLIST.md` — a novice, step-by-step checklist for
Adam to test on his REAL Ring/Blink/Nest/local accounts. Highest-risk items that
need his accounts: **Ring live view** (cloud WebRTC / possible STUN gap),
**Nest OAuth loopback redirect**, **Ring arm/disarm** on the real system. Known
limitations flagged: Blink has no live video or push alerts; Nest is live-only.
**Adam still needs to run this checklist on his real accounts.**

### B. Sphere reactivity + performance (parked on `sphere-reactive`)
Rewrote `src/hologram.js` to be cheaper AND more reactive, keeping the cinematic
look byte-identical at idle (verified via a capture). Changes: particle batching
(`globalAlpha`, no per-frame `rgba()` string allocs), gated `shadowBlur`, cached
per-frame gradients, **FPS cap + auto-adapt** (new pure `src/hologram-quality.js`,
unit-tested), **pause when minimized** (`visibilitychange`), wired the existing
**ANIMATION MODE** dropdown (cinematic/fast/reduced) to real quality ceilings +
`prefers-reduced-motion`, gated reactivity extras (wake pop, stronger
audio-reactive core, thinking pulse), and coalesced `onAIStream` token writes.
**66 tests pass.** Adam's reaction: "barely a noticeable difference" (expected —
the point was to preserve the look), leaning **keep it if it's genuinely
lighter**. Not yet measured on his GPU (RTX 5060 — so no *felt* difference; the
wins are heat/power/battery/weak-PCs/minimized). **Decision pending: keep /
merge / revert.** Offer stands to add a temporary FPS counter to prove the gain.

### C. Autonomy roadmap (committed on `autonomy-engine`)
Adam wants JARVIS **"more autonomous"** and chose all four flavors (react to
events, proactive during day, multi-step tasks, run on schedule). Decomposed
into `docs/superpowers/specs/2026-07-15-autonomy-roadmap.md`. **Governing
principle: autonomy adds INITIATIVE, not PERMISSION** — anything sensitive still
routes through `classifyCommand` (`core/security.js:12`) + approval cards
(`core/router.js:391-414` pending Map + `approval:resolve`); destructive powers
are never added to the model's tool registry. Shared engine
(trigger → policy tiers **Announce / Prepare / Act** → act), 4 sub-projects,
recommended order **1→4**: (1) engine + camera reactions, (2) proactive-during-
day, (3) scheduling, (4) multi-step brain.

### D. Autonomy Slice 1 — DESIGNED, awaiting Adam's approval, NOT built
"**Autonomy Engine + Camera Reactions.**" Adam picked 4 default rules (all
Announce/Prepare tier, all **off by default**): **speak the doorbell aloud**,
**night-only motion alerts**, **"someone's here" feed card**, **spoken motion
summary**. Agreed design:
- New **`core/autonomy-rules.js`** — pure, unit-tested: the tiers,
  `isWithinWindow(now, start, end)` (handles windows crossing midnight),
  `evaluateAlert(settings, event, now)`, and the Act→requires-approval decision
  (built + tested now even though no Act rule ships yet).
- New **`core/autonomy-service.js`** — background coordinator (constructed in
  `main.js` like the camera/folder-watch services). Receives camera alerts,
  applies enabled rules, emits `autonomy:event` (speak + feed card), logs
  `source:'autonomy'`.
- Reuse: the `cameras:alert` payload (snapshot + AI description already
  computed), the `notify` closure, `sendEverywhere` + a new `preload.js`
  `onAutonomyEvent` bridge, the renderer's existing `speak()`, and `ActivityLog`.
  One **tiny optional `notifyGate` hook** in `camera-service` (default = today's
  behavior) so night-only motion can suppress daytime notifications when enabled.
- Settings: new **AUTONOMY** section (master switch + 4 rule toggles + night
  start/end hours). Defaults in `core/defaults.js`, whitelist in
  `core/config-store.js`, deep-merge for old saves.
- Act-tier *live wiring* deferred to the first Act rule (slice 3); the policy
  decision is built + tested now.
- Files: NEW `core/autonomy-rules.js`, `core/autonomy-service.js`,
  `test/autonomy.test.js`; small additive edits to `core/defaults.js`,
  `core/config-store.js`, `main.js`, `core/camera/camera-service.js` (one hook),
  `preload.js`, `src/renderer.js`, `src/index.html`, `src/styles.css`.
- **Open questions for Adam before writing the spec:** default night hours
  (assumed 9pm–7am), and where the "someone's here" feed card should live.

## 5. Immediate next actions for the new chat
1. **Autonomy Slice 1:** get Adam's approval/tweaks on the §4D design, then write
   the spec (`docs/superpowers/specs/YYYY-MM-DD-autonomy-engine-cameras-
   design.md`), then an implementation plan, then build — `npm test` throughout.
   This work belongs on the `autonomy-engine` branch.
2. **Commit the floating camera fix + checklist** somewhere safe (ask Adam).
3. **Sphere:** get Adam's keep / merge / revert call (optionally add a temporary
   FPS counter to give him real numbers first).
4. Remind Adam to run the **camera testing checklist** on his real accounts.
5. **Do not push to GitHub or touch the release link.**

## 6. Key file map (beyond the main handoff's table)
| Area | Files |
|---|---|
| Camera module | `core/camera/*` (drivers, `camera-service.js`, `go2rtc-manager.js`, `nest-oauth.js`, `ring-session.js`, `blink-client.js`), `src/cameras-ui.js`, camera IPC in `main.js` |
| Sphere (parked) | `src/hologram.js`, `src/hologram-quality.js` (on `sphere-reactive`) |
| Autonomy (roadmap) | `docs/superpowers/specs/2026-07-15-autonomy-roadmap.md` |
| Safety spine | `core/security.js` (`classifyCommand`), `core/router.js` (`handle`, `pending` map, `resolveApproval`), `core/tool-registry.js` (7 read/append-only model tools) |
| Event/background infra | `main.js` (`sendEverywhere`, `checkTaskReminders`, `app.whenReady` service construction), `core/folder-watch.js`, `core/task-store.js`, `core/activity-log.js`, `preload.js` `onXxx` bridges |

## 7. Dev commands
`npm install` · `npm test` · `npm start`. Screenshot the sphere headlessly: set
env `JARVIS_CAPTURE_PATH=<path.png>` then `npm start` (it loads, waits ~1.6s,
writes the PNG, and quits — see `main.js:130`).

## 8. Working style with Adam
Programming novice — one literal step at a time, do the technical work yourself,
plain language, no unexplained "run the script." He likes work done on a branch
so it's easy to revert. Confirm before anything outward-facing or irreversible.
Run `npm test` after every code change and separate what's automated from what
still needs real-Windows / real-account testing.
