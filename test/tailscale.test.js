const { test } = require('node:test');
const assert = require('node:assert');
const { selfHttpsUrl, serveTargetsPort, Tailscale } = require('../core/tailscale');

// --- selfHttpsUrl: turn `tailscale status --json` into an https URL ---

test('selfHttpsUrl strips the trailing dot and builds an https URL', () => {
  const json = JSON.stringify({ Self: { DNSName: 'alienadam.taile7c34c.ts.net.' } });
  assert.equal(selfHttpsUrl(json), 'https://alienadam.taile7c34c.ts.net');
});

test('selfHttpsUrl accepts an already-parsed object', () => {
  assert.equal(selfHttpsUrl({ Self: { DNSName: 'pc.tail1.ts.net.' } }), 'https://pc.tail1.ts.net');
});

test('selfHttpsUrl returns null when there is no DNSName', () => {
  assert.equal(selfHttpsUrl({ Self: {} }), null);
  assert.equal(selfHttpsUrl({}), null);
});

test('selfHttpsUrl returns null for a bare label with no tailnet suffix', () => {
  // A hostname with no dots is not a usable MagicDNS name — fall back to HTTP.
  assert.equal(selfHttpsUrl({ Self: { DNSName: 'localhost.' } }), null);
  assert.equal(selfHttpsUrl({ Self: { DNSName: 'pc.' } }), null);
});

test('selfHttpsUrl returns null on malformed JSON instead of throwing', () => {
  assert.equal(selfHttpsUrl('not json{'), null);
});

// --- serveTargetsPort: is serve already forwarding to our loopback port? ---

test('serveTargetsPort finds a matching loopback proxy', () => {
  const json = JSON.stringify({
    Web: { 'pc.tail1.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:27183' } } } }
  });
  assert.equal(serveTargetsPort(json, 27183), true);
});

test('serveTargetsPort is false when the port does not match', () => {
  const json = JSON.stringify({
    Web: { 'pc.tail1.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:9999' } } } }
  });
  assert.equal(serveTargetsPort(json, 27183), false);
});

test('serveTargetsPort is false when nothing is served', () => {
  assert.equal(serveTargetsPort('{}', 27183), false);
  assert.equal(serveTargetsPort({ Web: {} }, 27183), false);
});

test('serveTargetsPort does not throw on malformed input', () => {
  assert.equal(serveTargetsPort('nope{', 27183), false);
  assert.equal(serveTargetsPort(null, 27183), false);
});

// --- Tailscale class with an injected runner (no real binary) ---

function fakeRunner(map) {
  // map: key = args.join(' ') → { code, stdout, stderr }. Records calls.
  const calls = [];
  const run = (args) => {
    calls.push(args);
    const hit = map[args.join(' ')];
    return Promise.resolve(hit || { code: 1, stdout: '', stderr: 'unknown command' });
  };
  return { run, calls };
}

test('detectHttpsUrl reads the URL from status --json', async () => {
  const { run } = fakeRunner({
    'status --json': { code: 0, stdout: JSON.stringify({ Self: { DNSName: 'pc.tail1.ts.net.' } }), stderr: '' }
  });
  const ts = new Tailscale({ run });
  assert.equal(await ts.detectHttpsUrl(), 'https://pc.tail1.ts.net');
});

test('detectHttpsUrl returns null when the CLI fails (not installed)', async () => {
  const { run } = fakeRunner({});   // every command → code 1
  const ts = new Tailscale({ run });
  assert.equal(await ts.detectHttpsUrl(), null);
});

test('startServe is a no-op when serve already targets the port', async () => {
  const { run, calls } = fakeRunner({
    'serve status --json': {
      code: 0,
      stdout: JSON.stringify({ Web: { 'pc:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:27183' } } } } }),
      stderr: ''
    }
  });
  const ts = new Tailscale({ run });
  const result = await ts.startServe(27183);
  assert.deepEqual(result, { ok: true });
  // Only the status check ran — no reconfiguring `serve --bg` call.
  assert.ok(!calls.some((args) => args.includes('--bg')));
});

test('startServe runs `serve --bg` when nothing is forwarding yet', async () => {
  const { run, calls } = fakeRunner({
    'serve status --json': { code: 0, stdout: '{}', stderr: '' },
    'serve --bg --https=443 http://127.0.0.1:27183': { code: 0, stdout: '', stderr: '' }
  });
  const ts = new Tailscale({ run });
  const result = await ts.startServe(27183);
  assert.deepEqual(result, { ok: true });
  assert.ok(calls.some((args) => args.join(' ') === 'serve --bg --https=443 http://127.0.0.1:27183'));
});

test('startServe surfaces the CLI error when serve fails', async () => {
  const { run } = fakeRunner({
    'serve status --json': { code: 0, stdout: '{}', stderr: '' },
    'serve --bg --https=443 http://127.0.0.1:27183': { code: 1, stdout: '', stderr: 'HTTPS is not enabled on this tailnet' }
  });
  const ts = new Tailscale({ run });
  const result = await ts.startServe(27183);
  assert.equal(result.ok, false);
  assert.match(result.reason, /HTTPS is not enabled/);
});

test('stopServe turns the https front off', async () => {
  const { run, calls } = fakeRunner({
    'serve --https=443 off': { code: 0, stdout: '', stderr: '' }
  });
  const ts = new Tailscale({ run });
  await ts.stopServe();
  assert.ok(calls.some((args) => args.join(' ') === 'serve --https=443 off'));
});
