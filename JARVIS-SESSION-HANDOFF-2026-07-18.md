# JARVIS — Session Handoff (2026-07-18)

Hand this to a new chat to continue JARVIS. It captures current state, everything
done across this session, the exact git layout, and the open items. **Read
`JARVIS-ROADMAP-AND-CLAUDE-HANDOFF.md`, `README.md`, and `CHANGELOG.md` first** —
this file is the delta on top of those, plus the earlier handoff
`JARVIS-SESSION-HANDOFF-2026-07-15.md`.

Auto-memory already holds the durable facts (see `jarvis-project.md`); this is the
working detail.

---

## 1. What JARVIS is (30 seconds)
Free, local-first **Windows desktop assistant** (Electron). Amber holographic
"Classic" UI *and* a new switchable cyan "Command Center" dashboard skin, with a
floating orb when minimized. Local brain via **Ollama**, free local speech
(**faster-whisper**) + **"Hey Jarvis"**, approved-folder file tools, document
Q&A, camera module, autonomy (camera reactions), and — new this session — an
**agentic multi-step brain**. Version **0.11.2**. Heading toward a paid product
later (licensing is a separate future project).

**Primary user: Adam.** Frame him as a programming novice: one literal step at a
time, do the technical work for him, plain language. But he also builds apps and
makes how-to content; he steers hard and says "do it."

## 2. Non-negotiable rules
Free local mode stays the default experience · never store keys as plaintext
(Electron `safeStorage`) · never run model-generated shell · approved-folder
boundaries enforced in **main** · deletions → Recycle Bin + approval · sensitive
actions (send/spend/power/delete) need explicit confirmation via approval cards ·
**run `npm test` after every change** · commit only when it makes sense, on a
**branch** so it's easy to revert · **do NOT push to GitHub / touch the release
link — Adam has deferred that.** `main` is currently **64 commits ahead of
`origin/main`, all unpushed.**

## 3. Git state — READ CAREFULLY
- **`main`** (`b5f746d`) — stable, **64 commits ahead of origin (unpushed)**.
  Now contains everything shipped this session: Command Center skin, autonomy
  slice 1, password-eye toggle, Ring arm/disarm fix, the full orb rework, and
  the voice picker. 90-ish tests green.
- **`agentic-brain`** (`de8544f`) — **the current branch.** Off `main` + 8
  commits: the Advanced-Brain docs and **sub-project 1 (agentic multi-step
  brain)**. **90 tests pass. UNMERGED** — waiting on Adam's live cloud test
  (see §5). Merges to `main` as a fast-forward once validated.
- `autonomy-engine`, `command-center-skin` — historical, already merged into
  `main`. Ignore.
- `sphere-reactive` / `sphere-fps-baseline` — the parked sphere perf A/B, each
  with a temporary on-screen FPS counter. Decision still pending (keep / merge /
  revert).
- `camera-module-phase1..5` — historical, merged. Ignore.

Uncommitted/untracked in the tree (leave as-is unless asked): modified
`scripts/install-windows.bat`, `scripts/jarvis-installer.nsi` (pre-existing);
untracked `JARVIS-MARKETING-BRIEF.md`, `JARVIS-SETUP-PROMPT.txt`, the two
`JARVIS-SESSION-HANDOFF-*.md`, and `docs/JARVIS-SETUP-VIDEO-SCRIPT.md`.

## 4. What happened this session

### A. Command Center skin (on `main`)
Adam's own cyan "movie-JARVIS" dashboard (he built it in ChatGPT; hosted at
`jarvis-command-center.steamercook.chatgpt.site`, needs his login — open it via
his logged-in Chrome, not WebFetch) rebuilt **inside** the app as a switchable
skin. `body[data-skin]` shows one of `#classic-root` / `#cc-root`. New:
`src/skins.js` (pure, tested), `src/command-center.js` (view bound to real
telemetry/tasks/projects/activity/cameras), `src/command-center.css` (prototype
CSS scoped under `#cc-root` via native nesting). New `skin` setting. Cameras =
glanceable panel; Documents = overlay; ORB/MINIMIZE reuse the real floating orb.
Later fixes: a **Settings gear + window controls + hover tooltips** were added to
the blue skin (it had trapped users with no way back to amber), **all pop-ups
(Settings/dialogs/toasts) recolor to match the skin**, and the sphere is
**height-capped** so the dock never hides under the taskbar.

