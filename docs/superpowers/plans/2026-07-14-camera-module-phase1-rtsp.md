# Camera Module Phase 1 (Foundation + RTSP/ONVIF) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working Cameras floating module with the driver interface, a supervised go2rtc streaming helper, and a generic RTSP/ONVIF driver — live view + snapshots for local network cameras, no cloud auth.

**Architecture:** New `core/camera/` services in the Electron main process (service-class pattern like `local-voice-service.js`). A bundled go2rtc.exe (spawned, watchdogged, bound to 127.0.0.1) converts camera streams to WebRTC that the renderer plays via WHEP. Drivers implement a six-method contract; the UI only sees the contract. Spec: `docs/superpowers/specs/2026-07-14-camera-module-design.md`.

**Tech Stack:** Electron 43 main process (CommonJS, Node built-ins), go2rtc v1.9.9 binary, `onvif` npm package (discovery only), `node:test` for tests, WHEP (`RTCPeerConnection`) in the sandboxed renderer.

## Global Constraints

- Secrets (RTSP URLs contain passwords) go through `config.setSecret`/`getSecret` (safeStorage) — never in `settings.json` plain text, never in logs or diagnostic reports.
- go2rtc binds `127.0.0.1` only; the renderer CSP opens `connect-src` for `http://127.0.0.1:*` and `ws://127.0.0.1:*` and nothing else.
- Every snapshot/live-view access writes an activity-log line (`log.write({type: 'camera', ...})`).
- All user-facing copy is plain English for a novice (match existing tone: "That folder is outside your approved search locations.").
- No arbitrary shell execution; the only spawned binary is the pinned go2rtc.exe.
- `npm test`, `node --check main.js`, `node --check preload.js`, `node --check src/renderer.js`, `node --check src/cameras-ui.js` must pass at every commit.
- Do not bump the app version or CHANGELOG (that happens only when a real installer is produced).

---

### Task 1: go2rtc binary acquisition + build packaging

**Files:**
- Create: `scripts/get-go2rtc.ps1`
- Create: `resources/go2rtc/.gitignore`
- Modify: `package.json` (build.extraResources)

**Interfaces:**
- Produces: `resources/go2rtc/go2rtc.exe` on disk (dev), `process.resourcesPath/go2rtc/go2rtc.exe` (packaged); `resources/go2rtc/go2rtc.exe.sha256` (committed pin).

- [ ] **Step 1: Write the fetch script**

```powershell
# scripts/get-go2rtc.ps1 — download the pinned go2rtc streaming helper.
# First run records the SHA-256 pin; later runs verify against it.
param([string]$Version = "1.9.9")
$ErrorActionPreference = "Stop"
$dir = Join-Path $PSScriptRoot "..\resources\go2rtc"
$exe = Join-Path $dir "go2rtc.exe"
$shaFile = "$exe.sha256"
New-Item -ItemType Directory -Force $dir | Out-Null
$url = "https://github.com/AlexxIT/go2rtc/releases/download/v$Version/go2rtc_win64.zip"
$zip = Join-Path $env:TEMP "go2rtc_win64.zip"
Invoke-WebRequest -Uri $url -OutFile $zip
Expand-Archive -Path $zip -DestinationPath $dir -Force
Remove-Item $zip
$hash = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLower()
if (Test-Path $shaFile) {
  $expected = (Get-Content $shaFile -Raw).Trim().ToLower()
  if ($hash -ne $expected) { throw "go2rtc.exe hash $hash does not match pinned $expected" }
  Write-Host "go2rtc $Version verified against pinned hash."
} else {
  Set-Content -Path $shaFile -Value $hash -Encoding ascii
  Write-Host "go2rtc $Version downloaded. Pinned hash $hash (commit go2rtc.exe.sha256)."
}
```

- [ ] **Step 2: Ignore the binary, keep the pin**

`resources/go2rtc/.gitignore`:
```
go2rtc.exe
```

- [ ] **Step 3: Run the script**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/get-go2rtc.ps1`
Expected: `resources/go2rtc/go2rtc.exe` exists; `.sha256` file created; message with pinned hash.

- [ ] **Step 4: Package it**

In `package.json` `"build"` add:
```json
"extraResources": [
  { "from": "resources/go2rtc", "to": "go2rtc", "filter": ["go2rtc.exe"] }
]
```

- [ ] **Step 5: Commit**

```bash
git add scripts/get-go2rtc.ps1 resources/go2rtc/.gitignore resources/go2rtc/go2rtc.exe.sha256 package.json
git commit -m "feat(camera): add pinned go2rtc fetch script and packaging"
```

---

### Task 2: Driver contract (`driver-interface.js`)

**Files:**
- Create: `core/camera/driver-interface.js`
- Test: `test/camera.test.js` (new file; camera tests live here, not in core.test.js)

**Interfaces:**
- Produces: `class CameraDriver extends EventEmitter` with `constructor({account, secrets})`, `get brand()`, `async connect()`, `async disconnect()`, `async listCameras() -> [{id, name, brand, canStream, canArm}]`, `async getSnapshot(cameraId) -> Buffer`, `async getStreamSource(cameraId) -> string|null`, `async setArmed(systemId, armed)`, `status() -> {state, message}`, `setState(state, message)`, `snapshotCooldownMs` (number, default 0). `class NotSupportedError extends Error` with `code === 'NOT_SUPPORTED'`. Emits `'status'`, later drivers emit `'motion'`/`'doorbell'`.

- [ ] **Step 1: Write the failing test**

```js
// test/camera.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { CameraDriver, NotSupportedError } = require('../core/camera/driver-interface');

