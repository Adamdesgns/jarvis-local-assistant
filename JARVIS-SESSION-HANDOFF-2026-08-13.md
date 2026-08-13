# JARVIS — Session Handoff (2026-08-13)

Hand this to a new chat to continue. It supersedes the **2026-07-21 handoff**,
which is three weeks stale and wrong in several places (see §6). Read
`README.md` and `CHANGELOG.md` alongside it.

Working style with Adam is unchanged and documented in the 2026-07-20 handoff
(novice-friendly, plain language, ADHD mode = one step per message, propose then
execute, tell him plainly what is unverified). Auto-memory holds the durable facts.

This session was a status review, not a feature build. The only code change is a
release stamp.

---

## 1. Where things stand

**`main`** is at `2975005` "Merge branch 'blink-oauth'" (2026-08-06). It carries
the orb work and the whole camera pile.

**`claude/jarvis-status-next-cctpto`** is at `5b1bf89`, **3 commits ahead of main,
0 behind** — a clean fast-forward whenever Adam wants it. It holds the 0.20.0
release stamp and nothing else. Working tree clean, pushed.

**Not tagged, not released, no PR opened.** Version strings in files only.

**Tests: 924 total, 909 pass.** The 14 failures are all Windows-only code paths
that cannot execute on a Linux container — `taskkill`, `cmd.exe`, drive letters
and the Recycle Bin, the `claude.exe` lookup, and the voice spawn. They are
expected here and say nothing about the code. Anyone reviewing on Windows should
see them green; if they do not, that is a real regression.

---

## 2. What this session changed — the 0.20.0 release stamp (DONE)

The 0.19.0 stamp had touched `package.json` and nothing else, so two things drifted:

- **`CHANGELOG.md` had no 0.19.0 heading.** The family-calls release shipped for
  real — GitHub release `v0.19.0`, published 2026-08-04, built from `5c0b772` —
  but its contents still sat under "Unreleased". Everything in that build now
  lives under **`## 0.19.0 — August 3, 2026`**: FAMILY CALLS, the PRIVACY
  rewrite, the ffmpeg removal, BROWSER stage 1, DEFENSE MODE, TERMINAL stage 1.
- **The NSIS script still said `0.18.0`.** `test/installer-version.test.js` — the
  test written specifically to catch this drift — had been red. It is green now.

**`## 0.20.0 — August 13, 2026`** is the orb work plus the camera work: the
ULTRON skin, voice-driven motion in every orb, the shared post-FX pass, the two
orb perf fixes, Blink live view, the Ring m-line fix, and Blink's OAuth sign-in.
`package.json`, `package-lock.json`, and `scripts/jarvis-installer.nsi` all read
0.20.0.

**Known cosmetic bug that cannot be fixed retroactively:** the shipped 0.19.0
installer registers `DisplayVersion 0.18.0` in Windows "Installed apps". Anyone
who installed 0.19.0 sees the wrong version until they install 0.20.0.

**Open judgment call for Adam:** the roadmap rule is that every release headlines
ONE wow feature, and 0.20.0 now has two candidates — the orbs, and "Blink cameras
finally play live." The sections are ordered orbs-first because that is how they
merged, not because anyone decided. Reordering is a two-minute job.

---

## 3. The unverified list — needs Adam's hardware, nobody else's

None of this can be proven from a container. It is the highest-value thing he can
do, and several items have been waiting weeks:

- **Blink live view** — brand new, never watched on a real camera.
- **Ring live view** — the m-line fix is code-proven, never seen on Adam's account.
- **JR video calls** — pair the two PCs, call each way, hang up from each side.
- **THE TERMINAL: Esc-dismissing the confirm card.** Both buttons are proven; Esc
  is not, because a `<dialog>`'s `close`/`cancel` events never fire in a headless
  rig. Needs a real window.
- **THE BROWSER stage 1** — the live webview pass.
- Older, still open from 2026-07-20: the phone's Cameras+Send screens, file
  authority, and scheduled tasks beyond "speak."

---

## 4. What is NOT here, despite what someone may remember

- **There is no Codex file with orb changes in this repo.** Adam asked; every file
  on all 30 branches was searched by name, plus all commit messages and file
  contents. The only Codex traces are a credit line in `CHANGELOG.md` (an explorer
  fix from a Codex debugging session, v0.11.1, mid-July) and a `CODEX_SANDBOX`
  seatbelt check in `site/vite.config.ts` on the marketing-site branch. If a Codex
  session produced orb work, it is uncommitted on Adam's PC or lives in another
  repo.
- **JARVIS cannot be opened from a cloud session.** It is a Windows Electron app;
  remote sessions run in a Linux container with no display and no access to his
  machine. He launches it from the desktop icon and reports what he sees.

---

## 5. Suggested next actions, in order

1. **Merge `claude/jarvis-status-next-cctpto` into `main`** (fast-forward), then
   decide whether to build and publish the 0.20.0 installer.
2. **Adam's live pass** on §3 — Blink first, since it is the newest and the most
   likely to be wrong.
3. **The kid side of FAMILY CALLS.** Phase 1 is dad-side only. It is not a family
   feature until JR's PC has the Call Dad button, the full-screen ring, and the
   20-second auto-answer switched on. That work belongs on `jarvis-jr-work`
   (66 commits unmerged from main — it is a live parallel build, not an
   abandoned branch), following the plan at the end of
   `docs/superpowers/plans/2026-08-02-jr-video-calls-phase1.md`.
4. **Then the roadmap's topmost unchecked NEXT item:** THE BROWSER stage 2
   ("summarize this page"). Or jump to calls Phase 2 (remote control of JR's PC)
   if the family line matters more than the browser.

---

## 6. `docs/ROADMAP.md` is stale in four places

Worth a five-minute cleanup by whoever picks this up next, because a new chat
reading it will draw wrong conclusions:

- **"Kokoro voice wiring"** is listed as unchecked under NEXT. Kokoro shipped —
  `core/defaults.js` has `ttsEngine: 'kokoro'` with `kokoroVoice: 'bm_daniel'`.
  It is the default voice, not a to-do.
- **THE BROWSER stage 1** is annotated "branch `browser-stage1`, unmerged." It
  merged and shipped in the 0.19.0 installer.
- **DEFENSE MODE phases 1–3** is annotated "branch `defense-mode`, unmerged."
  Same — merged, shipped in 0.19.0.
- The **NOW** section is fully checked, so the queue effectively starts at NEXT.

Other repo docs that lie about the present: the 2026-07-21 handoff still describes
"ask Claude" as unmerged and Voicebox as the live voice plan, and the last night
report is 2026-07-26.

---

## 7. Branch inventory

Thirty branches on the remote. The ones that matter:

- `main` — `2975005`, current.
- `claude/jarvis-status-next-cctpto` — `5b1bf89`, this session's stamp, +3.
- `jarvis-jr-work` — +66 from main. The kid build. **Active, do not delete.**
- `jarvis-jr` — +57. Older JR line, superseded by `jarvis-jr-work`.
- `agent/jarvis-marketing-site` — +1. Marketing site source, separate concern.
- `mobile-v2` (+154), `scheduled-tasks` (+141), `mobile-companion` (+140),
  `openai-responses` (+123), `agentic-brain` (+105) — all last touched
  2026-07-18/19. Their features shipped long ago through other merges; these are
  stale tips, not pending work. Safe to prune when someone has the appetite.
- Assorted `claude/*` one-commit branches from past chat sessions — scratch.
