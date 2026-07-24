# JARVIS — Session Handoff (2026-07-20)

Hand this to a new chat to continue JARVIS. **Read `README.md`, `CHANGELOG.md`, and
`JARVIS-ROADMAP-AND-CLAUDE-HANDOFF.md` first** — this file is the delta on top of
those and supersedes the 2026-07-15 and 2026-07-18 handoffs.

Auto-memory holds the durable facts (`jarvis-project.md`, `adhd-mode.md`,
`dont-jump-ahead.md`, `propose-then-execute.md`); this is the working detail.

---

## 1. What JARVIS is (30 seconds)

Local-first **Windows desktop assistant** (Electron) for **Adam**. Amber
holographic "Classic" UI plus a switchable cyan "Command Center" skin, and a
floating orb when minimized. Local brain via **Ollama**, free local speech
(**faster-whisper**) + "Hey Jarvis" wake word, approved-folder file tools,
document Q&A, cameras (Ring live), autonomy, an **agentic multi-step brain**,
**scheduled tasks**, and a **phone companion** reachable from anywhere.

**Version 0.16.0. 292 tests passing. `main` is clean and fully pushed.**

## 2. Non-negotiable rules

Free local mode stays the default · never store keys as plaintext (Electron
`safeStorage`) · never run model-generated shell · approved-folder boundaries
enforced in **main** · **permanent file erasure must remain impossible** ·
sensitive actions (send/spend/power) still need approval cards · **run
`npm test` after every change** · work on a branch so it's easy to revert.

**Two rules CHANGED this session — do not apply the old ones:**
- **GitHub pushing is now ALLOWED.** Adam lifted the old "never push" rule on
  2026-07-18. `main` and all feature branches are pushed to
  `github.com/Adamdesgns/jarvis-local-assistant`.
- **File approval cards are gone for owner-issued file work.** Move/copy/
  rename/organize/delete-to-bin now execute immediately when *Adam* asks
  (desktop or phone). Power actions still use approval cards. Scheduled/
  unattended runs are still refused everything.

## 3. Git state

`main` = `7d3e359` (v0.16.0), pushed, working tree clean, 292 tests green.
Everything below is **already merged into main** — these branches are history:

| Branch | Contents |
|---|---|
| `openai-responses` | `/v1/responses` migration |
| `mobile-companion`, `mobile-v2` | phone app v1 + v2 |
| `scheduled-tasks` | autonomy slice 3 |
| `file-authority` | the new file rules |
| `interrupt-control`, `fix-voice-focus`, `fix-close-apps`, `fix-upload-names` | today's four fixes |

Still-parked older branches: `sphere-reactive` / `sphere-fps-baseline` (the
perf A/B, decision never made, both carry a temporary on-screen FPS counter);
`camera-module-phase1..5`, `autonomy-engine`, `command-center-skin`,
`agentic-brain` — all historical, already in main, ignore.

Untracked in the tree (leave alone): `JARVIS-MARKETING-BRIEF.md`,
`JARVIS-SETUP-PROMPT.txt`, the handoff files, `docs/JARVIS-SETUP-VIDEO-SCRIPT.md`.

## 4. What happened this session

### A. The agentic brain went live, then OpenAI broke it twice
The multi-step tool loop built on 2026-07-17 was unverified. Two live failures,
both fixed:
1. `max_tokens` rejected by GPT-5-family models → switched to
   `max_completion_tokens`.
2. Then **both** of Adam's models started refusing *tools + reasoning together*
   on `/v1/chat/completions`. Real fix: migrated the agent path to
   **`/v1/responses`** (`OpenAIResponsesSession` in `core/brain-adapters.js`),
   which runs tools and reasoning at full strength, with `store:false` plus
   encrypted reasoning replay between rounds. **Live-tested by Adam — works.**

### B. JARVIS Mobile (v0.12.0 → v0.14.0)
A phone-installable PWA served by the desktop app itself over **Tailscale**.
Adam has it paired on his iPhone.
- **Critical gotcha:** iPhone Safari refuses microphone access on non-HTTPS
  origins. Plain tailnet HTTP could chat but never listen. Fixed by having the
  server also answer on loopback so `tailscale serve` fronts it with a real
  certificate. **His HTTPS URL is `https://alienadam.taile7c34c.ts.net`** and it
  is stored in the `mobilePublicUrl` setting (the pairing QR uses it, and
  carries the code in the hash so he never types it).
