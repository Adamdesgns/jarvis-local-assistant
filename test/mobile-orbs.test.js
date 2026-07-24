const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MobileServer } = require('../core/mobile-server');
const { MobileAuth } = require('../core/mobile-auth');

function fakeRes() {
  const res = { code: 0, headers: null, body: '', writeHead(c, h) { this.code = c; this.headers = h; }, end(b) { this.body = Buffer.isBuffer(b) ? b : String(b || ''); }, write(b) { this.body += b; } };
  return res;
}
function jsonReq(method, url, body, headers = {}) {
  const { Readable } = require('node:stream');
  const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
  Object.assign(req, { method, url, headers, socket: { remoteAddress: '100.1.1.1' } });
  return req;
}

function makeServer(overrides = {}) {
  const auth = new MobileAuth({ now: () => 0 });
  const server = new MobileServer({
    auth,
    router: { handle: async () => ({ response: 'ok', tasks: [] }) },
    transcribe: async () => '',
    config: { getSettings: () => ({ orbSkin: 'halation', orbColor: 'obsidian' }) },
    staticDir: __dirname,
    ...overrides
  });
  return { server, auth };
}

function pairedKey(server, auth) {
  return (async () => {
    const { code } = auth.startPairing();
    const pair = fakeRes();
    await server.handleRequest(jsonReq('POST', '/api/pair', { code, name: 'iPhone' }), pair);
    return JSON.parse(pair.body).key;
  })();
}

test('GET /orbs/<file>.js serves from orbsDir with a JavaScript content type', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-orbs-'));
  try {
    fs.writeFileSync(path.join(dir, 'plasma.js'), '// plasma skin', 'utf8');
    const { server } = makeServer({ orbsDir: dir });
    const res = fakeRes();
    await server.handleRequest(jsonReq('GET', '/orbs/plasma.js'), res);
    assert.equal(res.code, 200);
    assert.equal(res.headers['Content-Type'], 'text/javascript');
    assert.ok(String(res.body).includes('plasma skin'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('GET /orbs/ blocks path traversal out of orbsDir', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-orbs-'));
  try {
    fs.writeFileSync(path.join(dir, 'ok.js'), 'ok', 'utf8');
    const secret = path.join(dir, '..', `jarvis-secret-${path.basename(dir)}.txt`);
    fs.writeFileSync(secret, 'secret', 'utf8');
    try {
      const { server } = makeServer({ orbsDir: dir });
      for (const url of ['/orbs/../' + path.basename(secret), '/orbs/..%2F' + path.basename(secret), '/orbs/%2e%2e/' + path.basename(secret)]) {
        const res = fakeRes();
        await server.handleRequest(jsonReq('GET', url), res);
        assert.equal(res.code, 404, `expected 404 for ${url}`);
      }
    } finally {
      fs.rmSync(secret, { force: true });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('GET /orbs/ returns 404 when no orbsDir is configured', async () => {
  const { server } = makeServer();
  const res = fakeRes();
  await server.handleRequest(jsonReq('GET', '/orbs/plasma.js'), res);
  assert.equal(res.code, 404);
});

test('GET /api/orb-prefs requires auth and returns the desktop skin choice', async () => {
  const { server, auth } = makeServer();
  const denied = fakeRes();
  await server.handleRequest(jsonReq('GET', '/api/orb-prefs'), denied);
  assert.equal(denied.code, 401);

  const key = await pairedKey(server, auth);
  const ok = fakeRes();
  await server.handleRequest(jsonReq('GET', '/api/orb-prefs', null, { authorization: `Bearer ${key}` }), ok);
  assert.equal(ok.code, 200);
  assert.deepEqual(JSON.parse(ok.body), { orbSkin: 'halation', orbColor: 'obsidian' });
});

test('GET /api/orb-prefs falls back to defaults when settings are missing them', async () => {
  const { server, auth } = makeServer({ config: { getSettings: () => ({}) } });
  const key = await pairedKey(server, auth);
  const ok = fakeRes();
  await server.handleRequest(jsonReq('GET', '/api/orb-prefs', null, { authorization: `Bearer ${key}` }), ok);
  assert.deepEqual(JSON.parse(ok.body), { orbSkin: 'original', orbColor: 'gold' });
});