test('base driver: contract shape and NotSupported defaults', async () => {
  const driver = new CameraDriver({ account: { id: 'a1', name: 'Test' }, secrets: {} });
  assert.equal(driver.brand, 'generic');
  assert.deepEqual(await driver.listCameras(), []);
  assert.equal(await driver.getStreamSource('x'), null);
  assert.equal(driver.snapshotCooldownMs, 0);
  await assert.rejects(() => driver.getSnapshot('x'), (e) => e.code === 'NOT_SUPPORTED');
  await assert.rejects(() => driver.setArmed('x', true), (e) => e.code === 'NOT_SUPPORTED');
  const seen = [];
  driver.on('status', (s) => seen.push(s));
  driver.setState('connected', 'ok');
  assert.deepEqual(driver.status(), { state: 'connected', message: 'ok' });
  assert.deepEqual(seen, [{ state: 'connected', message: 'ok' }]);
  assert.ok(new NotSupportedError('Arming') instanceof Error);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/camera.test.js`
Expected: FAIL — cannot find module `../core/camera/driver-interface`

- [ ] **Step 3: Implement**

```js
// core/camera/driver-interface.js
const { EventEmitter } = require('node:events');

class NotSupportedError extends Error {
  constructor(action) {
    super(`${action} is not supported by this camera brand.`);
    this.code = 'NOT_SUPPORTED';
  }
}

// Contract every camera brand implements. The Cameras UI and camera-service
// only ever talk to this shape — never to brand-specific code.
class CameraDriver extends EventEmitter {
  constructor({ account, secrets }) {
    super();
    this.account = account || {};
    this.secrets = secrets || {};
    this.state = 'disconnected';
    this.message = '';
    this.snapshotCooldownMs = 0; // brands with battery cameras override this
  }

  get brand() { return 'generic'; }
  async connect() { this.setState('connected'); }
  async disconnect() { this.setState('disconnected'); }
  async listCameras() { return []; }
  async getSnapshot() { throw new NotSupportedError('Snapshots'); }
  async getStreamSource() { return null; }
  async setArmed() { throw new NotSupportedError('Arming'); }

  setState(state, message = '') {
    this.state = state;
    this.message = message;
    this.emit('status', { state, message });
  }

  status() { return { state: this.state, message: this.message }; }
}

module.exports = { CameraDriver, NotSupportedError };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/camera.test.js` — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add core/camera/driver-interface.js test/camera.test.js
git commit -m "feat(camera): driver contract with NotSupported defaults"
```

---

### Task 3: go2rtc supervisor (`go2rtc-manager.js`)

**Files:**
- Create: `core/camera/go2rtc-manager.js`
- Test: `test/camera.test.js` (append)

**Interfaces:**
- Consumes: nothing from other tasks (standalone).
- Produces: `class Go2RtcManager` — `constructor({binaryPath, dataDir, emit, spawnFn, fetchFn})`, `installed() -> bool`, `async start() -> {ok, message}` (idempotent), `async stop()`, `apiBase() -> "http://127.0.0.1:<port>"`, `async setStream(name, source)`, `async removeStream(name)`, `async snapshot(name) -> Buffer`, `whepUrl(name) -> string`, `getStatus() -> {installed, running, message}`. Spawns `go2rtc.exe -config <dataDir>/go2rtc.yaml`; no startup health poll (API calls retry naturally); restart-once watchdog on exit, then red status (voice-engine pattern).

- [ ] **Step 1: Write the failing tests**

```js
// append to test/camera.test.js
const fsx = require('node:fs');
const osx = require('node:os');
const pathx = require('node:path');
const { EventEmitter: EE } = require('node:events');
const { Go2RtcManager } = require('../core/camera/go2rtc-manager');

function fakeChild() {
  const child = new EE();
  child.kill = () => child.emit('exit', 0);
  return child;
}

test('go2rtc manager: reports not installed without the binary', async () => {
  const dir = fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'jarvis-go2rtc-'));
  try {
    const manager = new Go2RtcManager({ binaryPath: pathx.join(dir, 'missing.exe'), dataDir: dir, emit: () => {} });
    assert.equal(manager.installed(), false);
    const result = await manager.start();
    assert.equal(result.ok, false);
    assert.match(result.message, /streaming helper/i);
  } finally { fsx.rmSync(dir, { recursive: true, force: true }); }
});

test('go2rtc manager: writes localhost-only config, starts, and manages streams', async () => {
  const dir = fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'jarvis-go2rtc-'));
  try {
    const binary = pathx.join(dir, 'go2rtc.exe');
    fsx.writeFileSync(binary, 'stub');
    const calls = [];
    const manager = new Go2RtcManager({
      binaryPath: binary,
      dataDir: dir,
      emit: () => {},
      spawnFn: (cmd, args) => { calls.push({ kind: 'spawn', cmd, args }); return fakeChild(); },
      fetchFn: async (url, options) => { calls.push({ kind: 'fetch', url, method: options?.method || 'GET' }); return { ok: true, arrayBuffer: async () => new ArrayBuffer(3) }; }
    });
    const started = await manager.start();
    assert.equal(started.ok, true);
    const yaml = fsx.readFileSync(pathx.join(dir, 'go2rtc.yaml'), 'utf8');
    assert.match(yaml, /127\.0\.0\.1/);
    assert.doesNotMatch(yaml, /0\.0\.0\.0/);
    assert.match(manager.apiBase(), /^http:\/\/127\.0\.0\.1:\d+$/);
    await manager.setStream('cam_a', 'rtsp://user:pw@192.168.1.20/stream1');
    const put = calls.find((c) => c.kind === 'fetch' && c.method === 'PUT');
    assert.ok(put && put.url.includes('cam_a'));
    // The RTSP URL (contains a password) must be query-encoded, not logged raw anywhere else.
    assert.ok(put.url.includes(encodeURIComponent('rtsp://user:pw@192.168.1.20/stream1')));
    const frame = await manager.snapshot('cam_a');
    assert.ok(Buffer.isBuffer(frame) && frame.length === 3);
    assert.match(manager.whepUrl('cam_a'), /\/api\/webrtc\?src=cam_a$/);
    await manager.stop();
    assert.equal(manager.getStatus().running, false);
  } finally { fsx.rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/camera.test.js` — Expected: FAIL — cannot find module `go2rtc-manager`

- [ ] **Step 3: Implement**

```js
// core/camera/go2rtc-manager.js
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

// Supervises the bundled go2rtc.exe: localhost-only config, health poll,
// restart-once watchdog (same philosophy as the local voice engine).
class Go2RtcManager {
  constructor({ binaryPath, dataDir, emit, spawnFn = spawn, fetchFn = globalThis.fetch }) {
    this.binaryPath = binaryPath;
    this.dataDir = dataDir;
    this.emit = emit || (() => {});
    this.spawnFn = spawnFn;
    this.fetchFn = fetchFn;
    this.process = null;
    this.apiPort = 0;
    this.retried = false;
    this.message = 'Streaming helper not started';
    this.starting = null;
  }

  installed() { return fs.existsSync(this.binaryPath); }
  apiBase() { return `http://127.0.0.1:${this.apiPort}`; }
  whepUrl(name) { return `${this.apiBase()}/api/webrtc?src=${encodeURIComponent(name)}`; }
  getStatus() { return { installed: this.installed(), running: Boolean(this.process), message: this.message }; }

  configPath() { return path.join(this.dataDir, 'go2rtc.yaml'); }

  writeConfig(apiPort, webrtcPort) {
    const yaml = [
      'api:',
      `  listen: "127.0.0.1:${apiPort}"`,
      'rtsp:',
      '  listen: ""',
      'webrtc:',
      `  listen: "127.0.0.1:${webrtcPort}/tcp"`,
      'srtp:',
      '  listen: ""',
      'log:',
      '  level: warn',
      ''
    ].join('\n');
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.writeFileSync(this.configPath(), yaml, 'utf8');
  }

  async start() {
    if (this.process) return { ok: true, message: this.message };
    if (this.starting) return this.starting;
    if (!this.installed()) {
      this.message = 'The camera streaming helper is missing. Reinstall JARVIS to restore it.';
      return { ok: false, message: this.message };
    }
    this.starting = (async () => {
      this.apiPort = await freePort();
      const webrtcPort = await freePort();
      this.writeConfig(this.apiPort, webrtcPort);
      const child = this.spawnFn(this.binaryPath, ['-config', this.configPath()], {
        cwd: this.dataDir, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore']
      });
      this.process = child;
      child.on('error', () => this.#handleExit(child));
      child.on('exit', () => this.#handleExit(child));
      this.message = 'Streaming helper running';
      this.emit('cameras:helper', this.getStatus());
      return { ok: true, message: this.message };
    })();
    try { return await this.starting; } finally { this.starting = null; }
  }

  #handleExit(child) {
    if (this.process !== child) return;
    this.process = null;
    if (this.stopping) return;
    if (!this.retried) {
      this.retried = true;
      this.message = 'Streaming helper stopped — restarting it';
      this.emit('cameras:helper', this.getStatus());
      this.start();
    } else {
      this.message = 'The camera streaming helper keeps stopping. Open Diagnostics → Cameras and copy the report.';
      this.emit('cameras:helper', this.getStatus());
    }
  }

  async stop() {
    this.stopping = true;
    if (this.process) { try { this.process.kill(); } catch {} }
    this.process = null;
    this.message = 'Streaming helper stopped';
    this.stopping = false;
  }

  async #api(pathname, options = {}) {
    const response = await this.fetchFn(`${this.apiBase()}${pathname}`, options);
    if (!response.ok) throw new Error(`Streaming helper error ${response.status || ''}`.trim());
    return response;
  }

  async setStream(name, source) {
    await this.#api(`/api/streams?name=${encodeURIComponent(name)}&src=${encodeURIComponent(source)}`, { method: 'PUT' });
  }

  async removeStream(name) {
    await this.#api(`/api/streams?src=${encodeURIComponent(name)}`, { method: 'DELETE' });
  }

  async snapshot(name) {
    const response = await this.#api(`/api/frame.jpeg?src=${encodeURIComponent(name)}`);
    return Buffer.from(await response.arrayBuffer());
  }
}

module.exports = { Go2RtcManager, freePort };
```

- [ ] **Step 4: Run tests** — `node --test test/camera.test.js` — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add core/camera/go2rtc-manager.js test/camera.test.js
git commit -m "feat(camera): go2rtc supervisor with localhost-only config and watchdog"
```

---

### Task 4: RTSP driver

**Files:**
- Create: `core/camera/drivers/rtsp-driver.js`
- Test: `test/camera.test.js` (append)

**Interfaces:**
- Consumes: `CameraDriver`, `NotSupportedError` from Task 2.
- Produces: `class RtspDriver extends CameraDriver` with `brand === 'rtsp'`. Secrets shape: `{cameras: [{id, name, url}]}` (the URL holds credentials — secret). `listCameras()` returns `{id, name, brand: 'rtsp', canStream: true, canArm: false}`. `getStreamSource(id)` returns the RTSP URL. `getSnapshot` stays NotSupported — camera-service falls back to go2rtc `frame.jpeg` for any streamable camera.

- [ ] **Step 1: Failing test**

```js
// append to test/camera.test.js
const { RtspDriver } = require('../core/camera/drivers/rtsp-driver');

test('rtsp driver: lists cameras from secrets and exposes stream sources', async () => {
  const driver = new RtspDriver({
    account: { id: 'a1', name: 'Home cams' },
    secrets: { cameras: [{ id: 'front', name: 'Front Door', url: 'rtsp://u:p@192.168.1.20/stream1' }] }
  });
  await driver.connect();
  assert.equal(driver.brand, 'rtsp');
  assert.equal(driver.status().state, 'connected');
  const cameras = await driver.listCameras();
  assert.deepEqual(cameras, [{ id: 'front', name: 'Front Door', brand: 'rtsp', canStream: true, canArm: false }]);
  assert.equal(await driver.getStreamSource('front'), 'rtsp://u:p@192.168.1.20/stream1');
  assert.equal(await driver.getStreamSource('nope'), null);
  await assert.rejects(() => driver.getSnapshot('front'), (e) => e.code === 'NOT_SUPPORTED');
  await assert.rejects(() => driver.setArmed('front', true), (e) => e.code === 'NOT_SUPPORTED');
});
```

- [ ] **Step 2: Run** — Expected FAIL (module missing)

- [ ] **Step 3: Implement**

```js
// core/camera/drivers/rtsp-driver.js
const { CameraDriver } = require('../driver-interface');

// Generic local-network cameras (Reolink, Amcrest, Hikvision, Tapo, ...).
// The RTSP URLs contain credentials, so the camera list lives in secrets.
class RtspDriver extends CameraDriver {
  get brand() { return 'rtsp'; }

  #cameras() { return Array.isArray(this.secrets.cameras) ? this.secrets.cameras : []; }

  async listCameras() {
    return this.#cameras().map((camera) => ({
      id: camera.id, name: camera.name, brand: 'rtsp', canStream: true, canArm: false
    }));
  }

  async getStreamSource(cameraId) {
    const camera = this.#cameras().find((item) => item.id === cameraId);
    return camera ? camera.url : null;
  }
}

module.exports = { RtspDriver };
```

- [ ] **Step 4: Run tests** — Expected PASS

- [ ] **Step 5: Commit**

```bash
git add core/camera/drivers/rtsp-driver.js test/camera.test.js
git commit -m "feat(camera): generic RTSP driver"
```

---

### Task 5: Settings migration for camera accounts

**Files:**
- Modify: `core/defaults.js` (settingsVersion 6, `cameraAccounts: []`, `hiddenModules` + `moduleLayout` entries for `cameras`)
- Modify: `core/config-store.js` (`mergeSettings` migration, `updateSettings` allowlist)
- Test: `test/camera.test.js` (append)

**Interfaces:**
- Produces: `settings.cameraAccounts: [{id, brand, name}]` (non-secret metadata only); secrets per account under key `cameraAccount:<id>`. `moduleLayout.cameras = { x: 26, y: 8, w: 46, h: 60 }`; `'cameras'` in default `hiddenModules`; upgrades from version <6 gain `'cameras'` in hiddenModules.

- [ ] **Step 1: Failing test**

```js
// append to test/camera.test.js
const { mergeSettings: mergeS } = require('../core/config-store');
const { DEFAULT_SETTINGS: DEFAULTS } = require('../core/defaults');

test('settings v6: camera module hidden by default and migrated for old saves', () => {
  assert.equal(DEFAULTS.settingsVersion, 6);
  assert.deepEqual(DEFAULTS.cameraAccounts, []);
  assert.ok(DEFAULTS.hiddenModules.includes('cameras'));
  assert.ok(DEFAULTS.moduleLayout.cameras);
  const migrated = mergeS(DEFAULTS, { settingsVersion: 5, hiddenModules: [] });
  assert.ok(migrated.hiddenModules.includes('cameras'));
  assert.equal(migrated.settingsVersion, 6);
  // Old saves must not lose camera accounts on merge.
  const kept = mergeS(DEFAULTS, { settingsVersion: 6, cameraAccounts: [{ id: 'a1', brand: 'rtsp', name: 'Home' }] });
  assert.equal(kept.cameraAccounts.length, 1);
});
```

- [ ] **Step 2: Run** — Expected FAIL (`settingsVersion` is 5)

- [ ] **Step 3: Implement**

In `core/defaults.js`: change `settingsVersion: 5` → `6`; add to `DEFAULT_SETTINGS`:
```js
  cameraAccounts: [],
```
add to `hiddenModules` array: `'cameras'`; add to `moduleLayout`:
```js
    cameras: { x: 26, y: 8, w: 46, h: 60 }
```

In `core/config-store.js` `mergeSettings`, after the version-5 block:
```js
  if (Number(saved?.settingsVersion || 0) < 6) {
    result.hiddenModules = [...new Set([...(result.hiddenModules || []), 'cameras'])];
  }
  result.settingsVersion = 6;
  result.cameraAccounts = Array.isArray(result.cameraAccounts) ? result.cameraAccounts : [];
```
(replace the existing `result.settingsVersion = 5;` line — the version-5 hiddenModules block stays).

In `updateSettings` allowlist add `'cameraAccounts'`.

- [ ] **Step 4: Run ALL tests** — `npm test` — Expected: PASS (including existing core.test.js, which asserts on mergeSettings)

- [ ] **Step 5: Commit**

```bash
git add core/defaults.js core/config-store.js test/camera.test.js
git commit -m "feat(camera): settings v6 with cameraAccounts and cameras module defaults"
```

---

### Task 6: Camera service (orchestrator)

**Files:**
- Create: `core/camera/camera-service.js`
- Test: `test/camera.test.js` (append)

**Interfaces:**
- Consumes: `Go2RtcManager` (Task 3), `RtspDriver` (Task 4), `config` (`getSettings/updateSettings/getSecret/setSecret`), `log.write`, `emit`.
- Produces: `class CameraService` —
  - `constructor({config, emit, log, go2rtc, driverClasses})` (`driverClasses` defaults to `{rtsp: RtspDriver}`)
  - `async init()` — instantiate + connect drivers for saved accounts
  - `listAccounts() -> [{id, brand, name, status}]` (never secrets)
  - `async addRtspAccount({name, cameras}) -> {ok, message}` — cameras `[{name, url}]`; generates ids
  - `async removeAccount(accountId) -> {ok}` — deletes secret, disconnects driver
  - `async listCameras() -> [{key, id, name, brand, accountId, canStream, canArm}]` (`key = accountId + ':' + id`)
  - `async getSnapshot(key, {manual}) -> {ok, jpegBase64?, takenAt?, message?}` — driver first; NOT_SUPPORTED + canStream → go2rtc frame; enforces `driver.snapshotCooldownMs` for `manual: false`
  - `async openLiveView(key) -> {ok, whepUrl?, message?}`; `async closeLiveView(key)`
  - `getStatus() -> {helper, accounts: [{id, brand, name, state, message}]}`
  - `async shutdown()` — close streams, stop go2rtc
  - emits `'cameras:changed'` after account changes; logs every snapshot/live view.

- [ ] **Step 1: Failing tests**

```js
// append to test/camera.test.js
const { CameraService } = require('../core/camera/camera-service');

function fakeConfig() {
  let settings = { cameraAccounts: [] };
  const secrets = {};
  return {
    getSettings: () => JSON.parse(JSON.stringify(settings)),
    updateSettings: (patch) => { settings = { ...settings, ...patch }; return settings; },
    getSecret: (name) => secrets[name] || '',
    setSecret: (name, value) => { if (!value) delete secrets[name]; else secrets[name] = value; },
    _secrets: secrets
  };
}

function fakeGo2rtc() {
  const streams = new Map();
  return {
    start: async () => ({ ok: true }),
    stop: async () => {},
    setStream: async (name, source) => streams.set(name, source),
    removeStream: async (name) => streams.delete(name),
    snapshot: async () => Buffer.from([0xff, 0xd8, 0xff]),
    whepUrl: (name) => `http://127.0.0.1:9999/api/webrtc?src=${name}`,
    getStatus: () => ({ installed: true, running: true, message: 'ok' }),
    _streams: streams
  };
}