### B. The floating orb, fully reworked (on `main`)
`core/orb-bounds.js` (pure, unit-tested). The orb is now **movable (drag
anywhere — a click that doesn't move still opens JARVIS)** and **resizable
(scroll wheel; window can't be edge-resized because it's transparent/frameless)**,
remembers its size+position, clamps to the display, and **matches the skin**
(amber Classic / cyan Command Center). Plus an **explosion easter egg**: scroll
past screen size → the window takes over the whole monitor and the orb swells
under manual scroll control until the white core nearly fills the screen → one
more scroll detonates (flash + shockwave + debris) → ~3s → respawns bottom-right.
Scroll back down or click the giant orb to escape. Scroll all the way down →
shrink-to-vanish. (There is a screen recording of this at
`…Microsoft.ScreenSketch…/Recordings/20260718-0014-*.mp4` — Adam shared it but
the assistant couldn't view mp4; ask him if it showed anything to capture.)

### C. Voice picker (on `main`)
Settings → JARVIS VOICE dropdown + "hear this voice" audition; auto-selection now
prefers a British male voice (Ryan/George) for the JARVIS feel. Ethics line held:
recreate the *feel*, never clone Paul Bettany's actual voice / Marvel IP.

### D. Advanced Brain — sub-project 1 (branch `agentic-brain`, UNMERGED)  ← the headline
"Most advanced AI possible, both" with **local/API parity**. Key finding: Adam
runs **cloud-only on an OpenAI key** (`gpt-5.6-luna`; provider pref is anthropic
but no Claude key saved) → in cloud mode JARVIS had **no tools at all** and could
only talk. Built:
- **`core/agent-loop.js`** — one provider-agnostic multi-step loop (pure,
  unit-tested): up to 8 tool rounds, a repeat/loop guard, responds to *every*
  tool call in a round (OpenAI/Anthropic require it), forces a tool-free final
  answer.
- **`core/brain-adapters.js`** — pure translation helpers
  (`normalizeOllama/OpenAI/Anthropic`, `anthropicTools`), unit-tested.
- **`read_file`** tool (`core/tool-registry.js`) — reads a file's text via
  `documents.readDocument`, enforces the approved-folder boundary. `documents`
  now passed into `buildToolRegistry` in `main.js`.
- **`AIService.reply()` rewired** to run the loop across Ollama / OpenAI /
  Anthropic (three `#…Agent`/`#…Chat` methods). Grounded document Q&A and
  `testCloud` keep their old single-shot paths (old `localReply`/`cloudReply`/
  `anthropicReply`/`openaiReply` retained).
- **Live step streaming**: `runAgent` emits `onStep` → router forwards →
  `main.js` `summarizeAgentStep` → `agent:step` → `preload` `onAgentStep` →
  renderer shows a status line in both skins.
- Safety unchanged: agent tools are all read/append-only; destructive stays
  gated behind approval cards.
Docs: `docs/superpowers/specs/2026-07-17-advanced-brain-roadmap.md`,
`…/specs/2026-07-17-agentic-brain-design.md`,
`…/plans/2026-07-17-agentic-brain.md`.

## 5. Immediate next actions for the new chat
1. **⚠ LIVE-TEST THE AGENTIC BRAIN (top priority).** The cloud HTTP path could
   NOT be tested by the assistant (no real API access). The pure logic is
   unit-tested; the **real OpenAI `/v1/chat/completions` call with Adam's
   `gpt-5.6-luna` is unverified.** Most likely first failure: the **`max_tokens`
   field** — newer models may require `max_completion_tokens`. Have Adam run a
   multi-step request ("find the newest PDF in Downloads, tell me what it's
   about, add a task to review it"); if it errors, get the **exact message** and
   fix (likely one line in `core/ai-service.js` `#openaiChat`). Then merge
   `agentic-brain` → `main` (fast-forward).
2. **Scheduled tasks** — Adam wants this next (autonomy slice 3): run routines /
   an agent task on a timer. Brainstorm → spec → plan → build. Pairs with the
   agent loop.
3. Advanced-Brain follow-ons (roadmap): SP2 richer tools, SP3 polished "thinking"
   UI, SP4 local-brain parity tuning.
4. **Ring login** — still broken (`access_denied`). Adam to retry using the new
   password-eye to verify the password char-by-char; credentials work on
   ring.com and no 2FA box appears, so JARVIS is getting a slightly-wrong
   password.
5. **Camera testing checklist** (`docs/CAMERA-TESTING-CHECKLIST.md`) on his real
   Ring/Blink/Nest accounts.
6. **Sphere decision** — keep `sphere-reactive`, merge, or revert; FPS counters
   are ready to compare.
7. **Weather + Network panels** for the Command Center (the deferred "next
   project" for that skin).
8. Setup tutorial exists: `docs/JARVIS-SETUP-VIDEO-SCRIPT.md` + an HTML
   walkthrough artifact; Adam records the actual video himself.

## 6. Key new/changed files this session
| Area | Files |
|---|---|
| Skins | `src/skins.js`, `src/command-center.js`, `src/command-center.css`, `#classic-root`/`#cc-root` in `src/index.html`, skin plumbing in `src/renderer.js` + `main.js` + `preload.js`, `docs/prototypes/command-center.html` |
| Orb | `core/orb-bounds.js` (+ `test/orb-bounds.test.js`), `src/widget.js`, `src/widget.css`, `src/widget.html`, orb IPC in `main.js`/`preload.js` |
| Voice | `selectVoice`/`populateVoiceSelect`/`auditionVoice` in `src/renderer.js`, `voiceName` in `core/defaults.js`/`config-store.js`, picker in `src/index.html` |
| Agentic brain | `core/agent-loop.js` (+ `test/agent-loop.test.js`), `core/brain-adapters.js` (+ `test/brain-adapters.test.js`), `core/tool-registry.js` (`read_file`), `core/ai-service.js` (adapters + `reply`), `agent:step` wiring in `core/router.js`/`main.js`/`preload.js`/`src/renderer.js` |

## 7. Dev commands & gotchas
`npm install` · `npm test` (node:test) · headless sphere/screen capture: set env
`JARVIS_CAPTURE_PATH=<path.png>` then `npm start` (loads, waits ~1.6s, writes the
PNG, quits). **Relaunching the live app:** kill JARVIS-V2 electron procs first,
then `Start-Process -FilePath npm.cmd -ArgumentList start -WorkingDirectory <dir>
-WindowStyle Hidden` (detached). A plain background `npm start` races the
single-instance lock if the old instance isn't fully dead → new one exits 0. To
screenshot a specific skin headlessly: temporarily set `settings.json`
`settings.skin`, capture, restore.

## 8. Working style with Adam
Novice-friendly, one literal step at a time, do the technical work, plain
language. He likes work on a branch (easy revert), wants `npm test` after each
change, and does NOT want GitHub pushes. He launches/keeps his own app but this
session he asked the assistant to relaunch it repeatedly — that's fine when he
asks. He's decisive ("do it", "make it happen") and enjoys the fun stuff (the orb
explosion). Confirm before anything outward-facing or irreversible.
