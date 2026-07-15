# Camera Module Phase 3 (Ring Driver + Alerts Pipeline) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ring accounts (email/password + 2FA), camera snapshots, WebRTC live view, location arm/disarm — and the shared alerts pipeline: motion/doorbell events become Windows notifications, activity-log lines, and renderer events for every driver.

**Architecture:** `ring-client-api` (MIT) in the main process wrapped by `RingDriver`. Ring live view bypasses go2rtc: the renderer's SDP offer is bridged over IPC to `camera.createSimpleWebRtcSession()`. The alerts pipeline lives in `CameraService`: drivers emit `motion`/`doorbell`, the service snapshots (cooldown-aware), notifies, logs, and emits `cameras:alert`. Spec: `docs/superpowers/specs/2026-07-14-camera-module-design.md`.

**Tech Stack:** `ring-client-api` npm package; Node built-ins; existing Notification pattern from `checkTaskReminders`/`folderWatch`.

## Global Constraints

- Same as Phases 1–2. Ring refresh tokens rotate constantly: `onRefreshTokenUpdated` MUST persist via `persistSecrets` or the account breaks on restart.
- Live view contract change: `openLiveView` results become `{ok, mode: 'whep'|'sdp-bridge', whepUrl?, key}`; a new `cameras:live-answer` IPC carries the renderer's offer for sdp-bridge mode.
- Alert pipeline dedupe: at most one alert per camera per 60 s (Ring re-sends).

---

### Task 1: Dependency + Ring auth client wrapper

**Files:** `package.json` (+`ring-client-api`), create `core/camera/ring-session.js`, test append.

`ring-session.js` isolates the library so the driver stays testable:
- `async ringLogin({email, password, code}) -> {refreshToken} | {needs2fa: true, prompt}` — uses `RingRestClient` from `ring-client-api/rest-client`; a 2FA-required response surfaces `needs2fa` with Ring's prompt text.
- `createRingApi({refreshToken, onTokenUpdate}) -> RingApi` — constructs `new RingApi({refreshToken, controlCenterDisplayName: 'JARVIS'})` and subscribes `onRefreshTokenUpdated` → `onTokenUpdate(newToken)`.
- [ ] Steps: `npm install ring-client-api` (verify `npm audit --omit=dev` clean; if the tree pulls audit findings, STOP and reassess). Unit tests cover only pure logic (module exports shape) — library behavior is mocked at the driver layer. Commit `feat(camera): ring-client-api dependency and session wrapper`.

### Task 2: Ring driver

**Files:** create `core/camera/drivers/ring-driver.js`; test append (inject `apiFactory`).

- secrets: `{email, password, refreshToken}`.
- `connect()`: with refreshToken → `apiFactory` → `getLocations()`/`getCameras()`; without → state `'verify'` is NOT used (Ring 2FA happens at add-time in the service; driver requires refreshToken). Token rotation persists via `persistSecrets`.
- `listCameras()`: `{id, name, brand: 'ring', canStream: true, canArm: false, kind: doorbell|camera}` (`camera.isDoorbot` → doorbell).
- `listSystems()`: locations → `{id, name, armed: mode !== 'disarmed', canArm: location.supportsLocationModeSwitching !== false}`.
- `getSnapshot(cameraId)`: `camera.getSnapshot()` → Buffer. `snapshotCooldownMs = 0` (Ring cams are mostly powered; battery Ring cams self-limit).
- `getStreamSource()` returns `null`; new driver method `createSdpSession(cameraId, offerSdp) -> {answerSdp, close()}` via `camera.createSimpleWebRtcSession()`.
- Events: subscribe `camera.onMotionDetected`/`onDoorbellPressed` → `emit('motion'|'doorbell', {cameraId, name})`.
- `disconnect()`: unsubscribe all, `api.disconnect()`.
- [ ] Steps: failing tests with a fake api (cameras with subjects, locations with modes; token-update persistence; sdp session passthrough; motion event re-emit) → implement → pass → commit `feat(camera): Ring driver with push events and SDP live view`.

### Task 3: Alerts pipeline in CameraService

**Files:** modify `core/camera/camera-service.js`, `main.js`; test append.

- `constructor` gains `notify` callback (main.js passes the `Notification` pattern used by folderWatch).
- `#instantiate` subscribes driver `motion`/`doorbell`: dedupe (60 s per camera key) → `getSnapshot(key, {manual: false})` (cooldown-aware, failures tolerated) → `notify(title, body)` (`"Front Door — someone pressed the doorbell"` / `"Motion at Garage"`) → `log.write({type: 'camera-alert', ...})` → `emit('cameras:alert', {key, kind, name, jpegBase64?, at})`.
- `describeAlert` hook point: `this.describeFrame = null` (Phase 4 assigns it; when set and returns text, the notification body uses it).
- `openLiveView`: if driver has `createSdpSession` → return `{ok: true, mode: 'sdp-bridge', key}`; else existing WHEP path (`mode: 'whep'`).
- New `answerLiveView(key, offerSdp) -> {ok, answerSdp?}`; `closeLiveView` also closes sdp sessions.
- IPC: `cameras:live-answer`; preload `liveAnswer(key, offerSdp)`; `onCamerasAlert` event.
- [ ] Steps: failing tests (motion event → notify + log + emit with dedupe; sdp-bridge live view flow) → implement → full suite → commit `feat(camera): alerts pipeline with notifications and SDP bridge`.

### Task 4: UI — Ring sign-in tab + live view bridge + alert toasts

**Files:** modify `src/index.html`, `src/cameras-ui.js`, `src/styles.css`.

- Third brand tab `RING`: email/password + `SIGN IN`; when the service answers `needs2fa`, show code row (`VERIFY CODE`) — mirrors the Blink PIN flow (service: `addRingAccount` two-step, Task 3 wiring includes `cameras:add-ring` + `cameras:ring-code` IPC).
- `toggleLive`: branch on `live.mode` — `'whep'` → existing fetch; `'sdp-bridge'` → offer via `window.jarvis.cameras.liveAnswer(key, offerSdp)`, apply answer.
- Alerts: `window.jarvis.onCamerasAlert` → refresh that tile's snapshot + show the existing toast (`showToast` is renderer.js-scoped; use the module's `.camera-stamp` + a small badge instead).
- [ ] Steps: markup + JS + styles → syntax checks → capture boot → commit `feat(camera): Ring UI and live alert badges`.

### Task 5: Verification

- [ ] `npm test`, `node --check` all, `npm audit --omit=dev`, capture boot. Real-account checklist for Adam (Ring account, 2FA code, snapshot, live view, arm location, doorbell press → notification).
