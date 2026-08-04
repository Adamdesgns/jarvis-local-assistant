# JR Video Calls — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** JARVIS can place and receive FaceTime-style video calls with JARVIS JR over Tailscale — this plan builds everything that lives on `main` (shared core + dad-side UI).

**Architecture:** WebRTC (Chromium's, in the renderer) carries video/audio PC-to-PC; a small Tailscale-bound HTTP signaling server in each app (mobile-server.js mold) relays the offer/answer/ICE handshake; a pure state machine in main owns ring/answer/timeout/busy; pairing is a 6-digit single-use code that leaves both sides holding one shared secret (mobile-auth.js mold).

**Tech Stack:** Node built-ins only (`node:http`, `node:crypto`), Electron IPC, renderer WebRTC. **Zero new dependencies.**

**Spec:** `docs/superpowers/specs/2026-08-02-jr-video-call-design.md`

**Scope note:** The spec's kid-side pieces (Call Dad button, full-screen ring, auto-answer *wiring*, RPS/lens-nap coordination) are built on the `jarvis-jr-work` branch in the `apps/jarvis-jr-build` worktree AFTER this plan's work merges into it — they get their own follow-up plan there. The auto-answer *logic* is built and tested here (Task 2); JR only flips it on. One deliberate deviation from the spec: no `/call/events` SSE endpoint — the renderer is in the same process tree and gets events over IPC; SSE served the phone, and nothing here is a phone.

## Global Constraints

- Test runner: `npm test` → `node --test` (node:test + node:assert/strict); pure-logic modules take injectable `now`/`random`/timer functions like `core/mobile-auth.js`.
- No new npm dependencies, no STUN/TURN servers — `RTCPeerConnection({ iceServers: [] })`.
- Signaling binds ONLY the Tailscale interface (reuse `pickBindAddress` from `core/mobile-server.js`) plus loopback; default port **27184** (`callPort` setting; mobile server owns 27183).
- Every request except the pairing claim requires `Authorization: Bearer <sharedSecret>`; verification is constant-time (`crypto.timingSafeEqual`); 10 consecutive failures per IP = lockout (mobile-auth mold).
- Timeouts: caller ring **45 000 ms**, auto-answer **20 000 ms** (kid mode only), drop-reconnect grace **8 000 ms**. One session at a time — a second offer gets `busy`.
- Error strings are plain English, user-facing, never contain paths or stack text (mobile-server precedent).
- Comment style: explain the constraint, not the next line. Match the repo's voice.
- Commit after every task; never push (Adam's word required).

---

### Task 1: CallAuth — pairing + the single trusted peer

**Files:**
- Create: `core/call/call-auth.js`
- Test: `test/call-auth.test.js`

**Interfaces:**
- Consumes: nothing (pure logic).
- Produces: `class CallAuth` with `startPairing() → {code, expiresAt}`, `claimPairing(code, peerName, ip) → {secret, peer}|null`, `adoptPeer({name, host, secret}) → peer`, `verify(authHeader, ip) → peer-without-secret|null`, `isLockedOut(ip)`, `unpair()`, `toJSON() → peer|null`; `peer` shape `{name, role: 'kid'|'parent', secret, host, pairedAt}`. Constant `PAIRING_TTL_MS = 120000`.

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CallAuth, PAIRING_TTL_MS } = require('../core/call/call-auth');

test('pairing: 6-digit code, single use, expires after 120s', () => {
  let t = 1000;
  const auth = new CallAuth({ now: () => t });
  const { code, expiresAt } = auth.startPairing();
  assert.match(code, /^\d{6}$/);
  assert.equal(expiresAt, 1000 + PAIRING_TTL_MS);
  assert.equal(auth.claimPairing('000000', 'JR', '100.64.0.9'), null); // wrong code
  const claimed = auth.claimPairing(code, 'JR', '100.64.0.9');
  assert.ok(claimed.secret.length >= 40);                    // 32 bytes base64url
  assert.equal(auth.claimPairing(code, 'again', '100.64.0.9'), null); // single use
  const { code: c2 } = auth.startPairing();
  t += PAIRING_TTL_MS + 1;
  assert.equal(auth.claimPairing(c2, 'late', '100.64.0.9'), null);    // expired
});

test('a successful claim stores the claimer as the kid peer, host from the wire', () => {
  const auth = new CallAuth();
  const { code } = auth.startPairing();
  const { peer } = auth.claimPairing(code, 'JR', '100.101.5.5');
  assert.equal(peer.role, 'kid');
  assert.equal(peer.host, '100.101.5.5');
  assert.equal(peer.name, 'JR');
});

test('adoptPeer stores the parent side (what the claim response handed back)', () => {
  const auth = new CallAuth();
  const peer = auth.adoptPeer({ name: 'JARVIS', host: '100.90.1.1', secret: 'abc' });
  assert.equal(peer.role, 'parent');
  assert.equal(auth.toJSON().host, '100.90.1.1');
});

test('verify: right secret passes without leaking it, wrong secret fails', () => {
  const auth = new CallAuth();
  const { code } = auth.startPairing();
  const { secret } = auth.claimPairing(code, 'JR', '1.1.1.1');
  const peer = auth.verify(`Bearer ${secret}`, '1.1.1.1');
  assert.equal(peer.name, 'JR');
  assert.equal(peer.secret, undefined);                      // never hand it back
  assert.equal(auth.verify('Bearer nope', '1.1.1.1'), null);
  assert.equal(auth.verify(undefined, '1.1.1.1'), null);
});

test('10 straight failures lock an IP out; success clears the count', () => {
  const auth = new CallAuth();
  const { code } = auth.startPairing();
  const { secret } = auth.claimPairing(code, 'JR', '2.2.2.2');
  for (let i = 0; i < 9; i++) auth.verify('Bearer bad', '9.9.9.9');
  assert.ok(!auth.isLockedOut('9.9.9.9'));
  auth.verify('Bearer bad', '9.9.9.9');
  assert.ok(auth.isLockedOut('9.9.9.9'));
  assert.equal(auth.verify(`Bearer ${secret}`, '9.9.9.9'), null); // locked out ≠ wrong secret
  assert.ok(auth.verify(`Bearer ${secret}`, '2.2.2.2'));          // other IPs unaffected
});

test('unpair forgets the peer; verify then fails; re-pairing replaces cleanly', () => {
  const auth = new CallAuth();
  const { code } = auth.startPairing();
  const { secret } = auth.claimPairing(code, 'JR', '3.3.3.3');
  auth.unpair();
  assert.equal(auth.toJSON(), null);
  assert.equal(auth.verify(`Bearer ${secret}`, '3.3.3.3'), null);
});

test('persistence round-trip: new CallAuth({peer: old.toJSON()}) verifies the same secret', () => {
  const first = new CallAuth();
  const { code } = first.startPairing();
  const { secret } = first.claimPairing(code, 'JR', '4.4.4.4');
  const revived = new CallAuth({ peer: first.toJSON() });
  assert.ok(revived.verify(`Bearer ${secret}`, '4.4.4.4'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/call-auth.test.js`
Expected: FAIL — `Cannot find module '../core/call/call-auth'`

- [ ] **Step 3: Write the implementation**

```js
// Pairing and the single trusted peer for JARVIS ↔ JR calls. Pure logic in
// the mobile-auth.js mold: no I/O, no Electron; persistence is the caller's
// job via toJSON(). Differences from MobileAuth are deliberate:
//   - exactly ONE peer, never a list — re-pairing replaces it
//   - the claim hands the generated secret back so BOTH sides hold the same
//     one; every later request in either direction carries it
//   - roles are stamped at pairing time: the side that showed the code is
//     'parent' to the claimer, the claimer is 'kid' to the shower. Phase 2
//     control offers are only honored from the parent side, so this field is
//     enforced locally, never trusted off the wire.
'use strict';
const crypto = require('node:crypto');

const PAIRING_TTL_MS = 120000;
const LOCKOUT_LIMIT = 10;

class CallAuth {
  constructor({ peer = null, random = crypto.randomBytes, now = () => Date.now() } = {}) {
    this.peer = peer ? { ...peer } : null;   // { name, role, secret, host, pairedAt }
    this.random = random;
    this.now = now;
    this.pairing = null;                     // { code, expiresAt }
    this.failures = new Map();               // ip → consecutive failure count
  }

  startPairing() {
    const code = String(this.random(4).readUInt32BE(0) % 1000000).padStart(6, '0');
    this.pairing = { code, expiresAt: this.now() + PAIRING_TTL_MS };
    this.failures.clear();                   // a human is at the desk; clear lockouts
    return { ...this.pairing };
  }

  // The claim arrives over the wire from the OTHER machine: it becomes our
  // peer, its Tailscale address becomes the host we dial back, and the
  // generated secret goes back in the response so both ends match forever.
  claimPairing(code, peerName, ip) {
    if (this.isLockedOut(ip)) return null;
    const p = this.pairing;
    if (!p || this.now() > p.expiresAt || String(code) !== p.code) {
      this.failures.set(ip, (this.failures.get(ip) || 0) + 1);
      return null;
    }
    this.pairing = null;                     // single use
    const secret = this.random(32).toString('base64url');
    this.peer = {
      name: String(peerName || 'JR').slice(0, 60),
      role: 'kid', secret, host: String(ip || ''), pairedAt: this.now()
    };
    this.failures.delete(ip);
    return { secret, peer: { ...this.peer } };
  }

  // The other half of claimPairing: the machine that TYPED the code stores
  // what the claim response handed back. Its peer is the parent side.
  adoptPeer({ name, host, secret }) {
    this.peer = {
      name: String(name || 'JARVIS').slice(0, 60),
      role: 'parent', secret: String(secret), host: String(host), pairedAt: this.now()
    };
    return { ...this.peer };
  }

  verify(authHeader, ip) {
    if (this.isLockedOut(ip)) return null;
    const offered = Buffer.from(String(authHeader || '').replace(/^Bearer\s+/i, ''));
    const held = this.peer ? Buffer.from(this.peer.secret) : Buffer.alloc(0);
    const match = this.peer && offered.length === held.length &&
      offered.length > 0 && crypto.timingSafeEqual(offered, held);
    if (!match) {
      this.failures.set(ip, (this.failures.get(ip) || 0) + 1);
      return null;
    }
    this.failures.delete(ip);
    const { secret, ...peer } = this.peer;
    return peer;
  }

  isLockedOut(ip) { return (this.failures.get(ip) || 0) >= LOCKOUT_LIMIT; }
  unpair() { this.peer = null; }
  toJSON() { return this.peer ? { ...this.peer } : null; }
}

module.exports = { CallAuth, PAIRING_TTL_MS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/call-auth.test.js`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add core/call/call-auth.js test/call-auth.test.js
git commit -m "calls: pairing + single trusted peer (CallAuth)"
```

---

### Task 2: CallSession — the ring/answer/timeout state machine

**Files:**
- Create: `core/call/call-session.js`
- Test: `test/call-session.test.js`

**Interfaces:**
- Consumes: nothing (pure logic, injectable timers).
- Produces: `class CallSession` with `dial() → {ok, callId?|reason}`, `incomingOffer(callId) → {ok, autoAnswerAt?|reason}`, `peerAnswered(callId)`, `localAnswered(callId)`, `connected()`, `disconnected()`, `reconnected()`, `end(reason) → {ok, reason}`, `status() → {state, callId, autoAnswer}`. States: `idle | ringing-out | ringing-in | connecting | live`. Events via `onEvent(type, data)`: `ring-timeout`, `missed`, `auto-answer`, `live`, `ended`. Constants `RING_TIMEOUT_MS = 45000`, `AUTO_ANSWER_MS = 20000`, `RECONNECT_GRACE_MS = 8000`.

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CallSession, RING_TIMEOUT_MS, AUTO_ANSWER_MS, RECONNECT_GRACE_MS } = require('../core/call/call-session');

// Manual timer harness: captures callbacks, fires them by hand.
function timers() {
  const pending = new Map();
  let id = 0;
  return {
    setTimer: (fn, ms) => { pending.set(++id, { fn, ms }); return id; },
    clearTimer: (t) => pending.delete(t),
    fire(ms) { for (const [key, { fn, ms: due }] of [...pending]) if (due === ms) { pending.delete(key); fn(); } },
    count: () => pending.size
  };
}

function harness(opts = {}) {
  const events = [];
  const t = timers();
  const session = new CallSession({
    ...opts, setTimer: t.setTimer, clearTimer: t.clearTimer,
    onEvent: (type, data) => events.push({ type, ...data })
  });
  return { session, events, t };
}

test('dial: idle → ringing-out with a callId; busy while not idle', () => {
  const { session } = harness();
  const dialed = session.dial();
  assert.ok(dialed.ok);
  assert.ok(dialed.callId.length > 10);
  assert.equal(session.status().state, 'ringing-out');
  assert.deepEqual(session.dial(), { ok: false, reason: 'busy' });
});

test('caller gives up at 45s: ring-timeout event, back to idle', () => {
  const { session, events, t } = harness();
  session.dial();
  t.fire(RING_TIMEOUT_MS);
  assert.equal(events.at(-1).type, 'ring-timeout');
  assert.equal(session.status().state, 'idle');
});

test('full happy path caller side: dial → peerAnswered → connected → end', () => {
  const { session, events, t } = harness();
  const { callId } = session.dial();
  session.peerAnswered(callId);
  assert.equal(session.status().state, 'connecting');
  assert.equal(t.count(), 0);                       // ring timer cleared
  session.connected();
  assert.equal(session.status().state, 'live');
  assert.equal(events.at(-1).type, 'live');
  session.end('hangup');
  assert.equal(session.status().state, 'idle');
  assert.deepEqual(events.at(-1), { type: 'ended', reason: 'hangup', callId });
});

test('callee side: incomingOffer rings, localAnswered connects; busy when not idle', () => {
  const { session } = harness();
  const incoming = session.incomingOffer('call-1');
  assert.ok(incoming.ok);
  assert.equal(session.status().state, 'ringing-in');
  assert.deepEqual(session.incomingOffer('call-2'), { ok: false, reason: 'busy' });
  session.localAnswered('call-1');
  assert.equal(session.status().state, 'connecting');
});

test('unanswered incoming call is missed at 45s', () => {
  const { session, events, t } = harness();
  session.incomingOffer('call-1');
  t.fire(RING_TIMEOUT_MS);
  assert.equal(events.at(-1).type, 'missed');
  assert.equal(session.status().state, 'idle');
});

test('auto-answer fires at 20s ONLY when constructed with autoAnswer: true', () => {
  const kid = harness({ autoAnswer: true });
  const at = kid.session.incomingOffer('call-1');
  assert.ok(at.autoAnswerAt > 0);
  kid.t.fire(AUTO_ANSWER_MS);
  assert.equal(kid.events.at(-1).type, 'auto-answer');

  const dad = harness();                            // default: no auto-answer path at all
  const plain = dad.session.incomingOffer('call-2');
  assert.equal(plain.autoAnswerAt, null);
  dad.t.fire(AUTO_ANSWER_MS);
  assert.ok(!dad.events.some((e) => e.type === 'auto-answer'));
});

test('drop: disconnected arms an 8s grace; reconnected clears it; expiry ends the call', () => {
  const { session, events, t } = harness();
  const { callId } = session.dial();
  session.peerAnswered(callId); session.connected();
  session.disconnected();
  session.reconnected();
  t.fire(RECONNECT_GRACE_MS);                       // cleared — must NOT end
  assert.equal(session.status().state, 'live');
  session.disconnected();
  t.fire(RECONNECT_GRACE_MS);
  assert.deepEqual(events.at(-1), { type: 'ended', reason: 'dropped', callId });
  assert.equal(session.status().state, 'idle');
});

test('end always returns to idle and clears every timer, from any state', () => {
  const { session, t } = harness({ autoAnswer: true });
  session.incomingOffer('call-1');
  session.end('declined');
  assert.equal(session.status().state, 'idle');
  assert.equal(t.count(), 0);
});

test('stale callIds are ignored: an answer for a dead call does nothing', () => {
  const { session } = harness();
  const { callId } = session.dial();
  session.end('hangup');
  session.peerAnswered(callId);                     // late packet from the ended call
  assert.equal(session.status().state, 'idle');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/call-session.test.js`
Expected: FAIL — `Cannot find module '../core/call/call-session'`

- [ ] **Step 3: Write the implementation**

```js
// The one call at a time, and what state it is in. Pure logic: timers are
// injected so tests fire them by hand, and every transition that matters to
// a human surfaces as an onEvent — main.js forwards those to the renderer
// and to the peer, this module never touches a socket.
//
// Auto-answer exists only when constructed with { autoAnswer: true } — the
// JR build passes it, the JARVIS build never does, so Dad's PC has no code
// path that answers by itself (spec: "never auto-answers").
'use strict';
const crypto = require('node:crypto');

const RING_TIMEOUT_MS = 45000;
const AUTO_ANSWER_MS = 20000;
const RECONNECT_GRACE_MS = 8000;

class CallSession {
  constructor({ autoAnswer = false, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, onEvent = () => {} } = {}) {
    this.autoAnswer = !!autoAnswer;
    this.now = now; this.setTimer = setTimer; this.clearTimer = clearTimer;
    this.onEvent = onEvent;
    this.state = 'idle';
    this.callId = null;
    this.timers = { ring: null, auto: null, grace: null };
  }

  #emit(type, data = {}) { this.onEvent(type, { callId: this.callId, ...data }); }
  #clearAll() { for (const key of Object.keys(this.timers)) { if (this.timers[key]) { this.clearTimer(this.timers[key]); this.timers[key] = null; } } }
  #reset() { this.#clearAll(); this.state = 'idle'; this.callId = null; }

  dial() {
    if (this.state !== 'idle') return { ok: false, reason: 'busy' };
    this.state = 'ringing-out';
    this.callId = crypto.randomUUID();
    this.timers.ring = this.setTimer(() => { this.#emit('ring-timeout'); this.#reset(); }, RING_TIMEOUT_MS);
    return { ok: true, callId: this.callId };
  }

  incomingOffer(callId) {
    if (this.state !== 'idle') return { ok: false, reason: 'busy' };
    this.state = 'ringing-in';
    this.callId = String(callId);
    this.timers.ring = this.setTimer(() => { this.#emit('missed'); this.#reset(); }, RING_TIMEOUT_MS);
    let autoAnswerAt = null;
    if (this.autoAnswer) {
      autoAnswerAt = this.now() + AUTO_ANSWER_MS;
      this.timers.auto = this.setTimer(() => { this.#emit('auto-answer'); }, AUTO_ANSWER_MS);
    }
    return { ok: true, autoAnswerAt };
  }

  peerAnswered(callId) {
    if (this.state !== 'ringing-out' || String(callId) !== this.callId) return;
    this.#clearAll();
    this.state = 'connecting';
  }

  localAnswered(callId) {
    if (this.state !== 'ringing-in' || String(callId) !== this.callId) return;
    this.#clearAll();
    this.state = 'connecting';
  }

  connected() {
    if (this.state !== 'connecting' && this.state !== 'live') return;
    if (this.timers.grace) { this.clearTimer(this.timers.grace); this.timers.grace = null; }
    if (this.state !== 'live') { this.state = 'live'; this.#emit('live'); }
  }

  disconnected() {
    if (this.state !== 'live' || this.timers.grace) return;
    this.timers.grace = this.setTimer(() => { const callId = this.callId; this.#reset(); this.onEvent('ended', { callId, reason: 'dropped' }); }, RECONNECT_GRACE_MS);
  }

  reconnected() {
    if (this.timers.grace) { this.clearTimer(this.timers.grace); this.timers.grace = null; }
  }

  end(reason = 'hangup') {
    if (this.state === 'idle') return { ok: true, reason };
    const callId = this.callId;
    this.#reset();
    this.onEvent('ended', { callId, reason });
    return { ok: true, reason };
  }

  status() { return { state: this.state, callId: this.callId, autoAnswer: this.autoAnswer }; }
}

module.exports = { CallSession, RING_TIMEOUT_MS, AUTO_ANSWER_MS, RECONNECT_GRACE_MS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/call-session.test.js`
Expected: PASS, 9 tests

- [ ] **Step 5: Commit**

```bash
git add core/call/call-session.js test/call-session.test.js
git commit -m "calls: ring/answer/timeout/busy state machine (CallSession)"
```

---

### Task 3: CallClient — talking TO the peer

**Files:**
- Create: `core/call/call-client.js`
- Test: `test/call-client.test.js`

**Interfaces:**
- Consumes: `getPeer() → {host, secret}|null` (main wires it to `CallAuth`).
- Produces: `class CallClient` with async `ping()`, `offer({callId, kind, sdp})`, `answer({callId, sdp})`, `ice({callId, candidate})`, `hangup({callId, reason})` — each returns `{ok, data?|reason}` — and `claim(host, code, name)` (pre-pairing, no auth) returning `{ok, secret?, name?, reason?}`. All failures come back as plain-English `reason` strings; nothing throws.

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CallClient } = require('../core/call/call-client');

// fetch stub: records calls, returns a canned response.
function stubFetch(status = 200, body = { ok: true }) {
  const calls = [];
  const fn = async (url, options) => {
    calls.push({ url: String(url), options });
    return { status, ok: status < 400, json: async () => body };
  };
  return { fn, calls };
}

const peer = () => ({ host: '100.101.5.5', secret: 's3cret' });

test('requests hit http://host:27184/call/<path> with the bearer secret', async () => {
  const { fn, calls } = stubFetch();
  const client = new CallClient({ getPeer: peer, fetchFn: fn });
  await client.ping();
  assert.equal(calls[0].url, 'http://100.101.5.5:27184/call/ping');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer s3cret');
});

test('offer/answer/ice/hangup POST their JSON bodies', async () => {
  const { fn, calls } = stubFetch();
  const client = new CallClient({ getPeer: peer, fetchFn: fn });
  await client.offer({ callId: 'c1', kind: 'call', sdp: 'v=0' });
  const sent = JSON.parse(calls[0].options.body);
  assert.deepEqual(sent, { callId: 'c1', kind: 'call', sdp: 'v=0' });
  assert.equal(calls[0].options.method, 'POST');
});

test('unpaired: every call refuses with a plain reason and never fetches', async () => {
  const { fn, calls } = stubFetch();
  const client = new CallClient({ getPeer: () => null, fetchFn: fn });
  const result = await client.ping();
  assert.equal(result.ok, false);
  assert.match(result.reason, /paired/i);
  assert.equal(calls.length, 0);
});

test('network failure comes back as {ok:false, reason}, never a throw', async () => {
  const client = new CallClient({ getPeer: peer, fetchFn: async () => { throw new Error('ECONNREFUSED 100.101.5.5'); } });
  const result = await client.ping();
  assert.equal(result.ok, false);
  assert.ok(!/ECONNREFUSED/.test(result.reason));   // raw network text never reaches the UI
});

test('peer rejection surfaces the body reason (busy)', async () => {
  const { fn } = stubFetch(409, { ok: false, reason: 'busy' });
  const client = new CallClient({ getPeer: peer, fetchFn: fn });
  const result = await client.offer({ callId: 'c1', kind: 'call', sdp: 'v=0' });
  assert.deepEqual(result, { ok: false, reason: 'busy' });
});

test('claim posts code+name to an explicit host with no auth header', async () => {
  const { fn, calls } = stubFetch(200, { secret: 'newsecret', name: 'JARVIS' });
  const client = new CallClient({ getPeer: () => null, fetchFn: fn });
  const result = await client.claim('100.90.1.1', '123456', 'JR');
  assert.equal(calls[0].url, 'http://100.90.1.1:27184/call/pair');
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.deepEqual(result, { ok: true, secret: 'newsecret', name: 'JARVIS' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/call-client.test.js`
Expected: FAIL — `Cannot find module '../core/call/call-client'`

- [ ] **Step 3: Write the implementation**

```js
// The outbound half of signaling: five tiny POST/GETs to the peer's
// signal server. Everything resolves to {ok, ...} — a dead peer is a
// normal answer here ("JR is offline"), never an exception, and raw
// network error text never crosses into the UI.
'use strict';

const DEFAULT_PORT = 27184;
const TIMEOUT_MS = 5000;

class CallClient {
  constructor({ getPeer, port = DEFAULT_PORT, fetchFn = fetch, timeoutMs = TIMEOUT_MS } = {}) {
    this.getPeer = typeof getPeer === 'function' ? getPeer : () => null;
    this.port = port; this.fetchFn = fetchFn; this.timeoutMs = timeoutMs;
  }

  async #request(host, path, { method = 'POST', body = null, secret = null } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (secret) headers.Authorization = `Bearer ${secret}`;
    const controller = new AbortController();
    const kill = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(`http://${host}:${this.port}/call/${path}`, {
        method, headers, signal: controller.signal,
        body: body === null ? undefined : JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, reason: data.reason || data.error || 'The other side said no.' };
      return { ok: true, ...data };
    } catch {
      return { ok: false, reason: "Couldn't reach the other PC. It may be off, or Tailscale may be down." };
    } finally {
      clearTimeout(kill);
    }
  }

  async #toPeer(path, body = null, method = 'POST') {
    const peer = this.getPeer();
    if (!peer) return { ok: false, reason: 'Not paired yet. Pair the two PCs in Settings first.' };
    return this.#request(peer.host, path, { method, body, secret: peer.secret });
  }

  ping() { return this.#toPeer('ping', null, 'GET'); }
  offer({ callId, kind, sdp }) { return this.#toPeer('offer', { callId, kind, sdp }); }
  answer({ callId, sdp }) { return this.#toPeer('answer', { callId, sdp }); }
  ice({ callId, candidate }) { return this.#toPeer('ice', { callId, candidate }); }
  hangup({ callId, reason }) { return this.#toPeer('hangup', { callId, reason }); }

  // Pre-pairing: we do not have a peer yet, the human typed the host + code.
  async claim(host, code, name) {
    return this.#request(String(host).trim(), 'pair', { body: { code, name } });
  }
}

module.exports = { CallClient, DEFAULT_PORT };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/call-client.test.js`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add core/call/call-client.js test/call-client.test.js
git commit -m "calls: outbound signaling client (CallClient)"
```

---

### Task 4: CallSignalServer — being talked to

**Files:**
- Create: `core/call/call-signal-server.js`
- Test: `test/call-signal-server.test.js`

**Interfaces:**
- Consumes: `pickBindAddress` from `core/mobile-server.js`; `CallAuth` (`verify`, `claimPairing`); `CallSession` (`incomingOffer`, `peerAnswered`, `end`, `status`); `config.getSettings()` for `callPort`; `ourName()` → display name string.
- Produces: `class CallSignalServer` with `start() → {ok, address?, port?|reason}`, `stop()`, `status() → {running, address, port, reason}`; incoming signals surface through `onSignal(type, data)` — types `incoming {callId, kind, sdp, autoAnswerAt}`, `answered {callId, sdp}`, `ice {callId, candidate}`, `ended {callId, reason}`, `paired {peer}`.

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CallSignalServer } = require('../core/call/call-signal-server');
const { CallAuth } = require('../core/call/call-auth');
const { CallSession } = require('../core/call/call-session');

// Real HTTP against loopback: the server also binds 127.0.0.1 (mobile-server
// precedent), so tests exercise the actual request path with fetch.
function build({ autoAnswer = false } = {}) {
  const signals = [];
  const auth = new CallAuth();
  const session = new CallSession({ autoAnswer });
  const server = new CallSignalServer({
    config: { getSettings: () => ({ callPort: 0 }) },   // 0 = ephemeral port for tests
    auth, session, ourName: () => 'TEST RIG',
    onSignal: (type, data) => signals.push({ type, ...data }),
    bindAddress: () => '127.0.0.1'                      // test override: no Tailscale on CI
  });
  return { server, auth, session, signals };
}

async function api(port, path, { method = 'POST', body, secret } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (secret) headers.Authorization = `Bearer ${secret}`;
  const res = await fetch(`http://127.0.0.1:${port}/call/${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

test('refuses to start without a Tailscale address', async () => {
  const { server } = build();
  server.bindAddress = () => null;
  const started = await server.start();
  assert.equal(started.ok, false);
  assert.match(started.reason, /Tailscale/);
});

test('pair claim → secret back, peer stored, paired signal; auth then works', async () => {
  const { server, auth, signals } = build();
  const { port } = await server.start();
  const { code } = auth.startPairing();
  const claim = await api(port, 'pair', { body: { code, name: 'JR' } });
  assert.equal(claim.status, 200);
  assert.ok(claim.data.secret);
  assert.equal(claim.data.name, 'TEST RIG');
  assert.equal(signals.at(-1).type, 'paired');
  const ping = await api(port, 'ping', { method: 'GET', secret: claim.data.secret });
  assert.equal(ping.status, 200);
  assert.equal(ping.data.name, 'TEST RIG');
  assert.equal(ping.data.state, 'idle');
  server.stop();
});

test('wrong secret is 403 on every authed endpoint; wrong code is 403 on pair', async () => {
  const { server, auth } = build();
  const { port } = await server.start();
  auth.startPairing();
  assert.equal((await api(port, 'pair', { body: { code: '000000', name: 'x' } })).status, 403);
  assert.equal((await api(port, 'ping', { method: 'GET', secret: 'bad' })).status, 403);
  assert.equal((await api(port, 'offer', { body: {}, secret: 'bad' })).status, 403);
  server.stop();
});

test('offer rings the session and surfaces the SDP; second offer is busy', async () => {
  const { server, auth, session, signals } = build();
  const { port } = await server.start();
  const { code } = auth.startPairing();
  const { data } = await api(port, 'pair', { body: { code, name: 'JR' } });
  const offer = await api(port, 'offer', { body: { callId: 'c1', kind: 'call', sdp: 'v=0' }, secret: data.secret });
  assert.equal(offer.status, 200);
  assert.equal(session.status().state, 'ringing-in');
  const ring = signals.find((s) => s.type === 'incoming');
  assert.equal(ring.sdp, 'v=0');
  const second = await api(port, 'offer', { body: { callId: 'c2', kind: 'call', sdp: 'v=0' }, secret: data.secret });
  assert.equal(second.status, 409);
  assert.equal(second.data.reason, 'busy');
  session.end('hangup');
  server.stop();
});

test('answer, ice and hangup route through to session + signals', async () => {
  const { server, auth, session, signals } = build();
  const { port } = await server.start();
  const { code } = auth.startPairing();
  const { data } = await api(port, 'pair', { body: { code, name: 'JR' } });
  const { callId } = session.dial();
  await api(port, 'answer', { body: { callId, sdp: 'v=answer' }, secret: data.secret });
  assert.equal(session.status().state, 'connecting');
  assert.equal(signals.find((s) => s.type === 'answered').sdp, 'v=answer');
  await api(port, 'ice', { body: { callId, candidate: { candidate: 'cand' } }, secret: data.secret });
  assert.equal(signals.find((s) => s.type === 'ice').candidate.candidate, 'cand');
  await api(port, 'hangup', { body: { callId, reason: 'hangup' }, secret: data.secret });
  assert.equal(session.status().state, 'idle');
  server.stop();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/call-signal-server.test.js`
Expected: FAIL — `Cannot find module '../core/call/call-signal-server'`

- [ ] **Step 3: Write the implementation**

```js
// The inbound half of signaling: five endpoints on the Tailscale line, in
// the mobile-server.js mold. Binds ONLY the Tailscale interface plus
// loopback, refuses to start without one, and answers nothing but the
// pairing claim until a peer is stored. No SSE here — the renderer lives in
// the same app and hears everything over IPC via onSignal.
'use strict';
const http = require('node:http');
const { pickBindAddress } = require('../mobile-server');

const DEFAULT_PORT = 27184;

async function readBody(req, limit = 256 * 1024) {   // SDP + ICE are small; nothing here is a file
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Body too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

class CallSignalServer {
  constructor({ config, auth, session, ourName = () => 'JARVIS', onSignal = () => {}, bindAddress = pickBindAddress } = {}) {
    this.config = config; this.auth = auth; this.session = session;
    this.ourName = ourName; this.onSignal = onSignal; this.bindAddress = bindAddress;
    this.server = null; this.loopback = null;
    this.address = null; this.port = null; this.reason = '';
  }

  json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }

  async handleRequest(req, res) {
    try {
      const ip = req.socket?.remoteAddress || '';
      const pathname = String(req.url || '/').split('?')[0];
      if (pathname === '/call/pair' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)).toString() || '{}');
        const claimed = this.auth.claimPairing(body.code, body.name, ip);
        if (!claimed) return this.json(res, 403, { reason: 'Pairing code is wrong or expired. Start pairing again in Settings.' });
        this.onSignal('paired', { peer: { name: claimed.peer.name, host: claimed.peer.host } });
        return this.json(res, 200, { secret: claimed.secret, name: this.ourName() });
      }
      if (!pathname.startsWith('/call/')) return this.json(res, 404, { reason: 'Unknown endpoint.' });
      const peer = this.auth.verify(req.headers.authorization, ip);
      if (!peer) return this.json(res, 403, { reason: 'Not paired.' });

      if (pathname === '/call/ping' && req.method === 'GET') {
        return this.json(res, 200, { name: this.ourName(), state: this.session.status().state });
      }
      const body = req.method === 'POST' ? JSON.parse((await readBody(req)).toString() || '{}') : {};
      if (pathname === '/call/offer' && req.method === 'POST') {
        const callId = String(body.callId || '');
        const kind = body.kind === 'control' ? 'control' : 'call';
        const rang = this.session.incomingOffer(callId);
        if (!rang.ok) return this.json(res, 409, { reason: rang.reason });
        this.onSignal('incoming', { callId, kind, sdp: String(body.sdp || ''), autoAnswerAt: rang.autoAnswerAt });
        return this.json(res, 200, { ok: true, autoAnswerAt: rang.autoAnswerAt });
      }
      if (pathname === '/call/answer' && req.method === 'POST') {
        this.session.peerAnswered(body.callId);
        this.onSignal('answered', { callId: String(body.callId || ''), sdp: String(body.sdp || '') });
        return this.json(res, 200, { ok: true });
      }
      if (pathname === '/call/ice' && req.method === 'POST') {
        this.onSignal('ice', { callId: String(body.callId || ''), candidate: body.candidate || null });
        return this.json(res, 200, { ok: true });
      }
      if (pathname === '/call/hangup' && req.method === 'POST') {
        this.session.end(String(body.reason || 'hangup'));
        return this.json(res, 200, { ok: true });
      }
      return this.json(res, 404, { reason: 'Unknown endpoint.' });
    } catch (error) {
      return this.json(res, 500, { reason: 'That request went sideways. Try again.' });
    }
  }

  async start() {
    const settings = this.config.getSettings();
    const address = this.bindAddress();
    if (!address) { this.reason = 'Tailscale is not running on this PC. Start Tailscale, then try again.'; return { ok: false, reason: this.reason }; }
    const port = Number.isFinite(Number(settings.callPort)) ? Number(settings.callPort) : DEFAULT_PORT;
    const handler = (req, res) => this.handleRequest(req, res);
    return new Promise((resolve) => {
      this.server = http.createServer(handler);
      this.server.on('error', (error) => { this.reason = `Could not start on port ${port}: ${error.message}`; this.server = null; resolve({ ok: false, reason: this.reason }); });
      this.server.listen(port, address, () => {
        const bound = this.server.address().port;      // resolves port 0 in tests
        if (address !== '127.0.0.1') {
          this.loopback = http.createServer(handler);
          this.loopback.on('error', () => { this.loopback = null; });
          this.loopback.listen(bound, '127.0.0.1', () => {});
        }
        this.address = address; this.port = bound; this.reason = '';
        resolve({ ok: true, address, port: bound });
      });
    });
  }

  stop() {
    try { this.server?.close(); } catch {}
    try { this.loopback?.close(); } catch {}
    this.server = null; this.loopback = null; this.address = null;
  }

  status() { return { running: !!this.server, address: this.address, port: this.port, reason: this.reason }; }
}

module.exports = { CallSignalServer, DEFAULT_PORT };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/call-signal-server.test.js`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add core/call/call-signal-server.js test/call-signal-server.test.js
git commit -m "calls: Tailscale-bound signaling server (CallSignalServer)"
```

---

### Task 5: main.js + preload.js wiring

**Files:**
- Modify: `main.js` (requires block ~line 44, module lets ~line 107, secret helpers ~line 506, sync fn ~line 543, IPC handlers ~line 710, settings-change hook ~line 849, boot construction ~line 1423)
- Modify: `preload.js` (inside the `contextBridge.exposeInMainWorld('jarvis', {...})` object, after the `mobile` block ~line 102)
- Test: `test/ipc-contract.test.js` (add one wired-end-to-end test; the existing generic invoke↔handle tests cover the rest automatically)

**Interfaces:**
- Consumes: Tasks 1–4 exactly as exported; `config.getSecret/setSecret`, `config.getSettings`, `sendEverywhere` (existing main.js helpers).
- Produces: renderer API `window.jarvis.call.{status, pairStart, pairClaim, unpair, dial, answer, ice, hangup, ping}` (all invoke) and `window.jarvis.call.onEvent(callback)` receiving `{type, ...}` where type ∈ `incoming | answered | ice | ended | live | ring-timeout | missed | auto-answer | paired | server-status`.

- [ ] **Step 1: Add the wired-end-to-end contract test**

Append to `test/ipc-contract.test.js`:

```js
test('JR call channels are wired end to end', () => {
  for (const channel of ['call:status', 'call:pair-start', 'call:pair-claim', 'call:unpair',
    'call:dial', 'call:answer', 'call:ice', 'call:hangup', 'call:ping']) {
    assert.ok(preload.includes(`'${channel}'`), `preload.js is missing ${channel}`);
    assert.ok(handled.has(channel), `main.js is missing a handler for ${channel}`);
  }
});
```

Run: `node --test test/ipc-contract.test.js` — Expected: the new test FAILS (channels not present yet).

- [ ] **Step 2: main.js — requires, state, persistence, sync**

Next to the mobile requires (~line 44):

```js
const { CallAuth } = require('./core/call/call-auth');
const { CallSession } = require('./core/call/call-session');
const { CallClient } = require('./core/call/call-client');
const { CallSignalServer } = require('./core/call/call-signal-server');
```

Next to `let mobileAuth;` (~line 107):

```js
let callAuth;
let callSession;
let callClient;
let callServer;
```

Next to the mobileDevices helpers (~line 506):

```js
function loadCallPeer() {
  try { return JSON.parse(config.getSecret('callPeer') || 'null'); } catch { return null; }
}
function saveCallPeer() { config.setSecret('callPeer', JSON.stringify(callAuth.toJSON())); }
```

Next to `syncMobileServer` (~line 543):

```js
async function syncCallServer() {
  const settings = config.getSettings();
  callServer.stop();
  if (settings.callEnabled) await callServer.start();
  sendEverywhere('call:event', { type: 'server-status', ...callServer.status() });
}
```

- [ ] **Step 3: main.js — boot construction (next to the mobileServer block, ~line 1423)**

```js
  callAuth = new CallAuth({ peer: loadCallPeer() });
  // autoAnswer stays false on this branch: JARVIS never answers by itself.
  // The JR branch constructs this with its parent-controlled setting.
  callSession = new CallSession({
    autoAnswer: false,
    onEvent: (type, data) => {
      // A locally-timed ending the peer can't know about yet (gave up
      // ringing, drop-grace expired) must also be told to the other side.
      if (type === 'ring-timeout' || (type === 'ended' && data.reason === 'dropped')) {
        callClient.hangup({ callId: data.callId, reason: type === 'ring-timeout' ? 'no-answer' : 'dropped' }).catch(() => {});
      }
      sendEverywhere('call:event', { type, ...data });
    }
  });
  callClient = new CallClient({
    getPeer: () => {
      const peer = callAuth.peer;
      return peer ? { host: peer.host, secret: peer.secret } : null;
    },
    port: Number(config.getSettings().callPort) || 27184
  });
  callServer = new CallSignalServer({
    config, auth: callAuth, session: callSession,
    ourName: () => 'JARVIS',
    onSignal: (type, data) => {
      if (type === 'paired') saveCallPeer();
      sendEverywhere('call:event', { type, ...data });
    }
  });
  if (config.getSettings().callEnabled) syncCallServer();
```

- [ ] **Step 4: main.js — IPC handlers (next to the mobile handlers, ~line 710)**

```js
  ipcMain.handle('call:status', () => ({
    server: callServer.status(),
    session: callSession.status(),
    paired: !!callAuth.peer,
    peerName: callAuth.peer?.name || null
  }));
  ipcMain.handle('call:pair-start', () => {
    const status = callServer.status();
    if (!status.running) return { ok: false, reason: status.reason || 'Turn calls on first.' };
    const { code, expiresAt } = callAuth.startPairing();
    return { ok: true, code, expiresAt, address: status.address, port: status.port };
  });
  ipcMain.handle('call:pair-claim', async (_event, { host, code }) => {
    const result = await callClient.claim(host, code, 'JARVIS');
    if (!result.ok) return result;
    callAuth.adoptPeer({ name: result.name, host, secret: result.secret });
    saveCallPeer();
    return { ok: true, peerName: result.name };
  });
  ipcMain.handle('call:unpair', () => { callAuth.unpair(); saveCallPeer(); return { ok: true }; });
  ipcMain.handle('call:ping', () => callClient.ping());
  ipcMain.handle('call:dial', async (_event, { sdp }) => {
    const dialed = callSession.dial();
    if (!dialed.ok) return dialed;
    const sent = await callClient.offer({ callId: dialed.callId, kind: 'call', sdp });
    if (!sent.ok) { callSession.end('unreachable'); return sent; }
    return { ok: true, callId: dialed.callId };
  });
  ipcMain.handle('call:answer', async (_event, { callId, sdp }) => {
    callSession.localAnswered(callId);
    return callClient.answer({ callId, sdp });
  });
  ipcMain.handle('call:ice', (_event, { callId, candidate }) => callClient.ice({ callId, candidate }));
  ipcMain.handle('call:hangup', async (_event, { callId, reason }) => {
    callSession.end(reason || 'hangup');
    return callClient.hangup({ callId, reason: reason || 'hangup' });
  });
```

- [ ] **Step 5: main.js — react to settings changes (~line 849, next to the mobile line)**

```js
    if (previous.callEnabled !== updated.callEnabled || previous.callPort !== updated.callPort) syncCallServer();
```

- [ ] **Step 6: preload.js — the renderer API (after the `mobile` block)**

```js
  call: {
    status: () => ipcRenderer.invoke('call:status'),
    pairStart: () => ipcRenderer.invoke('call:pair-start'),
    pairClaim: (host, code) => ipcRenderer.invoke('call:pair-claim', { host, code }),
    unpair: () => ipcRenderer.invoke('call:unpair'),
    ping: () => ipcRenderer.invoke('call:ping'),
    dial: (sdp) => ipcRenderer.invoke('call:dial', { sdp }),
    answer: (callId, sdp) => ipcRenderer.invoke('call:answer', { callId, sdp }),
    ice: (callId, candidate) => ipcRenderer.invoke('call:ice', { callId, candidate }),
    hangup: (callId, reason) => ipcRenderer.invoke('call:hangup', { callId, reason }),
    onEvent: (callback) => on('call:event', callback)
  },
```

(`on` is preload.js's existing subscribe helper — same one the `mobile.onStatus` line uses.)

- [ ] **Step 7: Run the contract test and the full suite**

Run: `node --test test/ipc-contract.test.js` — Expected: PASS including the new test.
Run: `npm test` — Expected: full suite green.

- [ ] **Step 8: Commit**

```bash
git add main.js preload.js test/ipc-contract.test.js
git commit -m "calls: main-process wiring + renderer IPC surface"
```

---

### Task 6: Settings → CALLS tab

**Files:**
- Modify: `src/settings-tabs.js` (TABS array)
- Modify: `src/index.html` (settings sections + script tag)
- Create: `src/call-settings.js` (self-contained IIFE like `cameras-ui.js`)
- Test: `test/settings-tabs.test.js` if it asserts the tab list (check first: `grep -n "phone" test/settings-tabs.test.js` — if it enumerates TABS, add `calls`)

**Interfaces:**
- Consumes: `window.jarvis.call` from Task 5; `window.SettingsTabs` pattern.
- Produces: DOM ids used by this task only: `call-enabled`, `call-pair-start`, `call-pair-code`, `call-claim-host`, `call-claim-code`, `call-claim-go`, `call-unpair`, `call-settings-status`.

- [ ] **Step 1: Add the tab**

In `src/settings-tabs.js`, insert into `TABS` after the `phone` entry:

```js
    { id: 'calls', label: 'CALLS' },
```

Run `npm test`; if `settings-tabs.test.js` pins the tab list, update its expectation in the same edit.

- [ ] **Step 2: Add the settings markup**

In `src/index.html`, find the PHONE settings section (`grep -n 'data-tab="phone"' src/index.html`) and add a sibling section after it:

```html
<section class="settings-section" data-tab="calls">
  <h3>FAMILY CALLS</h3>
  <label class="settings-row">
    <input type="checkbox" id="call-enabled" data-setting="callEnabled">
    Answer calls on this PC (needs Tailscale)
  </label>
  <div class="settings-row">
    <button id="call-pair-start" type="button">PAIR — SHOW A CODE</button>
    <span id="call-pair-code" class="settings-hint"></span>
  </div>
  <div class="settings-row">
    <input id="call-claim-host" type="text" placeholder="Other PC's Tailscale address">
    <input id="call-claim-code" type="text" placeholder="6-digit code" maxlength="6">
    <button id="call-claim-go" type="button">PAIR WITH THAT PC</button>
  </div>
  <div class="settings-row">
    <button id="call-unpair" type="button">FORGET THE OTHER PC</button>
    <span id="call-settings-status" class="settings-hint"></span>
  </div>
</section>
```

Match the class names actually used by the sibling PHONE section — if it uses different row/hint classes, copy those instead of the ones above.

- [ ] **Step 3: Write `src/call-settings.js`**

```js
// Settings → CALLS: turning the line on, and the one-time pairing dance.
// Both halves live here — show-a-code (this PC is the parent side) and
// type-the-code (this PC pairs to the one showing it).
(() => {
  const enabled = document.getElementById('call-enabled');
  const pairStart = document.getElementById('call-pair-start');
  const pairCode = document.getElementById('call-pair-code');
  const claimHost = document.getElementById('call-claim-host');
  const claimCode = document.getElementById('call-claim-code');
  const claimGo = document.getElementById('call-claim-go');
  const unpair = document.getElementById('call-unpair');
  const status = document.getElementById('call-settings-status');
  if (!pairStart || !window.jarvis?.call) return;

  async function refresh() {
    const s = await window.jarvis.call.status();
    if (!s.server.running) status.textContent = s.server.reason || 'Calls are off.';
    else if (s.paired) status.textContent = `Paired with ${s.peerName}.`;
    else status.textContent = 'On, waiting to be paired.';
  }

  pairStart.addEventListener('click', async () => {
    const result = await window.jarvis.call.pairStart();
    pairCode.textContent = result.ok
      ? `Code ${result.code} — type it on the other PC within 2 minutes. This PC is ${result.address}.`
      : result.reason;
  });

  claimGo.addEventListener('click', async () => {
    status.textContent = 'Pairing…';
    const result = await window.jarvis.call.pairClaim(claimHost.value, claimCode.value);
    status.textContent = result.ok ? `Paired with ${result.peerName}.` : result.reason;
    if (result.ok) { claimHost.value = ''; claimCode.value = ''; }
  });

  unpair.addEventListener('click', async () => {
    await window.jarvis.call.unpair();
    pairCode.textContent = '';
    refresh();
  });

  window.jarvis.call.onEvent((event) => {
    if (event.type === 'paired' || event.type === 'server-status') refresh();
  });
  if (enabled) enabled.addEventListener('change', () => setTimeout(refresh, 300));
  refresh();
})();
```

Add `<script src="call-settings.js"></script>` in `src/index.html` next to the existing `cameras-ui.js` script tag. Note: the `data-setting="callEnabled"` checkbox rides the settings dialog's existing generic persistence — verify with `grep -n "data-setting" src/renderer.js` that the dialog auto-saves tagged inputs; if it instead uses an explicit field list, add `callEnabled` (boolean) and `callPort` (number, default 27184) to that list.

- [ ] **Step 4: Run the suite and smoke the tab**

Run: `npm test` — Expected: green.
Run: `npm start` → Settings → CALLS renders, toggle + buttons present, status line reports "Calls are off." (Tailscale assertions come in the live test.)

- [ ] **Step 5: Commit**

```bash
git add src/settings-tabs.js src/index.html src/call-settings.js
git commit -m "calls: Settings CALLS tab — enable toggle + both pairing halves"
```

---

### Task 7: The dad-side call UI

**Files:**
- Create: `src/call-ui.js`
- Modify: `src/index.html` (JR panel markup in the cameras module + call overlay + script tag)
- Modify: `src/command-center.css` or `src/styles.css` (whichever holds the cameras module styles — check `grep -n "camera-grid" src/*.css`)

**Interfaces:**
- Consumes: `window.jarvis.call` (Task 5). WebRTC + `getUserMedia` are Chromium built-ins.
- Produces: user-visible feature; no exports.

- [ ] **Step 1: Markup**

In `src/index.html`, inside the cameras module (sibling of `#camera-grid`), add:

```html
<div id="jr-panel" hidden>
  <span id="jr-presence" class="jr-presence-dot"></span>
  <span id="jr-presence-label">Checking…</span>
  <button id="jr-call-button" type="button">📞 CALL JR</button>
</div>

<div id="call-overlay" hidden>
  <div id="call-ring" hidden>
    <p id="call-ring-label">JR is calling</p>
    <button id="call-answer" type="button">ANSWER</button>
    <button id="call-decline" type="button">DECLINE</button>
  </div>
  <div id="call-stage" hidden>
    <video id="call-remote" autoplay playsinline></video>
    <video id="call-local" autoplay playsinline muted></video>
    <div id="call-controls">
      <span id="call-timer">0:00</span>
      <button id="call-mute" type="button">MUTE</button>
      <button id="call-end" type="button">END</button>
    </div>
  </div>
  <p id="call-status-line"></p>
</div>
```

- [ ] **Step 2: Write `src/call-ui.js`**

```js
// The dad-side call surface: presence, dialing, ringing, and the live call.
// WebRTC does the heavy lifting; this file's job is honest state on screen
// and cleaning up EVERY track on the way out — the camera light going off
// when the call ends is a feature people actually check.
(() => {
  const panel = document.getElementById('jr-panel');
  const presenceDot = document.getElementById('jr-presence');
  const presenceLabel = document.getElementById('jr-presence-label');
  const callButton = document.getElementById('jr-call-button');
  const overlay = document.getElementById('call-overlay');
  const ring = document.getElementById('call-ring');
  const ringLabel = document.getElementById('call-ring-label');
  const stage = document.getElementById('call-stage');
  const remoteVideo = document.getElementById('call-remote');
  const localVideo = document.getElementById('call-local');
  const timerLabel = document.getElementById('call-timer');
  const statusLine = document.getElementById('call-status-line');
  if (!panel || !window.jarvis?.call) return;

  let pc = null;              // RTCPeerConnection
  let localStream = null;
  let currentCallId = null;
  let pendingOffer = null;    // {callId, sdp} while ringing-in
  let timerHandle = null;
  let startedAt = 0;
  let ringOsc = null;

  // ---- presence -----------------------------------------------------------
  async function refreshPresence() {
    const status = await window.jarvis.call.status();
    if (!status.paired) { panel.hidden = true; return; }
    panel.hidden = false;
    const ping = await window.jarvis.call.ping();
    const online = ping.ok;
    presenceDot.classList.toggle('online', online);
    presenceLabel.textContent = online ? `${status.peerName} is online` : `${status.peerName} is offline`;
    callButton.disabled = !online;
  }
  setInterval(refreshPresence, 20000);
  refreshPresence();

  // ---- ring sound: two-tone via WebAudio, no asset needed -------------------
  function startRingSound() {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880; gain.gain.value = 0.06;
    osc.start();
    const wobble = setInterval(() => { osc.frequency.value = osc.frequency.value === 880 ? 660 : 880; }, 700);
    ringOsc = { ctx, osc, wobble };
  }
  function stopRingSound() {
    if (!ringOsc) return;
    clearInterval(ringOsc.wobble);
    try { ringOsc.osc.stop(); ringOsc.ctx.close(); } catch {}
    ringOsc = null;
  }

  // ---- webrtc ---------------------------------------------------------------
  async function buildPeer() {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    pc = new RTCPeerConnection({ iceServers: [] });   // Tailscale is the network; no STUN
    for (const track of localStream.getTracks()) pc.addTrack(track, localStream);
    pc.ontrack = (event) => { remoteVideo.srcObject = event.streams[0]; };
    pc.onicecandidate = (event) => {
      if (event.candidate) window.jarvis.call.ice(currentCallId, event.candidate.toJSON());
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') showLive();
      if (pc.connectionState === 'failed') endCall('dropped');
    };
  }

  function teardown() {
    stopRingSound();
    if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
    if (pc) { try { pc.close(); } catch {} pc = null; }
    if (localStream) { for (const track of localStream.getTracks()) track.stop(); localStream = null; }
    remoteVideo.srcObject = null; localVideo.srcObject = null;
    overlay.hidden = true; ring.hidden = true; stage.hidden = true;
    currentCallId = null; pendingOffer = null;
  }

  function showLive() {
    ring.hidden = true; stage.hidden = false; overlay.hidden = false;
    stopRingSound();
    if (!timerHandle) {
      startedAt = Date.now();
      timerHandle = setInterval(() => {
        const s = Math.floor((Date.now() - startedAt) / 1000);
        timerLabel.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      }, 1000);
    }
  }

  async function dial() {
    if (pc) return;
    statusLine.textContent = 'Calling…';
    overlay.hidden = false;
    try {
      await buildPeer();
    } catch {
      statusLine.textContent = 'No camera or microphone on this PC — plug one in and try again.';
      teardown(); overlay.hidden = false; return;
    }
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const result = await window.jarvis.call.dial(offer.sdp);
    if (!result.ok) { statusLine.textContent = result.reason; teardown(); return; }
    currentCallId = result.callId;
  }

  async function answerCall() {
    if (!pendingOffer) return;
    const { callId, sdp } = pendingOffer;
    currentCallId = callId;
    try {
      await buildPeer();
    } catch {
      await window.jarvis.call.hangup(callId, 'no-media');
      teardown(); return;
    }
    await pc.setRemoteDescription({ type: 'offer', sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await window.jarvis.call.answer(callId, answer.sdp);
  }

  function endCall(reason) {
    if (currentCallId) window.jarvis.call.hangup(currentCallId, reason || 'hangup');
    teardown();
  }

  // ---- buttons ---------------------------------------------------------------
  callButton.addEventListener('click', dial);
  document.getElementById('call-answer').addEventListener('click', answerCall);
  document.getElementById('call-decline').addEventListener('click', () => {
    if (pendingOffer) window.jarvis.call.hangup(pendingOffer.callId, 'declined');
    teardown();
  });
  document.getElementById('call-end').addEventListener('click', () => endCall('hangup'));
  document.getElementById('call-mute').addEventListener('click', (event) => {
    if (!localStream) return;
    const track = localStream.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    event.target.textContent = track.enabled ? 'MUTE' : 'UNMUTE';
  });

  // ---- events from main --------------------------------------------------------
  window.jarvis.call.onEvent(async (event) => {
    if (event.type === 'incoming') {
      pendingOffer = { callId: event.callId, sdp: event.sdp };
      const status = await window.jarvis.call.status();
      ringLabel.textContent = `${status.peerName || 'JR'} is calling`;
      overlay.hidden = false; ring.hidden = false; stage.hidden = true;
      statusLine.textContent = '';
      startRingSound();
    }
    if (event.type === 'answered' && pc) {
      await pc.setRemoteDescription({ type: 'answer', sdp: event.sdp });
    }
    if (event.type === 'ice' && pc && event.candidate) {
      try { await pc.addIceCandidate(event.candidate); } catch {}
    }
    if (event.type === 'ended' || event.type === 'missed') teardown();
    if (event.type === 'ring-timeout') { statusLine.textContent = 'No answer.'; teardown(); overlay.hidden = false; setTimeout(() => { overlay.hidden = true; }, 2500); }
    if (event.type === 'paired') refreshPresence();
  });
})();
```

Add `<script src="call-ui.js"></script>` next to the `cameras-ui.js` script tag.

- [ ] **Step 3: Styles**

In the stylesheet that owns the cameras module, add (adapt colors/z-index to the file's tokens):

```css
#jr-panel { display: flex; align-items: center; gap: 8px; padding: 8px 0; }
.jr-presence-dot { width: 10px; height: 10px; border-radius: 50%; background: #555; }
.jr-presence-dot.online { background: #3ad06a; }
#call-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.85); z-index: 4000;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; }
#call-remote { max-width: 90vw; max-height: 78vh; border-radius: 8px; }
#call-local { position: absolute; right: 24px; bottom: 96px; width: 180px; border-radius: 6px; }
#call-controls { display: flex; gap: 12px; align-items: center; }
```

- [ ] **Step 4: Run the suite, then a local smoke**

Run: `npm test` — Expected: green (this task adds no node-side code; the contract test still pins the channels).
Run: `npm start` → cameras module shows no JR panel while unpaired (hidden), Settings → CALLS works. Full two-PC behavior is the live test in the spec.

- [ ] **Step 5: Commit**

```bash
git add src/call-ui.js src/index.html src/*.css
git commit -m "calls: dad-side call UI — presence, dial, ring, live stage"
```

---

### Task 8: CHANGELOG + full-suite gate

**Files:**
- Modify: `CHANGELOG.md` (new entry at top, matching the file's existing form)

- [ ] **Step 1: Add the entry**

```markdown
## Unreleased
- FAMILY CALLS: JARVIS can now video-call JARVIS JR over Tailscale — pair once
  in Settings → CALLS, then Call JR from the cameras panel. No cloud, no
  accounts; the call never leaves the tailnet.
```

- [ ] **Step 2: Full suite**

Run: `npm test` — Expected: everything green (798 + the ~27 new tests).

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "calls: changelog entry for Phase 1"
```

---

## After this plan

1. **JR-side follow-up plan** (written next, executed in `apps/jarvis-jr-build` on `jarvis-jr-work` after this work merges in): Call Dad button, full-screen ring with auto-answer countdown, `callAutoAnswer` parent setting (default ON) fed into `CallSession`, camera coordination with RPS/lens-nap, kid-friendly copy.
2. **Live proof** per the spec's testing section — Adam, on the real PCs.
3. **Phase 2 (remote control)** gets its own spec-section-driven plan once Phase 1 is live-proven.
