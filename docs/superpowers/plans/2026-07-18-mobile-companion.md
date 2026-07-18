# JARVIS Mobile Companion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A phone-installable JARVIS web app (chat + press-and-hold voice) served by the desktop app itself, reachable from anywhere via Tailscale, with QR pairing and per-device revocable keys.

**Architecture:** A new HTTP+SSE server inside Electron main (`core/mobile-server.js`) binds only to the machine's Tailscale address, authenticates every API call with device keys managed by a pure `core/mobile-auth.js`, and delegates all intelligence to the existing `router.handle()` and `localVoice.transcribe()`. A static PWA in `src/mobile/` is the phone UI.

**Tech Stack:** Node built-ins (`http`, `crypto`, `os`) + SSE (no WebSocket dep). One new npm dep: `qrcode` (pairing QR data-URLs). Tests: `node:test` like the rest of the repo.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-18-mobile-companion-design.md` — read it first.
- Branch: all work on `mobile-companion`. Commit per task. Do not push unless Adam asks.
- `npm test` must be green after every task (baseline: 92 passing).
- Server **off by default** (`mobileEnabled: false`); binds **only** Tailscale (`100.64.0.0/10`) + `127.0.0.1`; **never** `0.0.0.0`. Default port **27183**.
- Device keys stored via `config.setSecret` (Electron `safeStorage`) — never plaintext on disk.
- All chat goes through `router.handle()` — no new tool surface, no shell, approvals stay desktop-only (the router already produces the approval-gated responses; do not add an approval UI to the phone).
- Pairing code: 6 digits, single active, expires 120 s or first use. Device key: 32 random bytes base64url. Lockout: 10 consecutive auth failures per IP until pairing is reopened or server restarts.
- Copy style: JARVIS speaks like the desktop ("JARVIS is unreachable — is the PC awake?").

## File Map

| File | Responsibility |
|---|---|
| `core/mobile-auth.js` (new, pure) | Pairing lifecycle, key verify (timing-safe), lockout, device list |
| `core/mobile-server.js` (new) | HTTP server, bind-address pick, routes, SSE fan-out, static serving |
| `src/mobile/index.html` `mobile.css` `mobile.js` `manifest.webmanifest` `sw.js` `icon.svg` (new) | The phone app |
| `core/defaults.js` (modify) | `mobileEnabled`, `mobilePort` |
| `main.js` (modify) | Construct/start/stop server, IPC: `mobile:status/pair/devices/revoke` |
| `preload.js` (modify) | Expose the four mobile IPC calls |
| `src/index.html` + `src/renderer.js` (modify) | Settings MOBILE section (toggle, port, QR dialog, device list) |
| `test/mobile-auth.test.js`, `test/mobile-server.test.js` (new) | Unit tests |
| `docs/MOBILE-TESTING-CHECKLIST.md` (new) | Manual phone checklist |

---

### Task 1: Settings defaults

**Files:**
- Modify: `core/defaults.js` (add two keys to `DEFAULT_SETTINGS`)
- Test: `test/core.test.js` (extend the existing merge test)

**Interfaces:**
- Produces: `settings.mobileEnabled: boolean` (false), `settings.mobilePort: number` (27183) — read by Tasks 5–7.

- [ ] **Step 1: Write the failing test** — in `test/core.test.js`, inside the existing `'settings merge keeps defaults'`-style test (search `mergeSettings(DEFAULT_SETTINGS`), add:

```js
assert.equal(mergeSettings(DEFAULT_SETTINGS, {}).mobileEnabled, false);
assert.equal(mergeSettings(DEFAULT_SETTINGS, {}).mobilePort, 27183);
```

- [ ] **Step 2: Run** `node --test test/core.test.js` — expect FAIL (`mobileEnabled` undefined).
- [ ] **Step 3: Implement** — in `core/defaults.js` `DEFAULT_SETTINGS`, next to the other feature toggles add:

```js
  mobileEnabled: false,
  mobilePort: 27183,
```

- [ ] **Step 4: Run** `node --test test/core.test.js` — expect PASS. Then full `npm test`.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(mobile): settings defaults for the mobile server (off by default)"`

---

### Task 2: `core/mobile-auth.js` — pairing, keys, lockout (pure)

**Files:**
- Create: `core/mobile-auth.js`
- Test: `test/mobile-auth.test.js`

**Interfaces:**
- Consumes: nothing from the app (injectable `random`, `now` for tests).
- Produces (used by Tasks 5–6):

```js
class MobileAuth {
  constructor({ devices = [], random, now } = {})   // devices: [{id,name,key,createdAt}]
  startPairing() // → { code: '483920', expiresAt }  (single active; restarting replaces)
  claimPairing(code, deviceName) // → { key, device:{id,name,createdAt} } | null (expired/wrong/used)
  verify(authHeader, ip) // → device | null; 'Bearer <key>'; timing-safe; counts failures per ip
  isLockedOut(ip) // → boolean (>=10 consecutive failures)
  revoke(deviceId) // → boolean
  listDevices() // → [{id,name,createdAt}]  (no keys!)
  toJSON() // → devices array WITH keys, for encrypted persistence
}
module.exports = { MobileAuth };
```

- [ ] **Step 1: Write the failing tests** — `test/mobile-auth.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { MobileAuth } = require('../core/mobile-auth');

function fixed(bytes) { return () => Buffer.alloc(bytes, 7); }

test('pairing: code is 6 digits, single-use, and expires after 120s', () => {
  let t = 1000;
  const auth = new MobileAuth({ now: () => t });
  const { code, expiresAt } = auth.startPairing();
  assert.match(code, /^\d{6}$/);
  assert.equal(expiresAt, 1000 + 120000);
  assert.equal(auth.claimPairing('000000', 'x'), null);          // wrong code
  const claimed = auth.claimPairing(code, "Adam's iPhone");
  assert.ok(claimed.key.length >= 40);                            // 32 bytes base64url
  assert.equal(claimed.device.name, "Adam's iPhone");
  assert.equal(auth.claimPairing(code, 'again'), null);           // single-use
  const { code: c2 } = auth.startPairing();
  t += 120001;
  assert.equal(auth.claimPairing(c2, 'late'), null);              // expired
});

test('verify: accepts the real key, rejects wrong/absent, and locks out after 10 fails', () => {
  const auth = new MobileAuth({ now: () => 0 });
  const { code } = auth.startPairing();
  const { key, device } = auth.claimPairing(code, 'phone');
  assert.equal(auth.verify(`Bearer ${key}`, '100.1.1.1').id, device.id);
  assert.equal(auth.verify('Bearer nope', '100.1.1.1'), null);
  assert.equal(auth.verify(undefined, '100.1.1.1'), null);
  for (let i = 0; i < 10; i++) auth.verify('Bearer nope', '100.9.9.9');
  assert.equal(auth.isLockedOut('100.9.9.9'), true);
  assert.equal(auth.verify(`Bearer ${key}`, '100.9.9.9'), null);  // right key, locked ip
  assert.equal(auth.verify(`Bearer ${key}`, '100.1.1.1').id, device.id); // other ip fine
  auth.startPairing();                                            // reopening pairing clears lockouts
  assert.equal(auth.isLockedOut('100.9.9.9'), false);
});

test('revoke + persistence round-trip', () => {
  const auth = new MobileAuth({ now: () => 0 });
  const { code } = auth.startPairing();
  const { key, device } = auth.claimPairing(code, 'phone');
  const reloaded = new MobileAuth({ devices: auth.toJSON(), now: () => 0 });
  assert.equal(reloaded.verify(`Bearer ${key}`, 'ip').id, device.id);
  assert.deepEqual(reloaded.listDevices(), [{ id: device.id, name: 'phone', createdAt: device.createdAt }]);
  assert.equal(reloaded.revoke(device.id), true);
  assert.equal(reloaded.verify(`Bearer ${key}`, 'ip'), null);
  assert.equal(reloaded.revoke('missing'), false);
});
```

- [ ] **Step 2: Run** `node --test test/mobile-auth.test.js` — expect FAIL (module not found).
- [ ] **Step 3: Implement** `core/mobile-auth.js`:

```js
// Pairing codes, device keys and lockout for the mobile companion. Pure logic:
// no I/O, no Electron. Persistence is the caller's job via toJSON().
const crypto = require('node:crypto');

const PAIRING_TTL_MS = 120000;
const LOCKOUT_LIMIT = 10;

class MobileAuth {
  constructor({ devices = [], random = crypto.randomBytes, now = () => Date.now() } = {}) {
    this.devices = devices.map((d) => ({ ...d }));
    this.random = random;
    this.now = now;
    this.pairing = null;               // { code, expiresAt }
    this.failures = new Map();         // ip → consecutive failure count
  }

  startPairing() {
    const code = String(this.random(4).readUInt32BE(0) % 1000000).padStart(6, '0');
    this.pairing = { code, expiresAt: this.now() + PAIRING_TTL_MS };
    this.failures.clear();             // a human is at the desk; clear lockouts
    return { ...this.pairing };
  }

  claimPairing(code, deviceName) {
    const p = this.pairing;
    if (!p || this.now() > p.expiresAt || String(code) !== p.code) return null;
    this.pairing = null;               // single use
    const key = this.random(32).toString('base64url');
    const device = { id: crypto.randomUUID(), name: String(deviceName || 'Phone').slice(0, 60), createdAt: this.now() };
    this.devices.push({ ...device, key });
    return { key, device };
  }

  verify(authHeader, ip) {
    if (this.isLockedOut(ip)) return null;
    const offered = String(authHeader || '').replace(/^Bearer\s+/i, '');
    const offeredBuf = Buffer.from(offered);
    let matched = null;
    for (const d of this.devices) {
      const keyBuf = Buffer.from(d.key);
      if (offeredBuf.length === keyBuf.length && crypto.timingSafeEqual(offeredBuf, keyBuf)) matched = d;
    }
    if (!matched) { this.failures.set(ip, (this.failures.get(ip) || 0) + 1); return null; }
    this.failures.delete(ip);
    const { key, ...device } = matched;
    return device;
  }

  isLockedOut(ip) { return (this.failures.get(ip) || 0) >= LOCKOUT_LIMIT; }
  revoke(deviceId) {
    const before = this.devices.length;
    this.devices = this.devices.filter((d) => d.id !== deviceId);
    return this.devices.length < before;
  }
  listDevices() { return this.devices.map(({ id, name, createdAt }) => ({ id, name, createdAt })); }
  toJSON() { return this.devices.map((d) => ({ ...d })); }
}

module.exports = { MobileAuth };
```

- [ ] **Step 4: Run** `node --test test/mobile-auth.test.js` then `npm test` — expect PASS / all green.
- [ ] **Step 5: Commit** — `git commit -am "feat(mobile): pairing codes, device keys and lockout (pure, unit-tested)"`

---

### Task 3: Bind-address picker + request routing core

**Files:**
- Create: `core/mobile-server.js` (logic parts only this task; `start()` wiring next task)
- Test: `test/mobile-server.test.js`

**Interfaces:**
- Consumes: `MobileAuth` (Task 2).
- Produces (used by Tasks 4–5):

```js
pickBindAddress(interfaces) // os.networkInterfaces()-shaped object → '100.x.y.z' | null
class MobileServer {
  constructor({ config, router, transcribe, auth, staticDir, interfaces })
  async handleRequest(req, res)   // routes /api/*, static; exported for tests via injected fakes
  async start()                    // → { ok, address?, port?, reason? }
  stop()
  status()                         // → { running, address, port, reason }
  pushEvent(deviceId, event, data) // SSE fan-out
}
```

- [ ] **Step 1: Write the failing tests** — `test/mobile-server.test.js` (logic level, no sockets):

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { pickBindAddress, sseFrame } = require('../core/mobile-server');

test('pickBindAddress: finds the Tailscale IPv4 and ignores everything else', () => {
  assert.equal(pickBindAddress({
    'Ethernet': [{ family: 'IPv4', address: '192.168.1.20', internal: false }],
    'Tailscale': [{ family: 'IPv4', address: '100.101.102.103', internal: false },
                  { family: 'IPv6', address: 'fd7a::1', internal: false }]
  }), '100.101.102.103');
  assert.equal(pickBindAddress({ 'Ethernet': [{ family: 'IPv4', address: '192.168.1.20', internal: false }] }), null);
  // CGNAT range is 100.64.0.0/10 — 100.63.x and 100.128.x are NOT in it.
  assert.equal(pickBindAddress({ 'X': [{ family: 'IPv4', address: '100.63.0.1', internal: false }] }), null);
  assert.equal(pickBindAddress({ 'X': [{ family: 'IPv4', address: '100.128.0.1', internal: false }] }), null);
});

test('sseFrame formats an SSE event', () => {
  assert.equal(sseFrame('reply', { text: 'hi' }), 'event: reply\ndata: {"text":"hi"}\n\n');
});
```

- [ ] **Step 2: Run** `node --test test/mobile-server.test.js` — expect FAIL (module not found).
- [ ] **Step 3: Implement** the pure parts of `core/mobile-server.js`:

```js
// The mobile companion's HTTP + SSE server. Binds ONLY to the Tailscale
// interface (100.64.0.0/10) plus loopback; refuses to start without one.
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// Tailscale hands out CGNAT addresses: 100.64.0.0/10 → 100.64.0.0–100.127.255.255.
function pickBindAddress(interfaces = os.networkInterfaces()) {
  for (const list of Object.values(interfaces)) {
    for (const entry of list || []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      const [a, b] = entry.address.split('.').map(Number);
      if (a === 100 && b >= 64 && b <= 127) return entry.address;
    }
  }
  return null;
}

function sseFrame(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

module.exports = { pickBindAddress, sseFrame };  // MobileServer added in the next task
```

- [ ] **Step 4: Run** `node --test test/mobile-server.test.js` then `npm test` — PASS / green.
- [ ] **Step 5: Commit** — `git commit -am "feat(mobile): tailscale bind-address picker + SSE framing (unit-tested)"`

---

### Task 4: `MobileServer` — routes, auth gate, SSE, static

**Files:**
- Modify: `core/mobile-server.js` (add the class)
- Test: `test/mobile-server.test.js` (extend)

**Interfaces:**
- Consumes: `auth.verify/claimPairing/isLockedOut` (Task 2), `router.handle(text, 'general', { onStep })` (existing), `transcribe(buffer, mimeType)` (existing `localVoice.transcribe` — resolves to a string or `{ text }`; handle both).
- Produces: routes for the phone app (Task 6): `POST /api/pair {code, name}` → `{key}`; `POST /api/chat {text}` → `{reply, tasks?}`; `POST /api/voice` (raw audio body, `Content-Type: audio/mp4|audio/webm`) → `{transcript, reply}`; `GET /api/events` (SSE, `agent-step` + `reply` events); `GET /api/last` → `{reply}`; static from `staticDir` (no auth — the app shell holds no secrets; every `/api/*` except `/api/pair` requires `Authorization: Bearer`).

- [ ] **Step 1: Write the failing tests** — extend `test/mobile-server.test.js` using fake req/res (`EventEmitter` + captured writes; see `test/camera.test.js` for the fake-response style used in this repo):

```js
const { MobileServer } = require('../core/mobile-server');
const { MobileAuth } = require('../core/mobile-auth');

function fakeRes() {
  const res = { code: 0, headers: null, body: '', writeHead(c, h) { this.code = c; this.headers = h; }, end(b) { this.body = String(b || ''); }, write(b) { this.body += b; } };
  return res;
}
function jsonReq(method, url, body, headers = {}) {
  const { Readable } = require('node:stream');
  const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
  Object.assign(req, { method, url, headers, socket: { remoteAddress: '100.1.1.1' } });
  return req;
}

test('api requires auth except pairing; chat routes through the router', async () => {
  const auth = new MobileAuth({ now: () => 0 });
  const { code } = auth.startPairing();
  const asked = [];
  const server = new MobileServer({
    auth,
    router: { handle: async (text) => { asked.push(text); return { response: 'Aye.', tasks: [] }; } },
    transcribe: async () => 'unused', config: { getSettings: () => ({}) }, staticDir: __dirname
  });
  const denied = fakeRes();
  await server.handleRequest(jsonReq('POST', '/api/chat', { text: 'hi' }), denied);
  assert.equal(denied.code, 401);

  const pair = fakeRes();
  await server.handleRequest(jsonReq('POST', '/api/pair', { code, name: 'iPhone' }), pair);
  const { key } = JSON.parse(pair.body);
  assert.ok(key);

  const ok = fakeRes();
  await server.handleRequest(jsonReq('POST', '/api/chat', { text: 'status report' }, { authorization: `Bearer ${key}` }), ok);
  assert.equal(JSON.parse(ok.body).reply, 'Aye.');
  assert.deepEqual(asked, ['status report']);
});

test('voice endpoint transcribes then chats, and /api/last replays the reply', async () => {
  const auth = new MobileAuth({ now: () => 0 });
  const { code } = auth.startPairing();
  const server = new MobileServer({
    auth,
    router: { handle: async (text) => ({ response: `heard: ${text}` }) },
    transcribe: async (buf, mime) => ({ text: 'add a task' }),   // object shape must work too
    config: { getSettings: () => ({}) }, staticDir: __dirname
  });
  const pair = fakeRes();
  await server.handleRequest(jsonReq('POST', '/api/pair', { code, name: 'iPhone' }), pair);
  const { key } = JSON.parse(pair.body);

  const { Readable } = require('node:stream');
  const req = Readable.from([Buffer.from('AUDio')]);
  Object.assign(req, { method: 'POST', url: '/api/voice', headers: { authorization: `Bearer ${key}`, 'content-type': 'audio/mp4' }, socket: { remoteAddress: '100.1.1.1' } });
  const res = fakeRes();
  await server.handleRequest(req, res);
  const out = JSON.parse(res.body);
  assert.equal(out.transcript, 'add a task');
  assert.equal(out.reply, 'heard: add a task');

  const last = fakeRes();
  await server.handleRequest(jsonReq('GET', '/api/last', null, { authorization: `Bearer ${key}` }), last);
  assert.equal(JSON.parse(last.body).reply, 'heard: add a task');
});
```

- [ ] **Step 2: Run** — expect FAIL (`MobileServer` not exported).
- [ ] **Step 3: Implement** the class in `core/mobile-server.js` (append; keep the two pure exports):

```js
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

async function readBody(req, limit = 10 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Body too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

class MobileServer {
  constructor({ config, router, transcribe, auth, staticDir, onDevicesChanged = () => {} }) {
    this.config = config; this.router = router; this.transcribe = transcribe;
    this.auth = auth; this.staticDir = staticDir; this.onDevicesChanged = onDevicesChanged;
    this.server = null; this.reason = ''; this.address = null; this.port = null;
    this.streams = new Map();   // deviceId → Set<res>
    this.lastReply = new Map(); // deviceId → { reply, at }
  }

  json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }

  pushEvent(deviceId, event, data) {
    for (const res of this.streams.get(deviceId) || []) { try { res.write(sseFrame(event, data)); } catch {} }
  }

  async handleRequest(req, res) {
    try {
      const ip = req.socket?.remoteAddress || '';
      const url = String(req.url || '/');
      if (url === '/api/pair' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)).toString() || '{}');
        const claimed = this.auth.claimPairing(body.code, body.name);
        if (!claimed) return this.json(res, 403, { error: 'Pairing code is wrong or expired. Start pairing again in Settings.' });
        this.onDevicesChanged();
        return this.json(res, 200, { key: claimed.key, name: claimed.device.name });
      }
      if (url.startsWith('/api/')) {
        const device = this.auth.verify(req.headers.authorization, ip);
        if (!device) return this.json(res, 401, { error: 'Not paired.' });
        if (url === '/api/chat' && req.method === 'POST') {
          const body = JSON.parse((await readBody(req)).toString() || '{}');
          return this.#chat(res, device, String(body.text || ''));
        }
        if (url === '/api/voice' && req.method === 'POST') {
          const audio = await readBody(req);
          const out = await this.transcribe(audio, req.headers['content-type'] || 'audio/mp4');
          const transcript = (typeof out === 'string' ? out : out?.text || '').trim();
          if (!transcript) return this.json(res, 422, { error: "I couldn't make that out — try again closer to the mic." });
          return this.#chat(res, device, transcript, transcript);
        }
        if (url === '/api/last') return this.json(res, 200, this.lastReply.get(device.id) || { reply: null });
        if (url === '/api/events') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
          const set = this.streams.get(device.id) || new Set();
          set.add(res); this.streams.set(device.id, set);
          req.on('close', () => set.delete(res));
          return;
        }
        return this.json(res, 404, { error: 'Unknown endpoint.' });
      }
      return this.#static(url === '/' ? '/index.html' : url, res);
    } catch (error) {
      return this.json(res, 500, { error: error.message });
    }
  }

  async #chat(res, device, text, transcript = null) {
    const result = await this.router.handle(text, 'general', {
      onStep: (step) => this.pushEvent(device.id, 'agent-step', step)
    });
    const reply = result?.response || result?.text || 'No response.';
    this.lastReply.set(device.id, { reply, at: Date.now() });
    this.pushEvent(device.id, 'reply', { reply });
    return this.json(res, 200, transcript ? { transcript, reply } : { reply });
  }

  #static(url, res) {
    const safe = path.normalize(url).replace(/^([.][.][/\\])+/, '');
    const file = path.join(this.staticDir, safe);
    if (!file.startsWith(this.staticDir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  }

  async start() {
    const settings = this.config.getSettings();
    const address = pickBindAddress();
    if (!address) { this.reason = 'Tailscale is not running on this PC. Install/start Tailscale, then flip the toggle again.'; return { ok: false, reason: this.reason }; }
    const port = Number(settings.mobilePort) || 27183;
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));
      this.server.on('error', (error) => { this.reason = `Could not start on port ${port}: ${error.message}`; this.server = null; resolve({ ok: false, reason: this.reason }); });
      this.server.listen(port, address, () => {
        this.address = address; this.port = port; this.reason = '';
        resolve({ ok: true, address, port });
      });
    });
  }

  stop() { try { this.server?.close(); } catch {} this.server = null; this.address = null; }
  status() { return { running: !!this.server, address: this.address, port: this.port, reason: this.reason }; }
}

module.exports = { pickBindAddress, sseFrame, MobileServer };
```

Note: `start()` binds the Tailscale address only. Loopback testing on the PC works via the same handler in tests; do NOT add a second listener.

- [ ] **Step 4: Run** `node --test test/mobile-server.test.js` then `npm test` — PASS / green.
- [ ] **Step 5: Commit** — `git commit -am "feat(mobile): HTTP+SSE server with auth gate, chat/voice routes, static serving"`

---

### Task 5: Wire into `main.js` + `preload.js` + install `qrcode`

**Files:**
- Modify: `main.js` (construct server, react to settings, IPC), `preload.js`, `package.json` (dep)

**Interfaces:**
- Consumes: `MobileServer`, `MobileAuth`; existing `config`, `router`, `localVoice`.
- Produces (for Task 7's Settings UI): `window.jarvis.mobile = { status(), pair(), devices(), revoke(id) }` where `pair()` → `{ code, url, qr }` (`qr` = data-URL PNG).

- [ ] **Step 1: Install the QR dependency**

```bash
npm install qrcode
```

- [ ] **Step 2: Wire in `main.js`** — near the other service constructions (after `router = new CommandRouter(...)`, around line 755):

```js
const { MobileServer } = require('./core/mobile-server');
const { MobileAuth } = require('./core/mobile-auth');
const QRCode = require('qrcode');

let mobileAuth;
let mobileServer;

function loadMobileDevices() {
  try { return JSON.parse(config.getSecret('mobileDevices') || '[]'); } catch { return []; }
}
function saveMobileDevices() { config.setSecret('mobileDevices', JSON.stringify(mobileAuth.toJSON())); }

async function syncMobileServer() {
  const settings = config.getSettings();
  mobileServer.stop();
  if (settings.mobileEnabled) await mobileServer.start();
  sendEverywhere('mobile:status', mobileServer.status());
}

// in the app-ready wiring, after localVoice is constructed:
mobileAuth = new MobileAuth({ devices: loadMobileDevices() });
mobileServer = new MobileServer({
  config, router, auth: mobileAuth,
  transcribe: (buffer, mimeType) => localVoice.transcribe(buffer, mimeType),
  staticDir: path.join(__dirname, 'src', 'mobile'),
  onDevicesChanged: saveMobileDevices
});
if (config.getSettings().mobileEnabled) syncMobileServer();
```

IPC handlers (next to the `voice:` handlers, ~line 380):

```js
ipcMain.handle('mobile:status', () => mobileServer.status());
ipcMain.handle('mobile:devices', () => mobileAuth.listDevices());
ipcMain.handle('mobile:revoke', (_e, id) => { const ok = mobileAuth.revoke(id); if (ok) saveMobileDevices(); return { ok }; });
ipcMain.handle('mobile:pair', async () => {
  const status = mobileServer.status();
  if (!status.running) return { ok: false, reason: status.reason || 'Turn the mobile toggle on first.' };
  const { code, expiresAt } = mobileAuth.startPairing();
  const url = `http://${status.address}:${status.port}/`;
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 240 });
  return { ok: true, code, url, qr, expiresAt };
});
```

In the settings-changed handler (where `wakeWordEnabled` is compared, ~line 452), add:

```js
if (previous.mobileEnabled !== updated.mobileEnabled || previous.mobilePort !== updated.mobilePort) syncMobileServer();
```

And in the shutdown path (next to `localVoice?.stop()`): `mobileServer?.stop();`

- [ ] **Step 3: Expose in `preload.js`** — following the existing exposed-group pattern:

```js
mobile: {
  status: () => ipcRenderer.invoke('mobile:status'),
  pair: () => ipcRenderer.invoke('mobile:pair'),
  devices: () => ipcRenderer.invoke('mobile:devices'),
  revoke: (id) => ipcRenderer.invoke('mobile:revoke', id),
  onStatus: (fn) => ipcRenderer.on('mobile:status', (_e, s) => fn(s))
},
```

- [ ] **Step 4: Run** `npm test` — green (no new unit surface here; wiring is exercised by Task 8's checklist).
- [ ] **Step 5: Commit** — `git commit -am "feat(mobile): server lifecycle, pairing QR and device IPC wired into main"`

---

### Task 6: The phone app (`src/mobile/`)

**Files:**
- Create: `src/mobile/index.html`, `src/mobile/mobile.css`, `src/mobile/mobile.js`, `src/mobile/manifest.webmanifest`, `src/mobile/sw.js`, `src/mobile/icon.svg`

**Interfaces:**
- Consumes: the Task 4 API exactly as specified (`/api/pair`, `/api/chat`, `/api/voice`, `/api/events`, `/api/last`).
- Produces: the app Adam installs via Add to Home Screen.

- [ ] **Step 1: `index.html`** — three screens toggled by body class: `pairing`, `chat`, `offline`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>JARVIS</title>
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="apple-touch-icon" href="/icon.svg">
  <link rel="stylesheet" href="/mobile.css">
</head>
<body class="pairing">
  <header><h1>J.A.R.V.I.S.</h1><span id="conn-dot"></span></header>

  <section id="screen-pairing">
    <p>Scan the QR code on the desktop (Settings → MOBILE → Pair a phone), or enter the 6-digit code:</p>
    <input id="pair-code" inputmode="numeric" maxlength="6" placeholder="000000" autocomplete="one-time-code">
    <button id="pair-btn">PAIR</button>
    <p id="pair-error" class="error" hidden></p>
  </section>

  <section id="screen-chat" hidden>
    <div id="thread"></div>
    <div id="agent-status" hidden></div>
    <footer>
      <textarea id="composer" rows="1" placeholder="Message JARVIS…"></textarea>
      <button id="send-btn" aria-label="Send">➤</button>
      <button id="mic-btn" aria-label="Hold to talk">🎙</button>
    </footer>
  </section>

  <section id="screen-offline" hidden>
    <p>JARVIS is unreachable — is the PC awake?</p>
    <button id="retry-btn">RETRY</button>
  </section>

  <script src="/mobile.js"></script>
</body>
</html>
```

- [ ] **Step 2: `mobile.css`** — amber Classic language, mobile-first. Core rules (complete file starts from this; keep it lean, ~120 lines):

```css
:root { --amber: #ffb350; --amber-dim: #b97d2e; --bg: #0a0602; --panel: rgba(255, 179, 80, .07); }
* { box-sizing: border-box; margin: 0; }
body { background: var(--bg); color: var(--amber); font-family: "Segoe UI", system-ui, sans-serif; height: 100dvh; display: flex; flex-direction: column; padding: env(safe-area-inset-top) 0 env(safe-area-inset-bottom); }
header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; letter-spacing: .35em; border-bottom: 1px solid var(--amber-dim); }
#conn-dot { width: 10px; height: 10px; border-radius: 50%; background: #555; }
body.online #conn-dot { background: var(--amber); box-shadow: 0 0 8px var(--amber); }
section { flex: 1; display: flex; flex-direction: column; padding: 16px; overflow-y: auto; }
#thread { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
.msg { max-width: 85%; padding: 10px 14px; border-radius: 12px; line-height: 1.45; white-space: pre-wrap; }
.msg.you { align-self: flex-end; background: var(--amber); color: #1a0f00; }
.msg.jarvis { align-self: flex-start; background: var(--panel); border: 1px solid var(--amber-dim); }
#agent-status { font-size: .8rem; color: var(--amber-dim); padding: 6px 2px; font-style: italic; }
footer { display: flex; gap: 8px; padding: 10px 0 4px; align-items: flex-end; }
#composer { flex: 1; background: var(--panel); border: 1px solid var(--amber-dim); border-radius: 10px; color: var(--amber); padding: 10px; font-size: 1rem; resize: none; }
button { background: none; border: 1px solid var(--amber); border-radius: 10px; color: var(--amber); font-size: 1.2rem; padding: 10px 14px; }
#mic-btn.recording { background: var(--amber); color: #1a0f00; box-shadow: 0 0 18px var(--amber); }
.error { color: #ff7a6b; }
input#pair-code { font-size: 2rem; letter-spacing: .5em; text-align: center; background: var(--panel); border: 1px solid var(--amber-dim); color: var(--amber); border-radius: 10px; padding: 12px; margin: 16px 0; }
```

- [ ] **Step 3: `mobile.js`** — the whole client. Complete logic (~170 lines) covering: key in `localStorage('jarvis-mobile-key')`; screen switching; pairing (`POST /api/pair` with typed or QR-hash code — on load, if `location.hash` has a code, auto-fill); chat (`POST /api/chat`, render `you`/`jarvis` bubbles); SSE (`EventSource('/api/events')` — note: EventSource can't set headers, so pass the key as `/api/events?key=…` **and in Task 4's `verify` call accept `?key=` for this one route**  — see step 6); `agent-step` events → `#agent-status` text; `reply` → dedupe against the POST response by text match; reconnect → `GET /api/last`; offline detection (fetch failure → `offline` screen, RETRY re-probes); press-and-hold mic via `MediaRecorder` (`pointerdown` start, `pointerup` stop → POST blob to `/api/voice`), render transcript as a `you` bubble; speak replies via `speechSynthesis`, choosing the first `en-GB` male-ish voice (`Daniel`, `Arthur`, else any `en-GB`, else default) — mirror the desktop's preference order with the iOS voice names; a `speaking` guard so double replies don't overlap.

```js
const key = () => localStorage.getItem('jarvis-mobile-key');
const headers = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${key()}` });

function show(screen) {
  document.body.className = screen;
  for (const s of ['pairing', 'chat', 'offline']) document.getElementById(`screen-${s}`).hidden = s !== screen;
  if (screen === 'chat') document.body.classList.add('online');
}

function bubble(who, text) {
  const div = document.createElement('div');
  div.className = `msg ${who}`;
  div.textContent = text;
  const thread = document.getElementById('thread');
  thread.appendChild(div);
  thread.scrollTop = thread.scrollHeight;
}

function speak(text) {
  const utter = new SpeechSynthesisUtterance(text);
  const voices = speechSynthesis.getVoices();
  utter.voice = voices.find((v) => /en-GB/i.test(v.lang) && /daniel|arthur/i.test(v.name))
    || voices.find((v) => /en-GB/i.test(v.lang)) || null;
  speechSynthesis.cancel();
  speechSynthesis.speak(utter);
}

let lastRendered = '';
async function send(text, { spoken = false } = {}) {
  bubble('you', text);
  document.getElementById('agent-status').hidden = false;
  document.getElementById('agent-status').textContent = 'Working…';
  try {
    const res = await fetch('/api/chat', { method: 'POST', headers: headers(), body: JSON.stringify({ text }) });
    if (res.status === 401) { localStorage.removeItem('jarvis-mobile-key'); return show('pairing'); }
    const out = await res.json();
    renderReply(out.reply, spoken);
  } catch { show('offline'); }
}

function renderReply(reply, spoken) {
  document.getElementById('agent-status').hidden = true;
  if (!reply || reply === lastRendered) return;
  lastRendered = reply;
  bubble('jarvis', reply);
  if (spoken) speak(reply);
}

function connectEvents() {
  const es = new EventSource(`/api/events?key=${encodeURIComponent(key())}`);
  es.addEventListener('agent-step', (e) => {
    const step = JSON.parse(e.data);
    const el = document.getElementById('agent-status');
    el.hidden = false; el.textContent = step.summary || `Step ${step.index}…`;
  });
  es.addEventListener('reply', (e) => renderReply(JSON.parse(e.data).reply, false));
  es.onerror = () => {};   // EventSource auto-reconnects
}

// --- mic: press and hold ---
let recorder = null, chunks = [];
const micBtn = document.getElementById('mic-btn');
micBtn.addEventListener('pointerdown', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/mp4' });
      if (blob.size < 1000) return;   // accidental tap
      document.getElementById('agent-status').hidden = false;
      document.getElementById('agent-status').textContent = 'Listening back…';
      try {
        const res = await fetch('/api/voice', { method: 'POST', headers: { 'Content-Type': blob.type, Authorization: `Bearer ${key()}` }, body: blob });
        if (res.status === 401) { localStorage.removeItem('jarvis-mobile-key'); return show('pairing'); }
        const out = await res.json();
        if (out.error) return renderReply(out.error, true);
        bubble('you', out.transcript);
        renderReply(out.reply, true);
      } catch { show('offline'); }
    };
    recorder.start();
    micBtn.classList.add('recording');
  } catch { alert('Microphone is blocked. Allow it in iOS Settings → Safari → Microphone.'); }
});
micBtn.addEventListener('pointerup', () => { recorder?.stop(); micBtn.classList.remove('recording'); });

// --- composer ---
document.getElementById('send-btn').addEventListener('click', () => {
  const box = document.getElementById('composer');
  const text = box.value.trim();
  if (!text) return;
  box.value = '';
  send(text);
});

// --- pairing ---
document.getElementById('pair-btn').addEventListener('click', async () => {
  const code = document.getElementById('pair-code').value.trim();
  try {
    const res = await fetch('/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, name: navigator.platform || 'Phone' }) });
    const out = await res.json();
    if (!res.ok) { const err = document.getElementById('pair-error'); err.hidden = false; err.textContent = out.error; return; }
    localStorage.setItem('jarvis-mobile-key', out.key);
    boot();
  } catch { show('offline'); }
});

document.getElementById('retry-btn').addEventListener('click', boot);

async function boot() {
  if (location.hash.length > 1) { document.getElementById('pair-code').value = location.hash.slice(1); history.replaceState(null, '', '/'); }
  if (!key()) return show('pairing');
  try {
    const res = await fetch('/api/last', { headers: headers() });
    if (res.status === 401) { localStorage.removeItem('jarvis-mobile-key'); return show('pairing'); }
    const out = await res.json();
    show('chat');
    if (out.reply && out.reply !== lastRendered) { lastRendered = out.reply; bubble('jarvis', out.reply); }
    connectEvents();
  } catch { show('offline'); }
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
speechSynthesis.getVoices();   // prime the voice list (iOS loads it lazily)
boot();
```

- [ ] **Step 4: `manifest.webmanifest`, `sw.js`, `icon.svg`:**

```json
{ "name": "JARVIS", "short_name": "JARVIS", "start_url": "/", "display": "standalone",
  "background_color": "#0a0602", "theme_color": "#0a0602",
  "icons": [{ "src": "/icon.svg", "sizes": "any", "type": "image/svg+xml" }] }
```

```js
// sw.js — app-shell cache only; API calls always hit the network.
const SHELL = ['/', '/mobile.css', '/mobile.js', '/manifest.webmanifest', '/icon.svg'];
self.addEventListener('install', (e) => e.waitUntil(caches.open('jarvis-shell-v1').then((c) => c.addAll(SHELL))));
self.addEventListener('fetch', (e) => {
  if (new URL(e.request.url).pathname.startsWith('/api/')) return;
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
```

`icon.svg`: an amber ring on near-black — reuse the desktop orb's colors:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#0a0602"/><circle cx="50" cy="50" r="30" fill="none" stroke="#ffb350" stroke-width="6"/><circle cx="50" cy="50" r="12" fill="#ffb350"/></svg>
```

- [ ] **Step 5: Update Task 4's auth for EventSource** — `EventSource` cannot send headers. In `MobileServer.handleRequest`, for the `/api/events` route ONLY, before the verify call: `const authHeader = req.headers.authorization || (url.includes('key=') ? \`Bearer \${decodeURIComponent(url.split('key=')[1])}\` : undefined);` and verify with that. Add a unit test: an events request with `?key=<key>` and no header gets a 200 stream; any other route with `?key=` still 401s.
- [ ] **Step 6: Run** `npm test` — green.
- [ ] **Step 7: Commit** — `git commit -am "feat(mobile): the phone app — pairing, chat, press-and-hold voice, PWA shell"`

---

### Task 7: Settings MOBILE section (desktop)

**Files:**
- Modify: `src/index.html` (MOBILE section after AUTONOMY, ~line 330), `src/renderer.js`

**Interfaces:**
- Consumes: `window.jarvis.mobile.*` (Task 5), settings fields (Task 1).

- [ ] **Step 1: `src/index.html`** — after the AUTONOMY block:

```html
<h3>MOBILE</h3>
<label class="toggle-row"><span><b>PHONE ACCESS</b><small>Serve JARVIS to your paired phones over Tailscale. Off: no server runs.</small></span><input id="setting-mobile" type="checkbox"><i></i></label>
<div id="mobile-status" class="setting-note"></div>
<div class="setting-row"><span>Port</span><input id="setting-mobile-port" type="number" min="1024" max="65535"></div>
<button id="mobile-pair-btn" class="secondary">PAIR A PHONE</button>
<div id="mobile-pair-panel" hidden>
  <img id="mobile-qr" alt="Pairing QR">
  <p>Scan with the iPhone camera, or browse to <code id="mobile-url"></code> and enter code <b id="mobile-code"></b>. Expires in 2 minutes.</p>
</div>
<ul id="mobile-devices" class="plain-list"></ul>
```

(Adopt the exact class names of neighboring rows if they differ — match the file, not this snippet.)

- [ ] **Step 2: `src/renderer.js`** — follow the pattern of the AUTONOMY settings bindings: read `settings.mobileEnabled`/`mobilePort` into the controls on settings-open; write them back on save; then:

```js
async function refreshMobileSection() {
  const status = await window.jarvis.mobile.status();
  const note = document.getElementById('mobile-status');
  note.textContent = status.running ? `Serving at http://${status.address}:${status.port}/` : (status.reason || 'Off.');
  const devices = await window.jarvis.mobile.devices();
  const list = document.getElementById('mobile-devices');
  list.innerHTML = '';
  for (const d of devices) {
    const li = document.createElement('li');
    li.textContent = `${d.name} — paired ${new Date(d.createdAt).toLocaleDateString()} `;
    const btn = document.createElement('button');
    btn.textContent = 'REVOKE';
    btn.addEventListener('click', async () => { await window.jarvis.mobile.revoke(d.id); refreshMobileSection(); });
    li.appendChild(btn);
    list.appendChild(li);
  }
}
document.getElementById('mobile-pair-btn').addEventListener('click', async () => {
  const out = await window.jarvis.mobile.pair();
  const panel = document.getElementById('mobile-pair-panel');
  if (!out.ok) { document.getElementById('mobile-status').textContent = out.reason; return; }
  panel.hidden = false;
  document.getElementById('mobile-qr').src = out.qr;
  document.getElementById('mobile-url').textContent = out.url;
  document.getElementById('mobile-code').textContent = out.code;
});
window.jarvis.mobile.onStatus(() => refreshMobileSection());
```

Call `refreshMobileSection()` wherever the Settings dialog is opened (search for where AUTONOMY fields are populated). Ensure both skins pick up the section (Settings is shared; the Command Center recolor rules apply automatically since they target the dialog, not sections).

- [ ] **Step 3: Run** `npm test` (green) and a headless capture sanity check: `JARVIS_CAPTURE_PATH` run per `docs/` gotchas to confirm the app still boots.
- [ ] **Step 4: Commit** — `git commit -am "feat(mobile): Settings MOBILE section — toggle, port, QR pairing, device revoke"`

---

### Task 8: Manual checklist doc + version bump

**Files:**
- Create: `docs/MOBILE-TESTING-CHECKLIST.md`
- Modify: `package.json` (`0.11.2` → `0.12.0`), `CHANGELOG.md`

- [ ] **Step 1: Write `docs/MOBILE-TESTING-CHECKLIST.md`** — numbered, novice-proof, in this order: install Tailscale on PC (tailscale.com/download, sign in), install Tailscale iOS app (same account, toggle VPN on), flip PHONE ACCESS on in JARVIS Settings, PAIR A PHONE → scan QR with iPhone camera → PAIR, Add to Home Screen (Share → Add to Home Screen), send a text message, press-and-hold voice test, turn PC Wi-Fi off mid-reply → phone shows unreachable → RETRY when back, revoke from desktop → phone drops to pairing screen, re-pair, cellular test (Wi-Fi off on phone), PC sleep-settings note (Settings → System → Power: set Sleep to Never while away, or accept that JARVIS naps when the PC does).
- [ ] **Step 2: Bump version + CHANGELOG** — `package.json` version `0.12.0`; CHANGELOG entry: "0.12.0 — JARVIS Mobile: phone chat + voice over Tailscale (pair by QR, revoke in Settings, off by default)."
- [ ] **Step 3: Run** `npm test` — green.
- [ ] **Step 4: Commit** — `git commit -am "docs(mobile): phone testing checklist; version 0.12.0"`

---

## Self-Review (done at write time)

- **Spec coverage:** settings/off-by-default (T1), pairing+keys+lockout (T2), tailnet-only bind (T3/T4), chat+voice+SSE+/api/last (T4/T6), Settings UI+QR+revoke (T5/T7), error manners (T4 messages + T6 offline screen), testing (unit throughout + T8 checklist). Approval gating needs no new code — `router.handle` already returns the gated response text; constraint noted globally.
- **Type consistency:** `verify(authHeader, ip)`, `claimPairing(code, name)`, `pushEvent(deviceId, event, data)`, `{transcript, reply}` voice shape, `?key=` SSE exception — consistent across tasks.
- **Placeholders:** none; all steps carry real code or exact commands.
