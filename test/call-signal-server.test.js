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
