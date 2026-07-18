const test = require('node:test');
const assert = require('node:assert/strict');
const { pickBindAddress, sseFrame, MobileServer } = require('../core/mobile-server');
const { MobileAuth } = require('../core/mobile-auth');

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