test('camera service: rtsp account lifecycle, snapshots via helper, live view', async () => {
  const config = fakeConfig();
  const go2rtc = fakeGo2rtc();
  const logged = [];
  const service = new CameraService({
    config, go2rtc, emit: () => {}, log: { write: (entry) => logged.push(entry) }
  });
  await service.init();

  const added = await service.addRtspAccount({ name: 'Home', cameras: [{ name: 'Front Door', url: 'rtsp://u:p@192.168.1.20/s1' }] });
  assert.equal(added.ok, true);
  const accounts = service.listAccounts();
  assert.equal(accounts.length, 1);
  assert.ok(!JSON.stringify(accounts).includes('rtsp://'), 'secrets must not leak in account listings');
  assert.ok(!JSON.stringify(config.getSettings()).includes('rtsp://'), 'URLs must not be in settings.json');

  const cameras = await service.listCameras();
  assert.equal(cameras.length, 1);
  assert.equal(cameras[0].name, 'Front Door');

  const shot = await service.getSnapshot(cameras[0].key, { manual: true });
  assert.equal(shot.ok, true);
  assert.ok(shot.jpegBase64.length > 0);
  assert.ok(logged.some((entry) => entry.type === 'camera'));

  const live = await service.openLiveView(cameras[0].key);
  assert.equal(live.ok, true);
  assert.match(live.whepUrl, /api\/webrtc/);
  assert.equal(go2rtc._streams.size, 1);
  await service.closeLiveView(cameras[0].key);
  assert.equal(go2rtc._streams.size, 0);

  const removed = await service.removeAccount(accounts[0].id);
  assert.equal(removed.ok, true);
  assert.equal((await service.listCameras()).length, 0);
  assert.equal(Object.keys(config._secrets).length, 0, 'secret deleted with account');
});

