# Camera Module Phase 2 (Blink Driver) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Blink accounts in the Cameras module: email/password + 2FA PIN sign-in, camera snapshots (battery-protected), and system arm/disarm with explicit confirmation.

**Architecture:** A pure REST client (`blink-client.js`, endpoints per MattTW/BlinkMonitorProtocol, verified 2026-07-14) wrapped by a `BlinkDriver` implementing the Phase 1 contract. Driver contract gains `listSystems()`/`persistSecrets` for arm-able systems and token refresh persistence. Spec: `docs/superpowers/specs/2026-07-14-camera-module-design.md`.

**Tech Stack:** Node built-ins only (global `fetch`); no new npm dependencies.

## Global Constraints

- Same as Phase 1 (secrets via safeStorage only, activity-log lines, plain-English copy, full test/syntax/audit pass per commit, no version bump).
- Blink `snapshotCooldownMs = 600000` (10 min) — battery protection.
- **Approval deviation (documented):** the tile/strip ARM control uses an in-tile two-step confirmation (ARM → "CONFIRM?" within 5 s), not the router approval modal — the modal is owned by renderer.js's command flow. Voice-command arm/disarm will use the standard approval card when routed through CommandRouter in Phase 3.
- Unofficial-API rule: every Blink HTTP failure surfaces as a driver status message, never a silent failure.

---

### Task 1: Blink REST client

**Files:**
- Create: `core/camera/blink-client.js`
- Test: `test/camera.test.js` (append)

**Interfaces (produces):**
`class BlinkClient` — `constructor({fetchFn})` (defaults to global fetch);
- `async login({email, password, uniqueId}) -> {token, accountId, clientId, tier, verificationRequired}` — POST `https://rest-prod.immedia-semi.com/api/v5/account/login` body `{email, password, unique_id, device_identifier: 'JARVIS Windows Assistant', client_name: 'JARVIS', reauth: 'true'}`.
- `host(tier) -> "https://rest-{tier}.immedia-semi.com"`.
- `async verifyPin(session, pin) -> {ok, message}` — POST `/api/v4/account/{accountId}/client/{clientId}/pin/verify` body `{pin}`.
- `async homescreen(session) -> raw JSON` — GET `/api/v3/accounts/{accountId}/homescreen`.
- `async requestThumbnail(session, networkId, cameraId, type)` — POST `/network/{networkId}/camera/{cameraId}/thumbnail` for type `'camera'`; owls use `/api/v1/accounts/{accountId}/networks/{networkId}/owls/{cameraId}/thumbnail`; doorbells `/api/v1/accounts/{accountId}/networks/{networkId}/doorbells/{cameraId}/thumbnail`.
- `async getImage(session, path) -> Buffer` — GET `{host}{path}` (appends `.jpg` if missing extension).
- `async setArmed(session, networkId, armed)` — POST `/api/v1/accounts/{accountId}/networks/{networkId}/state/{arm|disarm}`.
All authenticated calls send header `TOKEN-AUTH: session.token`. `session = {token, accountId, clientId, tier}`. Non-2xx → throw `Error` with the server's `message` field when present.

- [ ] Steps: failing tests with a recorded-response fake fetch (login happy path incl. tier + verification flag; verifyPin; homescreen; setArmed URL shape; getImage returns Buffer; non-2xx throws server message) → verify fail → implement → pass → commit `feat(camera): Blink REST client`.

### Task 2: Contract extension (`listSystems` + `persistSecrets`)

**Files:** Modify `core/camera/driver-interface.js`; test append.

- `CameraDriver.constructor({account, secrets, persistSecrets})` stores `this.persistSecrets = persistSecrets || (() => {})` — drivers call it with the full secrets object whenever tokens rotate.
- New default method `async listSystems() { return []; }` — shape `[{id, name, armed, canArm}]`.
- CameraService passes `persistSecrets: (secrets) => config.setSecret(secretKey, JSON.stringify(secrets))` in `#instantiate`.
- [ ] Steps: extend base-driver test (listSystems default, persistSecrets callable) → implement → full suite → commit `feat(camera): driver contract systems and secret persistence`.

