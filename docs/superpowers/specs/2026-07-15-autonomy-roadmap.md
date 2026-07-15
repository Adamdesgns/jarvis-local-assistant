# JARVIS Autonomy — Roadmap / Vision Map

_Date: 2026-07-15 · Status: approved roadmap (decomposition only; each
sub-project gets its own spec → plan → build)_

## Context
Adam wants to make JARVIS "more autonomous." Shown the options, he chose **all
four** flavors: (1) react to real-world events, (2) be proactive during the day,
(3) finish multi-step tasks, (4) run on a schedule. That is the full vision, and
it is too large and too safety-sensitive for one design/build. This document is
the map: the shared architecture, the non-negotiable safety model, the four
sub-projects, what already exists to reuse, and a recommended build order.
Nothing here is built yet.

## The one principle that governs all of it
**Autonomy adds *initiative*, not *permission*.** JARVIS may decide *when* to
act or speak on its own, but anything sensitive still flows through the exact
same gate it does today. Concretely, the autonomy engine must NEVER call
`documents.*` or `tools.executePowerAction` directly. Every state-changing
action it wants runs through the existing choke point: `classifyCommand`
(`core/security.js:12` → safe / confirm / blocked) → for anything risky, an
approval card via the `pending` Map + `approval:resolve`
(`core/router.js:391-414`). Destructive capabilities are never added to the
model's tool registry (`core/tool-registry.js`, 7 read/append-only tools).
Result: JARVIS gets proactive, but the single human-approval choke point and the
"no arbitrary shell / no send / no spend without confirmation" rules stay
exactly as they are. Everything autonomy does is logged to the Activity log
(`ActivityLog.write`, `core/activity-log.js:9`) with `source:'autonomy'`, and
every autonomous behavior is **off by default**, behind a master switch and
per-rule opt-in in Settings.

## Shared architecture — the "walking skeleton"
Three of the four flavors (events, proactive, schedule) are the same shape:
> **trigger fires → policy decides what's allowed → announce / prepare / (gated) act**

Build this spine ONCE as a new background service and the rest is mostly adding
triggers:

- **`core/autonomy-service.js`** (new) — constructed in `main.js` `app.whenReady`
  like `folderWatch`/`cameras` (`{ config, emit: sendEverywhere, log, notify,
  router, cameras, tasks }`), with a `setInterval` tick modeled on
  `checkTaskReminders` (`main.js:615`) and event subscriptions.
- **Rules model** — small declarative rules in settings (default OFF), each
  `{ trigger, condition, action, tier }`. Persisted via `ConfigStore` whitelist
  (`core/config-store.js:74`) + defaults (`core/defaults.js`).
- **Policy tiers** (what a rule may do unattended):
  - *Announce* — speak / desktop `notify` / log. No state change. Always safe.
  - *Prepare* — reversible, in-app only: take a snapshot, draft a note, compose a
    briefing, queue a suggestion. Safe.
  - *Act (sensitive)* — MUST route through `classifyCommand` + approval card.
    `blocked` → refuse & log; `confirm` → raise a card; never self-approve.
- **Proactive feed + control** — a new pushed event (`autonomy:suggestion` via
  `sendEverywhere` + a `preload.js` `onAutonomy*` bridge, following the existing
  pattern) surfaces "JARVIS noticed…" cards in the UI, plus a master kill-switch
  and a per-rule list in Settings.

## The four sub-projects (each its own spec → plan → build)

### 1. Autonomy engine + camera reactions  ← recommended first
Build the spine above, wired to **camera events as the first trigger source**.
Camera motion/doorbell already flow through `CameraService.#handleAlert`
(`core/camera/camera-service.js:58`) which emits `cameras:alert`, runs
`describeFrame`, and calls `notify`. The engine subscribes and applies rules.
Example rules: doorbell → speak the AI scene description out loud (*Announce*);
motion at night → snapshot + alert (*Prepare*); arm cameras at a scheduled time
(*Act*; camera arming already has its own two-step confirm in the UI). **Why
first:** it proves the entire trigger→policy→act spine end-to-end, and Adam can
validate it live while testing his real cameras.

### 2. Proactive-during-the-day
Add non-camera triggers to the same engine: due/overdue tasks
(`TaskStore.dueForNotification`, `core/task-store.js:112`), watched-folder
changes (`FolderWatchService` already emits `watch:event`,
`core/folder-watch.js:51` — needs a preload bridge added), and time-of-day.
Reuse the morning-briefing assembler (`core/router.js:146-161`) so JARVIS can
offer the briefing proactively instead of waiting for "good morning." Output is
*Announce*/*Prepare* only (suggestions in the feed), never silent action.

### 3. Runs-on-a-schedule
A lightweight local scheduler (cron-like times) as a trigger type in the engine,
running routines (`core/router.js:308-327`), the briefing, or an encrypted
backup export at set times. This is really just the *time trigger* the other
slices already lean on, generalized + given a small Settings UI.

### 4. Multi-step "brain" (separate track)
Upgrade the model's tool loop in `core/ai-service.js:231-243` so one instruction
can accomplish several steps: a brief plan step, a considered raise of the hard
2-round / 3-call cap, and possibly a few more **read-only** tools in
`core/tool-registry.js`. Non-negotiable: destructive actions stay OUT of the
registry and continue to route through approval cards. Independent of the
trigger engine; can be done any time.

## Recommended order & why
**1 → 2 → 3 → 4.** 1 builds the reusable engine and is validatable against the
cameras Adam is testing now. 2 and 3 are then small additions (new triggers) to
that engine. 4 is a separate, optional track that can slot in whenever.

## What already exists to reuse (no need to reinvent)
- Background-service + `setInterval` tick pattern — `main.js:556-626`, `:615`.
- One-way push to UI — `sendEverywhere` (`main.js:50`) + `preload.js` `onXxx`.
- Desktop notifications — the `notify` closure (`main.js:577-579`, `:593-595`).
- Safety gate + approval cards — `core/security.js:12`, `core/router.js:391-414`.
- Single action entry point — `CommandRouter.handle` (`core/router.js:93`).
- Audit trail — `ActivityLog.write` (`core/activity-log.js:9`), `source:'autonomy'`.
- Settings persistence/whitelist — `core/config-store.js:74`, `core/defaults.js`.
- Camera event pipeline + AI scene descriptions — `core/camera/camera-service.js`.

## Verification approach (per slice, when built)
- Unit-test the pure rule/policy logic (which tier a rule resolves to; that a
  `confirm`/`blocked` action produces a card and never self-executes) with
  `node:test`, mirroring `test/core.test.js`.
- Manual end-to-end on Adam's Windows PC — e.g. ring the real doorbell and
  confirm the spoken description + Activity-log entry; confirm every autonomous
  behavior is off until explicitly enabled.
- `npm test` green after every change.

## Immediate next step
Brainstorm **sub-project 1 (engine + camera reactions)** in detail into its own
design spec (`docs/superpowers/specs/YYYY-MM-DD-autonomy-engine-cameras-
design.md`) and implementation plan. Camera testing (see
`docs/CAMERA-TESTING-CHECKLIST.md`) validates the real events slice 1 reacts to.
