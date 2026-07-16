# Autonomy Slice 1 — Engine + Camera Reactions (Design Spec)

_Date: 2026-07-15 · Status: approved by Adam (design + defaults) · Branch:
`autonomy-engine` · Parent doc: `2026-07-15-autonomy-roadmap.md`_

## What this builds
The reusable autonomy spine (trigger → policy tier → announce/prepare/act) plus
the first trigger source: camera events. Ships four rules Adam picked, all
**off by default** behind a master switch:

1. **Speak the doorbell aloud** (Announce) — when a doorbell event arrives,
   JARVIS speaks the alert text (the AI scene description when available)
   through the existing renderer `speak()`.
2. **Night-only motion alerts** (Announce) — when enabled, motion desktop
   notifications only fire during the night window (default **9 PM – 7 AM**,
   configurable). Daytime motion stays visible on camera tiles but stops
   raising Windows notifications. Doorbell is never suppressed.
3. **"Someone's here" card** (Prepare) — doorbell or person-relevant motion
   raises a dismissible card in the main UI with the camera name, alert text,
   and snapshot thumbnail.
4. **Spoken motion summary** (Announce) — motion events are spoken aloud
   ("Motion at Front Door: …") using the same text as the notification.

## Safety model (unchanged, restated)
Autonomy adds **initiative, not permission**. This slice ships **no Act-tier
rule**, but the policy decision for Act is built and unit-tested now: an
Act-tier evaluation must return `requiresApproval: true` and the engine must
never execute anything itself — when a future Act rule lands, it routes through
`classifyCommand` (`core/security.js:12`) + the approval card flow
(`core/router.js` `pending` map + `approval:resolve`). The autonomy service
never calls `documents.*` or `tools.executePowerAction`. Everything it does is
logged via `ActivityLog.write` with `source: 'autonomy'`. Master switch +
per-rule toggles all default OFF.

## New files

### `core/autonomy-rules.js` (pure, no Electron imports)
- `TIERS = { ANNOUNCE: 'announce', PREPARE: 'prepare', ACT: 'act' }`
- `isWithinWindow(now, startHour, endHour)` — hour-based window that handles
  crossing midnight (21 → 7 means 21:00–23:59 ∪ 00:00–06:59). `startHour ===
  endHour` means "always".
- `evaluateAlert(settings, event, now)` — takes the settings object and a
  camera alert `{ kind: 'motion'|'doorbell', name, body, jpegBase64?, key }`,
  returns a list of actions:
  `{ rule, tier, speak?: string, card?: {title, body, jpegBase64}, suppressNotify?: boolean }`.
  Returns `[]` when the master switch is off. Each enabled rule contributes
  independently; duplicate speech is coalesced (doorbell-speak wins over
  motion-summary for a doorbell event).
- `decideAct(classification)` — the Act-tier gate decision, mirroring the
  router's semantics: `'blocked'` → `{ allowed: false, log: true }`;
  `'confirm'` → `{ allowed: false, requiresApproval: true }`; `'safe'` →
  `{ allowed: true }`. Built + tested now; wired live with the first Act rule.

### `core/autonomy-service.js` (background coordinator, no UI code)
- Constructed in `main.js` `app.whenReady` like the other services:
  `new AutonomyService({ config, emit, log, notify })`.
- `handleCameraAlert(alert)` — runs `evaluateAlert` with current settings and
  a real `new Date()`, then for each action: emits **`autonomy:event`**
  (`{ rule, speak?, card? }`) via `emit` (= `sendEverywhere`) and writes an
  activity entry `{ type: 'autonomy', command: <rule>, response: <body>,
  source: 'autonomy' }`.
- `notifyGate(alert)` — returns `false` when the night-only rule says the
  desktop notification for this motion event should be suppressed; `true`
  otherwise. Camera service consults this before calling `notify`.

## Small edits to existing files
- **`core/camera/camera-service.js`** — one optional hook: constructor accepts
  `notifyGate` (default `() => true`); `#handleAlert` calls
  `this.notifyGate({ kind, name, body })` and skips `this.notify(...)` when it
  returns false. Tile updates, activity log, and `cameras:alert` are untouched.
- **`core/defaults.js`** — new keys (settingsVersion stays 6; deep-merge covers
  old saves because the keys are new top-level primitives/objects):
  ```js
  autonomyEnabled: false,
  autonomyRules: {
    speakDoorbell: false,
    nightMotionOnly: false,
    someoneHereCard: false,
    speakMotion: false
  },
  autonomyNightStart: 21,  // 9 PM
  autonomyNightEnd: 7      // 7 AM
  ```
- **`core/config-store.js`** — add the four keys to the `updateSettings`
  whitelist; deep-merge `autonomyRules` in `mergeSettings` (like `routines`).
- **`main.js`** — construct `AutonomyService` in `app.whenReady`, pass its
  `notifyGate` into the `CameraService` constructor, and subscribe it to camera
  alerts. Subscription: `CameraService` already emits `cameras:alert` through
  `emit`; the autonomy service gets wired by wrapping the camera service's
  `emit` — cleaner: `main.js` passes `onAlert: (alert) => autonomy.handleCameraAlert(alert)`
  — implemented as autonomy service subscribing where the alert is emitted.
  (Exact mechanism settled in the plan; constraint: no double-emission, no
  change to the `cameras:alert` payload.)
- **`preload.js`** — `onAutonomyEvent: (callback) => on('autonomy:event', callback)`.
- **`src/renderer.js`** — subscribe `onAutonomyEvent`: `speak(action.speak)`
  when present and spoken replies are enabled; render the "someone's here"
  card when `card` is present.
- **`src/index.html` + `src/styles.css`** — new **AUTONOMY** settings section
  (master toggle, 4 rule toggles, night start/end hour selects) styled like the
  BEHAVIOR section; plus a small dismissible autonomy card container in the
  main view, near the response readout (decision: lives in the main chat/
  response area so it's visible even when the cameras module is hidden;
  auto-dismisses after 30 s or on click).

## Decisions made with Adam (2026-07-15)
- Build now, on `autonomy-engine`. ✔
- Default night window **9 PM – 7 AM** (configurable in Settings). ✔
- "Someone's here" card lives in the **main response area** (visible without
  opening the cameras module). Chosen by Claude as the sensible default; easy
  to move later.

## Out of scope for this slice
- Any Act-tier rule going live (arming on schedule etc.) — slice 3.
- Non-camera triggers (tasks, folders, time-of-day) — slice 2.
- Scheduler — slice 3. Multi-step brain — slice 4.

## Verification
- `test/autonomy.test.js` (node:test, mirroring `test/core.test.js`): window
  math incl. midnight crossing and start==end; master-off returns nothing;
  each rule contributes only when enabled; doorbell never suppressed by the
  night gate; speech coalescing; `decideAct` never allows `confirm`/`blocked`;
  service emits `autonomy:event` + logs with `source:'autonomy'`; `notifyGate`
  suppresses daytime motion only when the rule is on.
- Camera service hook covered by extending `test/camera.test.js` (gate false →
  no notify; default → unchanged behavior).
- `npm test` green after every change.
- Manual on Adam's PC: enable rules, trigger real doorbell/motion via the
  camera checklist, confirm speech + card + Activity log; confirm everything
  is silent with the master switch off.
