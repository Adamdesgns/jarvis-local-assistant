# Defense Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phases 1–3 of Defense Mode per `docs/superpowers/specs/2026-07-25-defense-mode-design.md` — a fullscreen situation-board posture with manual + opt-in automatic triggers, NWS alerts, RSS headlines, and a spoken read.

**Architecture:** Pure logic in `core/defense-mode.js` (battle-mode mold), orchestration in `core/defense-service.js` (main process, owns ALL network), router intercept for voice/typed entry, renderer posture in `src/defense-ui.js` that reparents the real `#camera-grid` node. Settings ride the normal `settings:save` path under one `defense` object.

**Tech Stack:** Electron main/renderer, node:test + assert/strict, no new dependencies. NWS API (`api.weather.gov`, no key, `User-Agent` header required). RSS parsed with a built-in regex parser.

## Global Constraints

- HARD RAILS from the spec: watches and tells, never acts; network only to `api.weather.gov` + saved RSS URLs; `unattended` can never enter; every auto entry announces with a 15s wave-off; rides the camera Pro gate.
- No inline `style=""` attributes ever (CSP).
- Reuse `autonomyNightStart`/`autonomyNightEnd` (21→7) for "night hours" — no new night setting.
- Warning tier ONLY: Tornado Warning, Hurricane Warning, Severe Thunderstorm Warning, Flash Flood Warning, Extreme Wind Warning.
- Commit after every green task; branch `defense-mode`; never push.

---

### Task 1: Trigger matchers (phase 1 core)

**Files:**
- Create: `core/defense-mode.js`
- Test: `test/defense-mode.test.js`

**Interfaces:**
- Produces: `isDefenseRequest(text) -> {} | null`, `isStandDown(text) -> {} | null`

- [ ] Failing tests: `isDefenseRequest` matches "defense mode", "jarvis, defense mode", "enter defense mode", "go into defense mode", "defence mode" (UK spelling); leaves alone "what is defense mode", "add defense mode to my tasks", "read about missile defense". `isStandDown` matches "stand down", "exit defense mode", "all clear"; leaves alone "stand down from the ladder" (matcher is anchored whole-phrase like battle mode).
- [ ] Implement narrow anchored patterns in battle-mode style (`^…$`, trailing punctuation stripped).
- [ ] `node --test test/defense-mode.test.js` green → commit.

### Task 2: Alert filter + banner label

**Files:** same module/test.

**Interfaces:**
- Produces: `pickTriggerAlert(features) -> feature | null` (first active warning-tier NWS GeoJSON feature, by `properties.event` exact match against the Global Constraints list); `buildBannerLabel(reason, now) -> string` where `reason` is `{ kind: 'manual' } | { kind: 'weather', event, area } | { kind: 'camera', cameraName }` → `DEFENSE MODE · MANUAL TRIGGER · 21:43` / `DEFENSE MODE · TORNADO WARNING, HARRISON COUNTY · 21:43` / `DEFENSE MODE · MOTION AT FRONT DOOR · 21:43`.

- [ ] Failing tests: warnings picked, watches/advisories skipped, empty list → null; label formats for all three reason kinds with an injected `now` Date.
- [ ] Implement; green; commit.

### Task 3: Entry gate (announce-and-wave-off)

**Files:** same module/test.

**Interfaces:**
- Produces: `createEntryGate({ timeoutMs = 15000 })` with `propose(reason, now) -> { pending: true, expiresAt }` (refuses while already pending or entered), `waveOff() -> boolean`, `expire(now) -> { enter: true, reason } | null` (only fires past expiresAt), `entered()/reset()`. Pure — caller owns timers.

- [ ] Failing tests: propose → pending; waveOff cancels; expire before deadline → null; expire after → enter with the reason; second propose while pending refused; reset clears.
- [ ] Implement; green; commit.

### Task 4: RSS parser

**Interfaces:**
- Produces: `parseRss(xml, max = 10) -> [{ title, link, date }]` — handles `<item>` with plain and CDATA titles, missing links/dates, cap at `max`, garbage input → `[]`.

- [ ] Failing tests incl. a real-shape WLOX-style fixture string, CDATA, malformed XML.
- [ ] Implement with regex extraction (no dependency); green; commit.

### Task 5: Spoken-read prompt builder