### Task 3: Blink driver

**Files:** Create `core/camera/drivers/blink-driver.js`; test append (fake BlinkClient injected via `clientFactory` option).

Behavior:
- secrets: `{email, password, uniqueId, token, accountId, clientId, tier}`.
- `connect()`: if token exists try `homescreen` (token still valid → connected); on 401 or no token → `login`; if `verificationRequired` → `setState('verify', 'Enter the PIN Blink emailed you.')` and return; persist rotated session via `persistSecrets`.
- `submitPin(pin)`: verifyPin → on ok, reload homescreen → connected; persist.
- `listCameras()`: homescreen `cameras` + `owls` + `doorbells` → `{id, name, brand: 'blink', canStream: false, canArm: false, networkId, kind}` (kind: camera|owl|doorbell). Homescreen cached 30 s.
- `listSystems()`: homescreen `networks` → `{id, name, armed, canArm: true}`.
- `getSnapshot(cameraId)`: requestThumbnail (fresh) → wait 3 s → reload homescreen → getImage(thumbnail path). On requestThumbnail failure fall back to current thumbnail.
- `setArmed(networkId, armed)`: client.setArmed; refresh homescreen cache.
- `snapshotCooldownMs = 600000`; `brand === 'blink'`.
- [ ] Steps: failing tests (connect happy/verify paths, listCameras merges three camera kinds, listSystems, snapshot fallback, setArmed) → implement → pass → commit `feat(camera): Blink driver with 2FA and battery-safe snapshots`.

### Task 4: Service + IPC + preload wiring

**Files:** Modify `core/camera/camera-service.js`, `main.js`, `preload.js`; test append.

- `driverClasses` gains `blink: BlinkDriver`.
- `async addBlinkAccount({email, password}) -> {ok, needsPin?, accountId?, message}` — creates account `{id, brand: 'blink', name: email}`, secrets `{email, password, uniqueId: crypto.randomUUID()}`, instantiates + connects; `needsPin` true when driver state is `'verify'`.
- `async submitBlinkPin(accountId, pin) -> {ok, message}`.
- `async listSystems() -> [{key: accountId + ':' + id, name, armed, canArm, accountId}]` aggregated.
- `async setArmed(systemKey, armed) -> {ok, message}` — logs an activity line `camera arm`/`camera disarm`.
- IPC: `cameras:add-blink`, `cameras:blink-pin`, `cameras:systems`, `cameras:set-armed` (+ preload `addBlink`, `blinkPin`, `systems`, `setArmed`). `cameras:bootstrap` payload gains `systems`.
- [ ] Steps: failing service tests (add → needsPin flow → pin → cameras listed; setArmed logs) → implement → full suite + `node --check` → commit `feat(camera): Blink account flow through service and IPC`.

### Task 5: UI — brand tabs, PIN step, systems strip

**Files:** Modify `src/index.html`, `src/cameras-ui.js`, `src/styles.css`.

- Add form gains brand tabs: `LOCAL (RTSP)` | `BLINK`. Blink pane: email, password (`type="password"`, cleared after submit), SIGN IN button; hidden PIN row appears when `needsPin` (input + VERIFY button + "Blink emailed a PIN to your address").
- Systems strip above the grid: per system `NAME — ARMED/DISARMED` + toggle button with two-step confirm (`ARM` → `CONFIRM ARM?` for 5 s → executes; same for disarm).
- Brand badge already shows via `camera.brand`.
- [ ] Steps: markup + JS + styles → `node --check src/cameras-ui.js` → capture-mode boot (no console errors) → commit `feat(camera): Blink sign-in UI and arm/disarm strip`.

### Task 6: Verification pass

- [ ] `npm test`, all `node --check` targets, `npm audit --omit=dev`, capture-mode boot, commit fixes. Real-account checklist for Adam: sign in with his Blink email/password, enter emailed PIN, see his cameras' thumbnails, refresh one, arm/disarm with confirm, verify `settings.json` holds no password (only in encrypted secrets), pull a diagnostic that omits secrets.