- v2 added: **cameras screen** (list + fresh stills + alert badges), **Send
  screen** (phone→PC file upload), a **macOS-flavoured design system** with
  light/dark, a **bottom tab bar**, and real **PNG app icons** (iOS silently
  ignores SVG apple-touch-icons — that's why his icon was blank).

### C. Scheduled tasks (v0.13.0) — autonomy slice 3
Speak a reminder, run a real agent request, check a camera, or give a daily
briefing, on a timer. **Adam explicitly rejected polling**, so it holds exactly
**one `setTimeout`** aimed at the next due item, re-armed on fire/edit/system
resume. Off by default. Quiet hours suppress *speech only* — a card still
shows. Unattended runs get a **read-only allowlist** (`unattendedSafe: true` in
`core/tool-registry.js`). **The "speak" path is live-confirmed** ("IT WORKS!!");
ask/briefing/camera/catch-up are still unrun.

### D. File authority (v0.15.0) — "he can move them just not delete"
Owner-issued file work runs with no approval card. **"Delete" means the Windows
Recycle Bin only**, and is refused when the bin wouldn't genuinely catch the
item. Permanent erasure does not exist in the code.

### E. Four lived-with bugs Adam reported, all fixed (v0.16.0)
1. **Couldn't interrupt him.** Stop only killed his *thinking*, not his voice.
   Now Escape / stop button / "JARVIS, stop" all cut speech mid-sentence.
2. **Couldn't talk with File Explorer open.** Chromium suspends
   `speechSynthesis` when the window is occluded, *independently* of
   `backgroundThrottling` (which was already off — that was a red herring). Fix
   is a watchdog that keeps nudging `resume()` while an utterance is
   outstanding.
3. **Couldn't close apps.** Never built. Now he can — with `explorer.exe`
   handled as a special case that closes folder *windows* via COM and never
   kills the Windows shell. System processes are denylisted.
4. **Couldn't find files sent from the phone.** iOS hands over a bare GUID
   (`9F4B5160-A908-…png`) instead of a filename, so nothing Adam would ever say
   matched. Meaningless names now become e.g. `Phone photo 2026-07-20 12-16.png`;
   real names are left alone. There's also an optional name field on the Send
   screen.

### F. Also fixed along the way
Ring login (his password had been slightly wrong); **`gemma3:4b` vision model
installed** so camera AI descriptions work locally — confirmed on his real
porch; a **desktop launcher** (`scripts/start-jarvis.vbs` + a JARVIS icon on his
desktop) so he never needs the assistant to start the app.

## 5. Bugs that reviews caught, worth knowing about

These were all found by adversarial review, not by the implementers, and two of
them were genuinely dangerous:

- **Deleting a folder could have erased it permanently.** The Recycle Bin check
  only sized *files*, and the delete branch happily matched directories.
- **"remove the extra spacing from my resume" trashed the resume.** The delete
  regex was too broad; `remove` is no longer a delete verb, and low-confidence
  matches now ask instead of acting.
- **Scheduled runs could still create files** (the create-folder/note/report
  branches lacked the unattended guard) — which made a doc we'd just written
  for Adam untrue.
- **Organize silently overwrote same-named files** — the approval card had been
  hiding a real data-loss bug.
- **A guard with no test.** The "this drive has no Recycle Bin" refusal would
  have passed every test even if deleted entirely. Now proven by mutation.

**Lesson for the next chat: on this project, mutation-test the safety
guards.** "The tests pass" repeatedly meant "the tests don't check that."

## 6. Immediate next actions

1. **⚠ Everything in §4E and most of v0.14.0 is UNTESTED on Adam's hardware.**
   Nothing there has been through his hands yet. Highest-value next step is
   walking him through it — the interrupt, closing Explorer, speech while
   Explorer is open, and sending a photo then asking JARVIS to find it.
2. **The phone's new screens** — cameras and Send — have never been opened on
   his actual iPhone. Checklist: `docs/MOBILE-TESTING-CHECKLIST.md`.
3. **File authority checklist** (`docs/FILE-AUTHORITY-CHECKLIST.md`) — including
   the USB-stick delete refusal, which is the interesting case.
4. **Scheduled tasks** beyond the speak test (`docs/SCHEDULE-TESTING-CHECKLIST.md`).
5. **His `Downloads` folder contains `anvil-operator-pack\node_modules`** —
   thousands of library files that `searchFiles` walks, drowning real results.
   Worth excluding `node_modules`/dot-dirs from search.
6. **Parked, discussed, not started:** typing/clicking control of the PC (needs
   its own safety design — a visible "JARVIS is driving" indicator, an instant
   stop, an action log); webcam + phone-camera vision; a **Siri Shortcut** so he
   can say "Hey Siri, ask Jarvis…" (true background "Hey Jarvis" on iPhone is
   impossible — Apple reserves it); MCP connector support; the sphere perf
   decision; Blink/Nest camera testing.

## 7. Dev commands & gotchas

`npm install` · `npm test` (node:test, currently 292) · headless boot check: set
env `JARVIS_CAPTURE_PATH=<path.png>` then `npm start` (loads, captures, quits) —
**this is the only thing that catches renderer syntax errors, since `npm test`
does not load `src/renderer.js`.** Relaunch by double-clicking his desktop
JARVIS icon, or `wscript.exe scripts/start-jarvis.vbs`.

**If you run parallel subagents: give each one its own git worktree.** I put two
agents in one working directory on different branches and one of them had its
uncommitted work carried onto the other's branch mid-task. It recovered, but
that was my error and it cost time.

**Two security warnings fired on subagents this session; both were false
positives on the authorization question** (the delete-approval removal was
genuinely authorized by Adam in conversation). I verified the actual code both
times rather than trusting the report or the warning — do the same.

## 8. Working style with Adam

Novice-friendly, plain language, do the technical work for him. He is decisive
("do it", "build it", "fix them all") and tests things for real, which is where
the best bugs come from.

- **ADHD mode** (he'll say "adhd mode"): ONE action per message, then stop and
  wait. No tables, no multi-step lists. He may then say "you can give me 3 steps
  at a time" — follow that.
- **Propose then execute** — describe the plan, get the nod, then build.
- **Don't jump ahead** — don't launch/kill/reconfigure his apps unprompted,
  though he'll often explicitly ask you to relaunch, which is fine.
- He asks for parallel work when he wants speed ("can you not run an agent and
  fix both at the same time?").
- Tell him plainly when something is unverified. He's building a paid product
  and needs to know what's actually been proven.
