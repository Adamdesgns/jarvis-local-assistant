const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pickBindAddress, sseFrame, MobileServer } = require('../core/mobile-server');
const { MobileAuth } = require('../core/mobile-auth');
const { DocumentService } = require('../core/document-service');

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
  // end() preserves a Buffer as-is (rather than String()-coercing it) so
  // binary responses (e.g. raw JPEG bytes) can be asserted on exactly.
  // JSON.parse(buffer) and buffer.includes(str) both still work as expected
  // via Buffer's implicit toString(), so this is backward compatible with
  // every existing string-body assertion above.
  const res = { code: 0, headers: null, body: '', writeHead(c, h) { this.code = c; this.headers = h; }, end(b) { this.body = Buffer.isBuffer(b) ? b : String(b || ''); }, write(b) { this.body += b; } };
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

function binReq(method, url, buffer, headers = {}) {
  const { Readable } = require('node:stream');
  const req = Readable.from(buffer ? [buffer] : []);
  Object.assign(req, { method, url, headers, socket: { remoteAddress: '100.1.1.1' } });
  return req;
}

async function pairedServer(extra = {}) {
  const auth = new MobileAuth({ now: () => 0 });
  const { code } = auth.startPairing();
  const server = new MobileServer({
    auth,
    router: { handle: async () => ({ response: 'Aye.' }) },
    transcribe: async () => 'unused',
    config: { getSettings: () => ({}) },
    staticDir: __dirname,
    ...extra
  });
  const pair = fakeRes();
  await server.handleRequest(jsonReq('POST', '/api/pair', { code, name: 'iPhone' }), pair);
  const { key } = JSON.parse(pair.body);
  return { server, key };
}