**Interfaces:**
- Produces: `buildSituationReadPrompt(reason, alert, headlines) -> string` — JARVIS persona, ≤120 words spoken read: what fired, what the alert instructs, what headlines say; honest "no active alert" line for quiet manual entries; hard rule in prompt: report only, never advise calling anyone or taking armed action.

- [ ] Failing tests assert the reason, alert instruction text, headline titles, the word cap, and the report-only rule all appear.
- [ ] Implement; green; commit.

### Task 6: Router intercept

**Files:**
- Modify: `core/router.js` (branch chain near `isBattleRequest`, ~line 572)
- Test: `test/defense-router.test.js`

**Interfaces:**
- Consumes: Task 1 matchers.
- Produces: router results `{ source: 'defense', defense: 'enter'|'exit', reason }`. `isDefenseRequest` + `stream.unattended` → refusal result (`success: false`, no `defense` key). Router takes an optional `defense` handle `{ requestEnter(reason) -> { ok, message } }` injected from main.js; enter goes through it so the service is the single seam (Pro gate + gate state live there). "stand down" always allowed (exit is never gated).

- [ ] Failing tests with a stub service: manual enter routes through `requestEnter` and returns `defense:'enter'`; unattended refused with the "needs you at the desk" phrasing and `requestEnter` NOT called; stand down returns `defense:'exit'`; unlicensed refusal message passes through from the stub.
- [ ] Implement; run full `npm test`; commit.

### Task 7: DefenseService (main process)

**Files:**
- Create: `core/defense-service.js`
- Test: `test/defense-service.test.js`

**Interfaces:**
- Consumes: Tasks 2, 3, 4, 5; `config.getSettings()`, `isPro`, injected `fetchImpl`, `emit(channel, payload)`, `ai.reply`, `log`.
- Produces:
  - `assertAllowedUrl(url, feeds)` — throws unless host is `api.weather.gov` or the url is one of the saved feed urls. EVERY fetch in this file goes through it (the rail test stubs it out and proves fetches die).
  - `listCountyZones(stateCode)` — GET `https://api.weather.gov/zones?area={ST}&type=county` → `[{ id, name }]`.
  - `requestEnter(reason)` — Pro gate check (camera feature), refuses when not Pro; manual entries enter immediately: fetch situation (active alerts for the saved zone + all feeds via `Promise.allSettled`), compose read via `ai.reply(buildSituationReadPrompt(...))`, `emit('defense:enter', { banner, reason, alert, headlines, read })`.
  - `exit()` → `emit('defense:exit')`; `waveOff()`.
  - `start()/stop()` — poller: every 120s, ONLY when `settings.defense.autoWeather === true` and a zone is saved, fetch `https://api.weather.gov/alerts/active/zone/{zone}` with header `User-Agent: JARVIS-local-assistant (github.com/Adamdesgns/jarvis-local-assistant)`; a NEW warning-tier alert id (not one already seen) → `proposeAuto(reason)`.
  - `proposeAuto(reason)` — gate.propose + `emit('defense:pending', { reason, seconds: 15, spoken })`, real 15s timer → gate.expire → enter path. Wave-off emits `defense:pending-cancelled`.
  - `handleCameraAlert(alert, { systemsArmed, hour })` — `settings.defense.autoCamera === true` && armed && night hours (reuse `autonomyNightStart/End` wrap-around) → `proposeAuto({ kind: 'camera', cameraName })`.
  - Refresh loop while entered: refetch headlines/alert every 180s → `emit('defense:update', …)`; the read is composed ONCE per entry, never re-spoken (spec).
- [ ] Failing tests (injected fake fetch + fake timers or direct method calls): allowlist throws on strangers; unlicensed requestEnter refused; new warning proposes once (dedupe by alert id); wave-off cancels; camera path respects toggle+armed+night wrap; entered → update events carry fresh headlines; ai.reply failure still enters (read is best-effort, board must never be blocked by the brain).
- [ ] Implement; green; commit.

### Task 8: Settings + IPC + preload wiring

**Files:**
- Modify: `core/defaults.js` (add `defense: { countyZone: '', countyName: '', countyState: '', autoWeather: false, autoCamera: false, rssFeeds: [] }`), `main.js` (construct service after cameras with `emit: sendEverywhere`, hand it to the router, forward `cameras:alert` into `defense.handleCameraAlert`, `ipcMain.handle('defense:status|enter|exit|wave-off|zones')` with the `cameraRefusal()`-style Pro guard on enter), `preload.js` (`defense: { status, enter, exit, waveOff, zones }` + `onDefenseEnter/Exit/Pending/PendingCancelled/Update`).
- Test: extend `test/defense-service.test.js` for any new pure seams; `test/settings-tabs.test.js` untouched (no ninth tab).