test('camera service: cooldown blocks automatic snapshots but not manual ones', async () => {
  const config = fakeConfig();
  const service = new CameraService({ config, go2rtc: fakeGo2rtc(), emit: () => {}, log: { write: () => {} } });
  await service.init();
  await service.addRtspAccount({ name: 'Home', cameras: [{ name: 'Cam', url: 'rtsp://u:p@h/s' }] });
  const [camera] = await service.listCameras();
  // Force a cooldown as battery-brand drivers will set (rtsp default is 0).
  service.drivers.get(camera.accountId).snapshotCooldownMs = 600000;
  const first = await service.getSnapshot(camera.key, { manual: false });
  assert.equal(first.ok, true);
  const second = await service.getSnapshot(camera.key, { manual: false });
  assert.equal(second.ok, false);
  assert.match(second.message, /battery|recent/i);
  const manual = await service.getSnapshot(camera.key, { manual: true });
  assert.equal(manual.ok, true);
});
```

- [ ] **Step 2: Run** — Expected FAIL (module missing)

- [ ] **Step 3: Implement**

```js
// core/camera/camera-service.js
const crypto = require('node:crypto');
const { RtspDriver } = require('./drivers/rtsp-driver');
const { NotSupportedError } = require('./driver-interface');

function streamName(key) { return `cam_${key.replace(/[^a-zA-Z0-9]+/g, '_')}`; }