test('GET /api/folders returns the approved roots and requires auth', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-upload-folders-'));
  try {
    const documents = new DocumentService({ config: { getSettings: () => ({ searchRoots: [dir], projects: {} }) }, shell: {}, emit: () => {} });
    const { server, key } = await pairedServer({ documents });

    const denied = fakeRes();
    await server.handleRequest(jsonReq('GET', '/api/folders', null, {}), denied);
    assert.equal(denied.code, 401);

    const ok = fakeRes();
    await server.handleRequest(jsonReq('GET', '/api/folders', null, { authorization: `Bearer ${key}` }), ok);
    assert.equal(ok.code, 200);
    assert.deepEqual(JSON.parse(ok.body).folders, [dir]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/upload: happy path writes the raw bytes into the approved destination and requires auth', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-upload-happy-'));
  try {
    const documents = new DocumentService({ config: { getSettings: () => ({ searchRoots: [dir], projects: {} }) }, shell: {}, emit: () => {} });
    const { server, key } = await pairedServer({ documents });
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02, 0x03]);

    const denied = fakeRes();
    await server.handleRequest(binReq('POST', '/api/upload', bytes, { 'x-filename': 'photo.png', 'x-destination': dir }), denied);
    assert.equal(denied.code, 401);

    const ok = fakeRes();
    await server.handleRequest(binReq('POST', '/api/upload', bytes, {
      authorization: `Bearer ${key}`, 'x-filename': 'photo.png', 'x-destination': dir
    }), ok);
    assert.equal(ok.code, 200);
    const parsed = JSON.parse(ok.body);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.path, path.join(dir, 'photo.png'));
    assert.ok(fs.readFileSync(parsed.path).equals(bytes));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/upload: missing or blank X-Filename / X-Destination is rejected with a clear error and no write', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-upload-missing-'));
  try {
    const documents = new DocumentService({ config: { getSettings: () => ({ searchRoots: [dir], projects: {} }) }, shell: {}, emit: () => {} });
    const { server, key } = await pairedServer({ documents });
    const bytes = Buffer.from('hello');

    const noName = fakeRes();
    await server.handleRequest(binReq('POST', '/api/upload', bytes, { authorization: `Bearer ${key}`, 'x-destination': dir }), noName);
    assert.equal(JSON.parse(noName.body).ok, false);
    assert.ok(JSON.parse(noName.body).error);

    const blankName = fakeRes();
    await server.handleRequest(binReq('POST', '/api/upload', bytes, { authorization: `Bearer ${key}`, 'x-filename': '   ', 'x-destination': dir }), blankName);
    assert.equal(JSON.parse(blankName.body).ok, false);

    const noDest = fakeRes();
    await server.handleRequest(binReq('POST', '/api/upload', bytes, { authorization: `Bearer ${key}`, 'x-filename': 'a.txt' }), noDest);
    assert.equal(JSON.parse(noDest.body).ok, false);
    assert.ok(JSON.parse(noDest.body).error);

    const blankDest = fakeRes();
    await server.handleRequest(binReq('POST', '/api/upload', bytes, { authorization: `Bearer ${key}`, 'x-filename': 'a.txt', 'x-destination': '  ' }), blankDest);
    assert.equal(JSON.parse(blankDest.body).ok, false);

    assert.deepEqual(fs.readdirSync(dir), []); // nothing was ever written
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/upload: a destination outside approved roots is refused, including a traversal attempt', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-upload-outside-'));
  try {
    const documents = new DocumentService({ config: { getSettings: () => ({ searchRoots: [dir], projects: {} }) }, shell: {}, emit: () => {} });
    const { server, key } = await pairedServer({ documents });
    const bytes = Buffer.from('hello');

    // Flatly outside any approved root.
    const outside = fakeRes();
    await server.handleRequest(binReq('POST', '/api/upload', bytes, {
      authorization: `Bearer ${key}`, 'x-filename': 'evil.txt', 'x-destination': 'C:\\Windows\\System32'
    }), outside);
    assert.equal(JSON.parse(outside.body).ok, false);
    assert.ok(JSON.parse(outside.body).error);

    // Traversal out of an approved root back up into a disallowed path.
    const traversalDest = path.join(dir, '..', '..', 'Windows');
    const traversal = fakeRes();
    await server.handleRequest(binReq('POST', '/api/upload', bytes, {
      authorization: `Bearer ${key}`, 'x-filename': 'evil.txt', 'x-destination': traversalDest
    }), traversal);
    assert.equal(JSON.parse(traversal.body).ok, false);
    assert.ok(JSON.parse(traversal.body).error);

    assert.deepEqual(fs.readdirSync(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/upload: filename traversal attempts never escape the destination folder', async () => {
  // `dir` is nested two levels inside a sandbox we own (sandbox/nested/dest),
  // so that "../../evil.txt" — which climbs exactly two levels above `dir` —
  // resolves to a path INSIDE the sandbox we control and can safely assert
  // on and clean up, rather than probing a real, uncontrolled ancestor
  // directory (e.g. os.tmpdir()'s parent) that other processes may be using.
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-upload-namejail-sandbox-'));
  const dir = path.join(sandbox, 'nested', 'dest');
  fs.mkdirSync(dir, { recursive: true });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-upload-namejail-outside-'));
  try {
    const documents = new DocumentService({ config: { getSettings: () => ({ searchRoots: [dir], projects: {} }) }, shell: {}, emit: () => {} });
    const { server, key } = await pairedServer({ documents });
    const bytes = Buffer.from('payload');

    for (const evilName of ['../../evil.txt', '..\\..\\evil.txt']) {
      const res = fakeRes();
      await server.handleRequest(binReq('POST', '/api/upload', bytes, {
        authorization: `Bearer ${key}`, 'x-filename': evilName, 'x-destination': dir
      }), res);
      const parsed = JSON.parse(res.body);
      // Must land harmlessly inside the destination — asserted unconditionally,
      // not only when parsed.ok happens to be true (a conditional assertion
      // here would accept ANY rejection as a "pass", including one caused by
      // an unrelated bug that has nothing to do with traversal safety).
      assert.equal(parsed.ok, true, `filename "${evilName}" should be sanitized, not rejected: ${parsed.error}`);
      assert.equal(path.dirname(parsed.path), dir, `filename "${evilName}" must resolve inside the destination`);
    }
    // The decorative check here used to read the unrelated sibling `outside`
    // dir, which "../../evil.txt" never targets in the first place (it's not
    // on the escape path from `dir` at all, so that assertion always passed
    // regardless of whether traversal was actually blocked). Check the
    // directory the traversal string actually resolves to instead — safely,
    // since it's inside our own sandbox.
    const escapeTarget = path.join(dir, '..', '..', 'evil.txt');
    assert.equal(path.dirname(escapeTarget), sandbox, 'sanity check: the escape path must be the sandbox we control');
    assert.ok(!fs.existsSync(escapeTarget), 'traversal filename must not have escaped above the destination');
    assert.deepEqual(fs.readdirSync(outside), []);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('POST /api/upload: a body over the 25 MB cap is rejected cleanly, not a crash, and the default /api/chat cap stays 10 MB', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-upload-cap-'));
  try {
    const documents = new DocumentService({ config: { getSettings: () => ({ searchRoots: [dir], projects: {} }) }, shell: {}, emit: () => {} });
    const { server, key } = await pairedServer({ documents });

    function* chunks(count) {
      const chunk = Buffer.alloc(1024 * 1024, 'a'); // 1MB per chunk
      for (let i = 0; i < count; i++) yield chunk;
    }
    const { Readable } = require('node:stream');

    // 26MB > 25MB upload cap — must be a clean {ok:false} response, not a 500 crash.
    const overCap = Readable.from(chunks(26));
    Object.assign(overCap, {
      method: 'POST', url: '/api/upload',
      headers: { authorization: `Bearer ${key}`, 'x-filename': 'big.bin', 'x-destination': dir },
      socket: { remoteAddress: '100.1.1.1' }
    });
    const overRes = fakeRes();
    await server.handleRequest(overCap, overRes);
    assert.notEqual(overRes.code, 500);
    const parsedOver = JSON.parse(overRes.body);
    assert.equal(parsedOver.ok, false);
    assert.ok(parsedOver.error);
    assert.deepEqual(fs.readdirSync(dir), []); // rejected before any write

    // 12MB is within the raised 25MB upload cap and must succeed.
    const underCap = Readable.from(chunks(12));
    Object.assign(underCap, {
      method: 'POST', url: '/api/upload',
      headers: { authorization: `Bearer ${key}`, 'x-filename': 'ok.bin', 'x-destination': dir },
      socket: { remoteAddress: '100.1.1.1' }
    });
    const underRes = fakeRes();
    await server.handleRequest(underCap, underRes);
    assert.equal(JSON.parse(underRes.body).ok, true);

    // The default body cap used by every other route (e.g. /api/chat) must remain 10MB, unchanged.
    const stillOverChat = Readable.from(chunks(11));
    Object.assign(stillOverChat, {
      method: 'POST', url: '/api/chat',
      headers: { authorization: `Bearer ${key}` },
      socket: { remoteAddress: '100.1.1.1' }
    });
    const chatRes = fakeRes();
    await server.handleRequest(stillOverChat, chatRes);
    assert.equal(chatRes.code, 500); // existing behavior: oversized non-upload body still surfaces as a 500 {error}
    // Assert on the actual error text, not just the status code. If the
    // default 10MB cap in readBody() were silently raised (e.g. to 200MB),
    // this 11MB body of "aaaa…" would sail past readBody and reach
    // JSON.parse() instead, which throws its OWN SyntaxError — also
    // reported as a 500 {error} — so a bare `code === 500` check can't tell
    // "the cap fired" apart from "the cap is gone and something else broke".
    assert.match(JSON.parse(chatRes.body).error, /too large/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The next two tests use a mocked `documents` collaborator instead of a real
// DocumentService. This is deliberate: after the createBinaryFile fix,
// #upload's own isAllowed() gate (mobile-server.js) and createBinaryFile's
// isAllowed() gate (document-service.js) both run the exact same check on
// the exact same string, so a black-box test against the real DocumentService
// cannot tell the two guards apart — removing either one alone is invisible
// from the outside. Mocking `documents` isolates #upload's gate specifically:
// it proves the request is refused, and createBinaryFile is never even
// reached, purely on the strength of #upload's own check.
test('POST /api/upload: #upload refuses before ever calling createBinaryFile when documents.isAllowed() says no', async () => {
  const calls = [];
  const documents = {
    isAllowed: (dest) => { calls.push(['isAllowed', dest]); return false; },
    createBinaryFile: async (...args) => { calls.push(['createBinaryFile', ...args]); return { path: 'should-not-happen' }; }
  };
  const { server, key } = await pairedServer({ documents });
  const bytes = Buffer.from('hello');

  const res = fakeRes();
  await server.handleRequest(binReq('POST', '/api/upload', bytes, {
    authorization: `Bearer ${key}`, 'x-filename': 'a.txt', 'x-destination': 'C:\\anywhere'
  }), res);

  assert.equal(res.code, 400);
  assert.equal(JSON.parse(res.body).ok, false);
  assert.deepEqual(calls, [['isAllowed', 'C:\\anywhere']], 'createBinaryFile must never be reached once isAllowed() says no');
});

test('POST /api/upload: the "Missing destination" guard rejects before consulting isAllowed() or createBinaryFile at all', async () => {
  const calls = [];
  const documents = {
    // Both return "everything is fine" — if the explicit missing-destination
    // check were removed, execution would sail through to here and the
    // request would wrongly succeed.
    isAllowed: (dest) => { calls.push(['isAllowed', dest]); return true; },
    createBinaryFile: async (...args) => { calls.push(['createBinaryFile', ...args]); return { path: 'should-not-happen' }; }
  };
  const { server, key } = await pairedServer({ documents });
  const bytes = Buffer.from('hello');

  const res = fakeRes();
  await server.handleRequest(binReq('POST', '/api/upload', bytes, {
    authorization: `Bearer ${key}`, 'x-filename': 'a.txt' // no x-destination header at all
  }), res);

  assert.equal(res.code, 400);
  assert.equal(JSON.parse(res.body).ok, false);
  assert.match(JSON.parse(res.body).error, /destination/i);
  assert.deepEqual(calls, [], 'neither isAllowed() nor createBinaryFile() should ever be consulted for a missing destination');
});

// --- GET /api/cameras, GET /api/cameras/snapshot ---

test('GET /api/cameras requires auth and returns the injected fake cameras service list, trimmed to key+name', async () => {
  const fakeCameras = {
    listCameras: async () => [
      { key: 'blink:front', name: 'Front Door', accountId: 'blink', extra: 'should not leak' },
      { key: 'ring:back', name: 'Back Yard', accountId: 'ring' }
    ]
  };
  const { server, key } = await pairedServer({ getCameras: () => fakeCameras });

  const denied = fakeRes();
  await server.handleRequest(jsonReq('GET', '/api/cameras', null, {}), denied);
  assert.equal(denied.code, 401);

  const ok = fakeRes();
  await server.handleRequest(jsonReq('GET', '/api/cameras', null, { authorization: `Bearer ${key}` }), ok);
  assert.equal(ok.code, 200);
  assert.deepEqual(JSON.parse(ok.body), {
    cameras: [
      { key: 'blink:front', name: 'Front Door' },
      { key: 'ring:back', name: 'Back Yard' }
    ]
  });
});

test('GET /api/cameras: no camera service configured returns an empty array, not an error', async () => {
  const { server, key } = await pairedServer(); // no getCameras at all
  const ok = fakeRes();
  await server.handleRequest(jsonReq('GET', '/api/cameras', null, { authorization: `Bearer ${key}` }), ok);
  assert.equal(ok.code, 200);
  assert.deepEqual(JSON.parse(ok.body), { cameras: [] });
});

test('GET /api/cameras/snapshot requires auth, returns raw image/jpeg bytes with Cache-Control: no-store for a known base64 fixture', async () => {
  // A tiny fixture buffer standing in for JPEG bytes — the point is proving
  // exact byte-for-byte round-trip through base64 decode, not real JPEG data.
  const fixtureBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const fakeCameras = {
    getSnapshot: async (key, opts) => {
      assert.equal(key, 'blink:front');
      assert.deepEqual(opts, { manual: true });
      return { ok: true, jpegBase64: fixtureBytes.toString('base64') };
    }
  };
  const { server, key } = await pairedServer({ getCameras: () => fakeCameras });

  const denied = fakeRes();
  await server.handleRequest(jsonReq('GET', '/api/cameras/snapshot?key=blink:front', null, {}), denied);
  assert.equal(denied.code, 401);

  const ok = fakeRes();
  await server.handleRequest(jsonReq('GET', '/api/cameras/snapshot?key=blink:front', null, { authorization: `Bearer ${key}` }), ok);
  assert.equal(ok.code, 200);
  assert.equal(ok.headers['Content-Type'], 'image/jpeg');
  assert.equal(ok.headers['Cache-Control'], 'no-store');
  assert.ok(Buffer.isBuffer(ok.body), 'response body must be raw bytes, not a JSON/base64 string');
  assert.ok(ok.body.equals(fixtureBytes), 'decoded bytes must exactly match the fixture');
});

test('GET /api/cameras/snapshot: unknown key or failed snapshot returns a JSON error, not a 200 or a broken image', async () => {
  const fakeCameras = { getSnapshot: async () => ({ ok: false, message: 'That camera is no longer set up.' }) };
  const { server, key } = await pairedServer({ getCameras: () => fakeCameras });

  const res = fakeRes();
  await server.handleRequest(jsonReq('GET', '/api/cameras/snapshot?key=nope', null, { authorization: `Bearer ${key}` }), res);
  assert.notEqual(res.code, 200);
  assert.notEqual(res.headers?.['Content-Type'], 'image/jpeg');
  const parsed = JSON.parse(res.body);
  assert.ok(parsed.error);
});

test('GET /api/cameras/snapshot: no camera service configured returns a JSON error, not a 200', async () => {
  const { server, key } = await pairedServer(); // no getCameras at all
  const res = fakeRes();
  await server.handleRequest(jsonReq('GET', '/api/cameras/snapshot?key=blink:front', null, { authorization: `Bearer ${key}` }), res);
  assert.notEqual(res.code, 200);
  const parsed = JSON.parse(res.body);
  assert.ok(parsed.error);
});