- [ ] Wire, keeping the license comment discipline of the cameras seams; full `npm test` green; commit.

### Task 9: The posture — defense board UI

**Files:**
- Create: `src/defense-ui.js`
- Modify: `src/index.html` (add `<section id="defense-board" hidden>` with `#defense-banner` (trigger text + clock + `ESC TO EXIT` button), `#defense-wall` (grid target), `#defense-rail` (alert block + headlines list); `<script src="defense-ui.js">` before `renderer.js`), `src/styles.css` (+ `command-center.css` skin pass): `body.defense` hides `#module-layer`, board is fixed fullscreen, red-toned banner using existing tokens, responsive wall grid.
- Modify: `src/renderer.js` — in `executeCommand`, after `setResponse`: `if (result.defense === 'enter') window.JarvisDefense.enter(result); if (result.defense === 'exit') window.JarvisDefense.exit();`; subscribe the five `onDefense*` events; wave-off card reuses the existing toast/approval visual language.

**Behavior (`window.JarvisDefense`):**
- `enter(payload)`: remember prior state `{ liveStartedKeys }`; move the REAL `#camera-grid` node into `#defense-wall`; `body.classList.add('defense')`; unhide board; banner from `payload.banner`; for every `article[data-camera]` with `dataset.live !== 'on'`, click its `.camera-live` button and record the key; render rail; `speak(payload.read)` once if present.
- `exit()`: stop the lives it started (click again where `dataset.live === 'on'` and key recorded), move `#camera-grid` back into its home in the cameras module, remove class, hide board. Everything else untouched.
- Esc: `document.addEventListener('keydown', …)` — only when `body.classList.contains('defense')`, call `window.jarvis.defense.exit()` (service echoes `defense:exit` so every surface agrees).
- Pending card: `onDefensePending` shows the 15s countdown card with a WAVE OFF button → `window.jarvis.defense.waveOff()`.

- [ ] Build it; no inline styles; full `npm test` green; commit.

### Task 10: Settings UI — DEFENSE section in the CAMERAS tab

**Files:**
- Modify: `src/index.html` (`section.wide-setting[data-tab="cameras"]` area, after the existing camera settings): state dropdown (50 states) → COUNTY dropdown populated from `defense:zones`, the two toggles (default off), RSS feed list (url input + ADD, removable rows, WLOX/Sun Herald as placeholder example text only), all saved through the normal settings form path under `defense.*`.
- Modify: whichever of `src/renderer.js` settings collect/populate functions owns the cameras tab fields.

- [ ] Wire populate + save; `npm test` green (incl. `settings-tabs.test.js` — still eight tabs); commit.

### Task 11: Rig + screenshot proof

**Files:**
- Create: `test/rigs/defense.html` — kept in the repo (terminal lesson). Mock `window.jarvis` (defense + cameras namespaces), three fake camera tiles, buttons to simulate `defense:enter` (manual + tornado reasons), `defense:pending`, `defense:update`, `defense:exit`.

- [ ] Verify in the Browser pane with screenshots: posture on (banner text right, wall filled, rail populated), pending card with countdown, exit restores the normal desk (grid back in the module, board hidden). Both skins.
- [ ] Commit.

### Task 12: Close-out

- [ ] Full `npm test` green.
- [ ] CHANGELOG under `## Unreleased`; tick DEFENSE MODE phases 1–3 boxes/notes in `docs/ROADMAP.md`.
- [ ] Commit. NO push, NO merge — Adam's word first.

## Self-review notes

- Spec coverage: posture/banner/wall/rail (T9), manual trigger (T1/T6), Esc + stand down (T1/T9), NWS poller + county (T7/T10), camera auto-trigger (T7), wave-off (T3/T7/T9), RSS + read (T4/T5/T7), rails: allowlist (T7), unattended (T6), Pro gate (T7/T8), announce-always (T7), settings (T8/T10), rig (T11). Phase 4 explicitly out.
- The read must never block entry (ai.reply failure path tested in T7) — a storm with Ollama down still shows cameras.