// Orchestrates accounts, drivers, snapshots, and live view sessions.
// Brand code stays in drivers; secrets stay in config secrets storage.
class CameraService {
  constructor({ config, emit, log, go2rtc, driverClasses }) {
    this.config = config;
    this.emit = emit || (() => {});
    this.log = log || { write: () => {} };
    this.go2rtc = go2rtc;
    this.driverClasses = driverClasses || { rtsp: RtspDriver };
    this.drivers = new Map(); // accountId -> driver
    this.lastAutoSnapshot = new Map(); // camera key -> timestamp
    this.liveViews = new Set(); // stream names
  }

  async init() {
    for (const account of this.config.getSettings().cameraAccounts || []) {
      await this.#instantiate(account);
    }
  }

  #secretKey(accountId) { return `cameraAccount:${accountId}`; }

  #readSecrets(accountId) {
    try { return JSON.parse(this.config.getSecret(this.#secretKey(accountId)) || '{}'); }
    catch { return {}; }
  }

  async #instantiate(account) {
    const DriverClass = this.driverClasses[account.brand];
    if (!DriverClass) return;
    const driver = new DriverClass({ account, secrets: this.#readSecrets(account.id) });
    driver.on('status', () => this.emit('cameras:status', this.getStatus()));
    this.drivers.set(account.id, driver);
    try { await driver.connect(); }
    catch (error) { driver.setState('error', `Could not connect: ${error.message}`); }
  }

  listAccounts() {
    return (this.config.getSettings().cameraAccounts || []).map((account) => ({
      ...account,
      status: this.drivers.get(account.id)?.status() || { state: 'disconnected', message: '' }
    }));
  }

  async addRtspAccount({ name, cameras }) {
    const cleanName = String(name || '').trim() || 'My cameras';
    const list = (cameras || [])
      .map((camera) => ({ id: crypto.randomUUID().slice(0, 8), name: String(camera.name || '').trim() || 'Camera', url: String(camera.url || '').trim() }))
      .filter((camera) => /^rtsps?:\/\//i.test(camera.url));
    if (!list.length) return { ok: false, message: 'Add at least one camera with an address that starts with rtsp://' };
    const account = { id: crypto.randomUUID().slice(0, 8), brand: 'rtsp', name: cleanName };
    this.config.setSecret(this.#secretKey(account.id), JSON.stringify({ cameras: list }));
    const accounts = [...(this.config.getSettings().cameraAccounts || []), account];
    this.config.updateSettings({ cameraAccounts: accounts });
    await this.#instantiate(account);
    this.emit('cameras:changed', {});
    this.log.write({ type: 'camera', command: 'add cameras', response: `Added ${list.length} local camera${list.length === 1 ? '' : 's'} to "${cleanName}".`, source: 'cameras' });
    return { ok: true, message: `Added ${list.length} camera${list.length === 1 ? '' : 's'}.` };
  }

  async removeAccount(accountId) {
    const driver = this.drivers.get(accountId);
    if (driver) { try { await driver.disconnect(); } catch {} this.drivers.delete(accountId); }
    this.config.setSecret(this.#secretKey(accountId), '');
    const accounts = (this.config.getSettings().cameraAccounts || []).filter((account) => account.id !== accountId);
    this.config.updateSettings({ cameraAccounts: accounts });
    this.emit('cameras:changed', {});
    return { ok: true };
  }

  async listCameras() {
    const cameras = [];
    for (const [accountId, driver] of this.drivers) {
      try {
        for (const camera of await driver.listCameras()) {
          cameras.push({ ...camera, accountId, key: `${accountId}:${camera.id}` });
        }
      } catch {}
    }
    return cameras;
  }

  async #resolve(key) {
    const [accountId, cameraId] = String(key || '').split(':');
    const driver = this.drivers.get(accountId);
    if (!driver) return {};
    return { driver, accountId, cameraId };
  }

  async getSnapshot(key, { manual = false } = {}) {
    const { driver, cameraId } = await this.#resolve(key);
    if (!driver) return { ok: false, message: 'That camera is no longer set up.' };
    if (!manual && driver.snapshotCooldownMs > 0) {
      const last = this.lastAutoSnapshot.get(key) || 0;
      if (Date.now() - last < driver.snapshotCooldownMs) {
        return { ok: false, message: 'Skipped an automatic refresh to protect the camera battery — a recent picture is shown.' };
      }
    }
    try {
      let jpeg;
      try {
        jpeg = await driver.getSnapshot(cameraId);
      } catch (error) {
        if (error.code !== 'NOT_SUPPORTED') throw error;
        const source = await driver.getStreamSource(cameraId);
        if (!source) return { ok: false, message: 'This camera cannot take pictures.' };
        const started = await this.go2rtc.start();
        if (!started.ok) return { ok: false, message: started.message };
        await this.go2rtc.setStream(streamName(key), source);
        jpeg = await this.go2rtc.snapshot(streamName(key));
      }
      if (!manual) this.lastAutoSnapshot.set(key, Date.now());
      this.log.write({ type: 'camera', command: manual ? 'camera snapshot' : 'camera auto refresh', response: `Took a picture from camera ${key}.`, source: 'cameras' });
      return { ok: true, jpegBase64: jpeg.toString('base64'), takenAt: new Date().toISOString() };
    } catch (error) {
      return { ok: false, message: `Could not get a picture: ${error.message}` };
    }
  }

  async openLiveView(key) {
    const { driver, cameraId } = await this.#resolve(key);
    if (!driver) return { ok: false, message: 'That camera is no longer set up.' };
    try {
      const source = await driver.getStreamSource(cameraId);
      if (!source) return { ok: false, message: 'This camera does not support live view — snapshots only.' };
      const started = await this.go2rtc.start();
      if (!started.ok) return { ok: false, message: started.message };
      const name = streamName(key);
      await this.go2rtc.setStream(name, source);
      this.liveViews.add(name);
      this.log.write({ type: 'camera', command: 'live view', response: `Opened live view for camera ${key}.`, source: 'cameras' });
      return { ok: true, whepUrl: this.go2rtc.whepUrl(name) };
    } catch (error) {
      return { ok: false, message: `Could not start live view: ${error.message}` };
    }
  }

  async closeLiveView(key) {
    const name = streamName(key);
    if (!this.liveViews.has(name)) return { ok: true };
    this.liveViews.delete(name);
    try { await this.go2rtc.removeStream(name); } catch {}
    return { ok: true };
  }

  getStatus() {
    return { helper: this.go2rtc.getStatus(), accounts: this.listAccounts() };
  }

  async shutdown() {
    for (const name of this.liveViews) { try { await this.go2rtc.removeStream(name); } catch {} }
    this.liveViews.clear();
    await this.go2rtc.stop();
  }
}

module.exports = { CameraService, streamName };
```

- [ ] **Step 4: Run** — `npm test` — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add core/camera/camera-service.js test/camera.test.js
git commit -m "feat(camera): camera service with accounts, snapshots, live view sessions"
```

---

### Task 7: Main-process wiring + preload API

**Files:**
- Modify: `main.js` (imports, service construction in `app.whenReady`, IPC handlers in `setupIpc`, shutdown in `before-quit`)
- Modify: `preload.js` (`cameras` namespace)

**Interfaces:**
- Consumes: `CameraService`, `Go2RtcManager`.
- Produces: `window.jarvis.cameras = { bootstrap, addRtsp, removeAccount, list, snapshot, liveStart, liveStop }` plus `onCamerasChanged`, `onCamerasStatus` event subscriptions.

- [ ] **Step 1: Wire main.js**

Imports (after LocalVoiceService import):
```js
const { Go2RtcManager } = require('./core/camera/go2rtc-manager');
const { CameraService } = require('./core/camera/camera-service');
```
Module-level: `let cameras;` and `let go2rtc;` next to the other service lets.

In `app.whenReady()` after `localVoice = new LocalVoiceService({...});`:
```js
  go2rtc = new Go2RtcManager({
    binaryPath: app.isPackaged
      ? path.join(process.resourcesPath, 'go2rtc', 'go2rtc.exe')
      : path.join(__dirname, 'resources', 'go2rtc', 'go2rtc.exe'),
    dataDir: path.join(app.getPath('userData'), 'cameras'),
    emit: sendEverywhere
  });
  cameras = new CameraService({ config, emit: sendEverywhere, log, go2rtc });
  cameras.init();
```

In `setupIpc()`:
```js
  ipcMain.handle('cameras:bootstrap', async () => ({
    accounts: cameras.listAccounts(),
    cameras: await cameras.listCameras(),
    status: cameras.getStatus()
  }));
  ipcMain.handle('cameras:add-rtsp', (_event, payload) => cameras.addRtspAccount(payload || {}));
  ipcMain.handle('cameras:remove-account', (_event, accountId) => cameras.removeAccount(String(accountId || '')));
  ipcMain.handle('cameras:list', () => cameras.listCameras());
  ipcMain.handle('cameras:snapshot', (_event, payload) => cameras.getSnapshot(String(payload?.key || ''), { manual: Boolean(payload?.manual) }));
  ipcMain.handle('cameras:live-start', (_event, key) => cameras.openLiveView(String(key || '')));
  ipcMain.handle('cameras:live-stop', (_event, key) => cameras.closeLiveView(String(key || '')));
```

In `before-quit`: add `cameras?.shutdown();`

- [ ] **Step 2: Wire preload.js**

Add inside the exposed object:
```js
  cameras: {
    bootstrap: () => ipcRenderer.invoke('cameras:bootstrap'),
    addRtsp: (payload) => ipcRenderer.invoke('cameras:add-rtsp', payload),
    removeAccount: (accountId) => ipcRenderer.invoke('cameras:remove-account', accountId),
    list: () => ipcRenderer.invoke('cameras:list'),
    snapshot: (key, manual) => ipcRenderer.invoke('cameras:snapshot', { key, manual }),
    liveStart: (key) => ipcRenderer.invoke('cameras:live-start', key),
    liveStop: (key) => ipcRenderer.invoke('cameras:live-stop', key)
  },
  onCamerasChanged: (callback) => on('cameras:changed', callback),
  onCamerasStatus: (callback) => on('cameras:status', callback),
```

- [ ] **Step 3: Verify**

Run: `node --check main.js` and `node --check preload.js` — Expected: no output (pass). Run `npm test` — Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add main.js preload.js
git commit -m "feat(camera): IPC surface and preload cameras API"
```

---

### Task 8: Cameras module UI

**Files:**
- Modify: `src/index.html` (CSP line, new module article, script tag)
- Create: `src/cameras-ui.js`
- Modify: `src/styles.css` (append camera styles)

**Interfaces:**
- Consumes: `window.jarvis.cameras.*` from Task 7. Module framework conventions: `article.module[data-module="cameras"]`, `.drag-handle`, `.module-actions` with `data-collapse`/`data-hide` buttons, `.resize-handle` — layout-engine picks these up automatically from the `data-module` name and `moduleLayout.cameras` default (Task 5).
- Produces: user-visible Cameras module: tile grid, add-camera form, snapshot refresh, live view via WHEP.

- [ ] **Step 1: CSP** — in `src/index.html` replace the CSP meta with:

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src http://127.0.0.1:* ws://127.0.0.1:*;">
```

- [ ] **Step 2: Module markup** — after the document-viewer article in `src/index.html`:

```html
        <article class="module hidden-module" data-module="cameras">
          <header class="module-header drag-handle"><div><span>09 // SURVEILLANCE</span><h2>CAMERAS</h2></div><div class="module-actions"><button id="camera-add-toggle" title="Add cameras">＋ ADD</button><button data-collapse>−</button><button data-hide>×</button></div></header>
          <div class="module-content cameras-content">
            <form id="camera-add-form" class="camera-add-form" hidden>
              <p class="camera-hint">Add a local network camera. The address looks like rtsp://username:password@192.168.1.20/stream1 — it is stored encrypted on this computer.</p>
              <input id="camera-add-name" placeholder="Camera name (Front Door)">
              <input id="camera-add-url" placeholder="rtsp://username:password@camera-address/stream">
              <div class="camera-add-actions"><button type="submit">SAVE CAMERA</button><button type="button" id="camera-add-cancel">CANCEL</button></div>
              <p id="camera-add-status" class="camera-status" role="status"></p>
            </form>
            <div id="camera-grid" class="camera-grid"><p class="camera-empty">No cameras yet. Select ＋ ADD to connect one.</p></div>
          </div>
          <i class="resize-handle"></i>
        </article>
```

And before `</body>` (next to the existing script tags): `<script src="cameras-ui.js"></script>`

- [ ] **Step 3: Renderer logic** — create `src/cameras-ui.js`:

```js
// Cameras module: tile grid, snapshots, WHEP live view via the local go2rtc helper.
(() => {
  const grid = document.getElementById('camera-grid');
  const addForm = document.getElementById('camera-add-form');
  const addToggle = document.getElementById('camera-add-toggle');
  if (!grid || !addForm || !addToggle || !window.jarvis?.cameras) return;

  const nameInput = document.getElementById('camera-add-name');
  const urlInput = document.getElementById('camera-add-url');
  const addStatus = document.getElementById('camera-add-status');
  const livePeers = new Map(); // camera key -> RTCPeerConnection

  addToggle.addEventListener('click', () => { addForm.hidden = !addForm.hidden; });
  document.getElementById('camera-add-cancel').addEventListener('click', () => { addForm.hidden = true; });

  addForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    addStatus.textContent = 'Saving…';
    const result = await window.jarvis.cameras.addRtsp({
      name: nameInput.value || 'My cameras',
      cameras: [{ name: nameInput.value, url: urlInput.value }]
    });
    addStatus.textContent = result.message || '';
    if (result.ok) { nameInput.value = ''; urlInput.value = ''; addForm.hidden = true; render(); }
  });

  function tile(camera) {
    const article = document.createElement('div');
    article.className = 'camera-tile';
    article.dataset.key = camera.key;
    article.innerHTML = `
      <div class="camera-view"><img alt="${camera.name}" hidden><video muted autoplay playsinline hidden></video><span class="camera-view-empty">NO PICTURE YET</span></div>
      <div class="camera-tile-bar">
        <span class="camera-name">${camera.name}</span><b class="camera-brand">${camera.brand.toUpperCase()}</b>
        <button class="camera-refresh" title="Take a fresh picture">↻</button>
        <button class="camera-live" title="Live view">▶ LIVE</button>
        <button class="camera-remove" title="Remove this camera's account">×</button>
      </div>
      <span class="camera-stamp"></span>`;
    article.querySelector('.camera-refresh').addEventListener('click', () => refresh(article, camera, true));
    article.querySelector('.camera-live').addEventListener('click', () => toggleLive(article, camera));
    article.querySelector('.camera-remove').addEventListener('click', async () => {
      await window.jarvis.cameras.removeAccount(camera.accountId);
      render();
    });
    return article;
  }

  async function refresh(article, camera, manual) {
    const shot = await window.jarvis.cameras.snapshot(camera.key, manual);
    const img = article.querySelector('img');
    const stamp = article.querySelector('.camera-stamp');
    if (shot.ok) {
      img.src = `data:image/jpeg;base64,${shot.jpegBase64}`;
      img.hidden = false;
      article.querySelector('.camera-view-empty').hidden = true;
      stamp.textContent = `PICTURE · ${new Date(shot.takenAt).toLocaleTimeString()}`;
    } else if (manual) {
      stamp.textContent = shot.message || 'Could not get a picture.';
    }
  }

  async function toggleLive(article, camera) {
    const video = article.querySelector('video');
    const img = article.querySelector('img');
    const button = article.querySelector('.camera-live');
    if (livePeers.has(camera.key)) { stopLive(camera.key, article); return; }
    button.textContent = '… CONNECTING';
    const live = await window.jarvis.cameras.liveStart(camera.key);
    if (!live.ok) { button.textContent = '▶ LIVE'; article.querySelector('.camera-stamp').textContent = live.message; return; }
    try {
      const peer = new RTCPeerConnection();
      livePeers.set(camera.key, peer);
      peer.addTransceiver('video', { direction: 'recvonly' });
      peer.addTransceiver('audio', { direction: 'recvonly' });
      peer.ontrack = (event) => { video.srcObject = event.streams[0]; };
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await new Promise((resolve) => {
        if (peer.iceGatheringState === 'complete') return resolve();
        peer.addEventListener('icegatheringstatechange', () => { if (peer.iceGatheringState === 'complete') resolve(); });
        setTimeout(resolve, 2000);
      });
      const response = await fetch(live.whepUrl, { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: peer.localDescription.sdp });
      if (!response.ok) throw new Error(`helper answered ${response.status}`);
      await peer.setRemoteDescription({ type: 'answer', sdp: await response.text() });
      video.hidden = false; img.hidden = true;
      article.querySelector('.camera-view-empty').hidden = true;
      button.textContent = '■ STOP';
      article.querySelector('.camera-stamp').textContent = 'LIVE';
    } catch (error) {
      stopLive(camera.key, article);
      article.querySelector('.camera-stamp').textContent = `Live view failed: ${error.message}`;
    }
  }

  function stopLive(key, article) {
    const peer = livePeers.get(key);
    if (peer) { try { peer.close(); } catch {} livePeers.delete(key); }
    window.jarvis.cameras.liveStop(key);
    if (article) {
      const video = article.querySelector('video');
      video.srcObject = null; video.hidden = true;
      article.querySelector('.camera-live').textContent = '▶ LIVE';
      const img = article.querySelector('img');
      if (img.src) img.hidden = false;
      article.querySelector('.camera-stamp').textContent = '';
    }
  }

  async function render() {
    for (const key of [...livePeers.keys()]) stopLive(key);
    const cameras = await window.jarvis.cameras.list();
    grid.innerHTML = '';
    if (!cameras.length) {
      grid.innerHTML = '<p class="camera-empty">No cameras yet. Select ＋ ADD to connect one.</p>';
      return;
    }
    for (const camera of cameras) {
      const article = tile(camera);
      grid.appendChild(article);
      refresh(article, camera, false);
    }
  }

  window.jarvis.onCamerasChanged(() => render());
  render();
})();
```

- [ ] **Step 4: Styles** — append to `src/styles.css`:

```css
/* Cameras module */
.cameras-content{display:flex;flex-direction:column;gap:8px;overflow:auto}
.camera-add-form{display:flex;flex-direction:column;gap:6px;border:1px solid rgba(255,178,31,.25);padding:10px}
.camera-hint{font:400 10px/1.5 var(--ui);color:#b5c9ce;margin:0}
.camera-add-actions{display:flex;gap:6px}
.camera-status{font:400 10px/1.4 var(--ui);color:var(--amber);margin:0;min-height:12px}
.camera-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
.camera-empty{font:400 11px/1.6 var(--ui);color:#b5c9ce;opacity:.7}
.camera-tile{border:1px solid rgba(255,178,31,.2);background:rgba(2,7,11,.6);display:flex;flex-direction:column}
.camera-view{position:relative;aspect-ratio:16/9;background:#03090d;display:flex;align-items:center;justify-content:center;overflow:hidden}
.camera-view img,.camera-view video{width:100%;height:100%;object-fit:cover}
.camera-view-empty{font:600 9px/1 var(--ui);letter-spacing:.12em;color:#4d646b}
.camera-tile-bar{display:flex;align-items:center;gap:6px;padding:6px 8px}
.camera-name{font:600 10px/1 var(--ui);color:#d8e6ea;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.camera-brand{font:600 8px/1 var(--ui);color:var(--amber);opacity:.8}
.camera-tile-bar button{background:none;border:1px solid rgba(255,178,31,.3);color:var(--amber);font:600 8px/1 var(--ui);padding:4px 6px;cursor:pointer}
.camera-stamp{font:400 9px/1.4 var(--ui);color:#7b949b;padding:0 8px 6px;min-height:14px}
```

- [ ] **Step 5: Register in the modules picker** — in `src/renderer.js`, find the modules-picker labels object (search for `'document-viewer'` in the picker/label mapping) and add a `cameras: 'CAMERAS'` entry following the same shape.

- [ ] **Step 6: Verify**

Run: `node --check src/cameras-ui.js && node --check src/renderer.js` — pass. `npm test` — pass. Then `npm run capture` (capture mode boots the app, screenshots, and quits) with the cameras module unhidden to confirm no renderer console errors; inspect the PNG.

- [ ] **Step 7: Commit**

```bash
git add src/index.html src/cameras-ui.js src/styles.css src/renderer.js
git commit -m "feat(camera): Cameras module UI with snapshot grid and WHEP live view"
```

---

### Task 9: ONVIF network discovery

**Files:**
- Modify: `package.json` (dependency `onvif@^0.7.x`)
- Create: `core/camera/onvif-discovery.js`
- Modify: `main.js` + `preload.js` (`cameras:discover` IPC)
- Modify: `src/cameras-ui.js` + `src/index.html` (SCAN NETWORK button in the add form)
- Test: `test/camera.test.js` (append)

**Interfaces:**
- Produces: `async discoverCameras({probeFn}) -> [{address, name}]` (5s probe, deduplicated, never throws — returns `[]` on error). IPC `cameras:discover` → `window.jarvis.cameras.discover()`. UI lists found addresses; clicking one pre-fills the RTSP URL field with `rtsp://user:password@<address>:554/` for the user to complete — discovery never stores anything itself.

- [ ] **Step 1: Failing test**

```js
// append to test/camera.test.js
const { discoverCameras } = require('../core/camera/onvif-discovery');

test('onvif discovery: dedupes and survives probe errors', async () => {
  const found = await discoverCameras({
    probeFn: async () => ([
      { hostname: '192.168.1.20', name: 'Reolink' },
      { hostname: '192.168.1.20', name: 'Reolink duplicate' },
      { hostname: '192.168.1.31', name: '' }
    ])
  });
  assert.deepEqual(found, [
    { address: '192.168.1.20', name: 'Reolink' },
    { address: '192.168.1.31', name: 'Camera at 192.168.1.31' }
  ]);
  const failed = await discoverCameras({ probeFn: async () => { throw new Error('no network'); } });
  assert.deepEqual(failed, []);
});
```

- [ ] **Step 2: Run** — Expected FAIL

- [ ] **Step 3: Implement**

Run: `npm install onvif` (then confirm `npm audit --omit=dev` is still clean).

```js
// core/camera/onvif-discovery.js
function defaultProbe() {
  const { Discovery } = require('onvif');
  return new Promise((resolve, reject) => {
    Discovery.probe({ timeout: 5000, resolve: false }, (error, cams) => {
      if (error) return reject(error);
      resolve((cams || []).map((cam) => ({
        hostname: cam.hostname || cam.address || '',
        name: cam.name || ''
      })));
    });
  });
}

// Finds ONVIF cameras on the local network. Read-only: it never signs in
// and never stores anything — the user completes the RTSP address manually.
async function discoverCameras({ probeFn = defaultProbe } = {}) {
  try {
    const found = await probeFn();
    const byAddress = new Map();
    for (const cam of found) {
      const address = String(cam.hostname || '').trim();
      if (!address || byAddress.has(address)) continue;
      byAddress.set(address, { address, name: String(cam.name || '').trim() || `Camera at ${address}` });
    }
    return [...byAddress.values()];
  } catch {
    return [];
  }
}

module.exports = { discoverCameras };
```

`main.js` in `setupIpc`:
```js
  ipcMain.handle('cameras:discover', () => {
    const { discoverCameras } = require('./core/camera/onvif-discovery');
    return discoverCameras({});
  });
```

`preload.js` inside `cameras`: `discover: () => ipcRenderer.invoke('cameras:discover'),`

`src/index.html` — inside `.camera-add-actions`, before SAVE: `<button type="button" id="camera-scan">SCAN NETWORK</button>`

`src/cameras-ui.js` — after the cancel handler:
```js
  document.getElementById('camera-scan').addEventListener('click', async () => {
    addStatus.textContent = 'Scanning your network for cameras (about 5 seconds)…';
    const found = await window.jarvis.cameras.discover();
    if (!found.length) { addStatus.textContent = 'No cameras answered. You can still type the rtsp:// address by hand.'; return; }
    addStatus.textContent = `Found ${found.length}: ${found.map((cam) => cam.address).join(', ')} — pick one, then fill in its username and password.`;
    urlInput.value = `rtsp://username:password@${found[0].address}:554/`;
    if (!nameInput.value) nameInput.value = found[0].name;
  });
```

- [ ] **Step 4: Run** — `npm test` + `node --check` on changed JS — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json core/camera/onvif-discovery.js main.js preload.js src/index.html src/cameras-ui.js test/camera.test.js
git commit -m "feat(camera): ONVIF network discovery with manual credential completion"
```

---

### Task 10: Full verification pass

- [ ] **Step 1:** `npm test` — all pass.
- [ ] **Step 2:** `node --check main.js && node --check preload.js && node --check src/renderer.js && node --check src/layout-engine.js && node --check src/cameras-ui.js` — all pass.
- [ ] **Step 3:** `npm audit --omit=dev` — zero known vulnerabilities.
- [ ] **Step 4:** `npm run capture` — app boots headlessly, screenshot renders, no exceptions in output.
- [ ] **Step 5:** Real-hardware checklist for Adam (documented in final handoff, not automated): unhide the Cameras module, add a real RTSP camera or run SCAN NETWORK, confirm snapshot appears, confirm ▶ LIVE plays video, confirm × removes the account, confirm `settings.json` contains no rtsp:// text.
- [ ] **Step 6:** Commit any fixes; do NOT bump version/CHANGELOG (no installer produced in this phase).
