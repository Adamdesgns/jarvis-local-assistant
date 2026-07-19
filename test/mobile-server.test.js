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

test('stop() severs live SSE connections', async () => {
  const auth = new MobileAuth({ now: () => 0 });
  const { code } = auth.startPairing();
  const server = new MobileServer({
    auth,
    router: { handle: async () => ({ response: 'Aye.' }) },
    transcribe: async () => 'unused', config: { getSettings: () => ({}) }, staticDir: __dirname
  });
  const pair = fakeRes();
  await server.handleRequest(jsonReq('POST', '/api/pair', { code, name: 'iPhone' }), pair);
  const { key } = JSON.parse(pair.body);

  const streamRes = fakeRes();
  streamRes.ended = false;
  const origEnd = streamRes.end.bind(streamRes);
  streamRes.end = (b) => { streamRes.ended = true; origEnd(b); };
  const streamReq = jsonReq('GET', '/api/events', null, { authorization: `Bearer ${key}` });
  streamReq.on = (event, fn) => {};
  await server.handleRequest(streamReq, streamRes);

  assert.equal(streamRes.ended, false);

  server.stop();

  assert.equal(streamRes.ended, true);

  const bodyBeforePush = streamRes.body;
  const device = auth.verify(`Bearer ${key}`, '100.1.1.1');
  server.pushEvent(device.id, 'reply', { reply: 'should not arrive' });
  assert.equal(streamRes.body, bodyBeforePush);
});

test('#chat: an approval-shaped router result becomes a desktop-confirmation reply and cancels the pending approval', async () => {
  const auth = new MobileAuth({ now: () => 0 });
  const { code } = auth.startPairing();
  const cancelled = [];
  const server = new MobileServer({
    auth,
    router: {
      handle: async () => ({
        id: 'r1', response: 'Confirm shutdown.', source: 'safety',
        approval: { id: 'approval-1', title: 'SHUTDOWN COMPUTER', detail: 'This will power off the PC.', risk: 'HIGH' }
      }),
      resolveApproval: async (id, approved) => { cancelled.push({ id, approved }); return { response: 'Command cancelled.' }; }
    },
    transcribe: async () => 'unused', config: { getSettings: () => ({}) }, staticDir: __dirname
  });
  const pair = fakeRes();
  await server.handleRequest(jsonReq('POST', '/api/pair', { code, name: 'iPhone' }), pair);
  const { key } = JSON.parse(pair.body);

  const res = fakeRes();
  await server.handleRequest(jsonReq('POST', '/api/chat', { text: 'shut down the computer' }, { authorization: `Bearer ${key}` }), res);
  assert.equal(JSON.parse(res.body).reply, 'Run that one at the desktop, sir.');
  assert.deepEqual(cancelled, [{ id: 'approval-1', approved: false }]);
});

test('static file serving never leaks content outside staticDir on traversal attempts', async () => {
  const auth = new MobileAuth({ now: () => 0 });
  const server = new MobileServer({
    auth, router: { handle: async () => ({ response: 'x' }) }, transcribe: async () => 'unused',
    config: { getSettings: () => ({}) }, staticDir: __dirname
  });
  for (const url of ['/..%2f..%2fpackage.json', '/../secrets', '//../package.json']) {
    const res = fakeRes();
    await server.handleRequest(jsonReq('GET', url, null, {}), res);
    assert.equal(res.code, 404);
    assert.ok(!res.body.includes('"name"'), `path ${url} leaked package.json content`);
  }
});

test('body cap: an oversized POST /api/chat body returns the JSON {error} 500 response, not a crash', async () => {
  const auth = new MobileAuth({ now: () => 0 });
  const { code } = auth.startPairing();
  const server = new MobileServer({
    auth, router: { handle: async () => ({ response: 'x' }) }, transcribe: async () => 'unused',
    config: { getSettings: () => ({}) }, staticDir: __dirname
  });
  const pair = fakeRes();
  await server.handleRequest(jsonReq('POST', '/api/pair', { code, name: 'iPhone' }), pair);
  const { key } = JSON.parse(pair.body);

  const { Readable } = require('node:stream');
  function* oversizedChunks() {
    const chunk = Buffer.alloc(1024 * 1024, 'a');   // 1MB per chunk
    for (let i = 0; i < 11; i++) yield chunk;        // 11MB > 10MB readBody limit
  }
  const req = Readable.from(oversizedChunks());
  Object.assign(req, { method: 'POST', url: '/api/chat', headers: { authorization: `Bearer ${key}` }, socket: { remoteAddress: '100.1.1.1' } });
  const res = fakeRes();
  await server.handleRequest(req, res);
  assert.equal(res.code, 500);
  assert.ok(JSON.parse(res.body).error);
});

test('/api/events accepts ?key= since EventSource cannot send headers; every other route still requires the header', async () => {
  const auth = new MobileAuth({ now: () => 0 });
  const { code } = auth.startPairing();
  const server = new MobileServer({
    auth,
    router: { handle: async () => ({ response: 'Aye.' }) },
    transcribe: async () => 'unused', config: { getSettings: () => ({}) }, staticDir: __dirname
  });
  const pair = fakeRes();
  await server.handleRequest(jsonReq('POST', '/api/pair', { code, name: 'iPhone' }), pair);
  const { key } = JSON.parse(pair.body);

  const streamRes = fakeRes();
  const streamReq = jsonReq('GET', `/api/events?key=${encodeURIComponent(key)}`, null, {});
  await server.handleRequest(streamReq, streamRes);
  assert.equal(streamRes.code, 200);
  assert.match(streamRes.headers['Content-Type'], /event-stream/);

  const deniedChat = fakeRes();
  await server.handleRequest(jsonReq('POST', `/api/chat?key=${encodeURIComponent(key)}`, { text: 'hi' }, {}), deniedChat);
  assert.equal(deniedChat.code, 401);

  const deniedLast = fakeRes();
  await server.handleRequest(jsonReq('GET', `/api/last?key=${encodeURIComponent(key)}`, null, {}), deniedLast);
  assert.equal(deniedLast.code, 401);

  // Extra param after key should still work
  const streamWithExtra = fakeRes();
  const streamReqExtra = jsonReq('GET', `/api/events?key=${encodeURIComponent(key)}&v=2`, null, {});
  await server.handleRequest(streamReqExtra, streamWithExtra);
  assert.equal(streamWithExtra.code, 200);
  assert.match(streamWithExtra.headers['Content-Type'], /event-stream/);

  // ?somekey= should NOT match and should 401
  const deniedSomekey = fakeRes();
  await server.handleRequest(jsonReq('GET', `/api/events?somekey=${encodeURIComponent(key)}`, null, {}), deniedSomekey);
  assert.equal(deniedSomekey.code, 401);
});
