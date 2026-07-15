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

const { BlinkClient } = require('../core/camera/blink-client');

function blinkFetch(routes) {
  const calls = [];
  const fetchFn = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', headers: options.headers || {}, body: options.body });
    for (const route of routes) {
      if (url.includes(route.match) && (!route.method || route.method === (options.method || 'GET'))) {
        return {
          ok: route.status ? route.status < 300 : true,
          status: route.status || 200,
          json: async () => route.json ?? {},
          arrayBuffer: async () => route.buffer ?? new ArrayBuffer(4),
          text: async () => JSON.stringify(route.json ?? {})
        };
      }
    }
    return { ok: false, status: 404, json: async () => ({ message: 'not found' }), text: async () => 'not found' };
  };
  return { fetchFn, calls };
}

test('blink client: login returns session and flags 2FA verification', async () => {
  const { fetchFn, calls } = blinkFetch([{
    match: '/api/v5/account/login', method: 'POST',
    json: { account: { account_id: 111, client_id: 222, tier: 'u011', client_verification_required: true }, auth: { token: 'tok123' } }
  }]);
  const client = new BlinkClient({ fetchFn });
  const session = await client.login({ email: 'a@b.c', password: 'pw', uniqueId: 'uid-1' });
  assert.deepEqual(session, { token: 'tok123', accountId: 111, clientId: 222, tier: 'u011', verificationRequired: true });
  const call = calls[0];
  assert.match(call.url, /^https:\/\/rest-prod\.immedia-semi\.com\/api\/v5\/account\/login$/);
  const body = JSON.parse(call.body);
  assert.equal(body.email, 'a@b.c');
  assert.equal(body.unique_id, 'uid-1');
  assert.equal(body.reauth, 'true');
});

test('blink client: authenticated calls hit the tier host with TOKEN-AUTH', async () => {
  const session = { token: 'tok123', accountId: 111, clientId: 222, tier: 'u011' };
  const { fetchFn, calls } = blinkFetch([
    { match: '/pin/verify', method: 'POST', json: { valid: true, message: 'ok' } },
    { match: '/homescreen', json: { networks: [], cameras: [] } },
    { match: '/state/arm', method: 'POST', json: {} },
    { match: '/media/production/', buffer: new ArrayBuffer(6) }
  ]);
  const client = new BlinkClient({ fetchFn });
  const pin = await client.verifyPin(session, '1234');
  assert.equal(pin.ok, true);
  await client.homescreen(session);
  await client.setArmed(session, 55, true);
  const image = await client.getImage(session, '/media/production/account/111/thumb');
  assert.ok(Buffer.isBuffer(image) && image.length === 6);
  for (const call of calls) {
    assert.match(call.url, /^https:\/\/rest-u011\.immedia-semi\.com/);
    assert.equal(call.headers['TOKEN-AUTH'], 'tok123');
  }
  assert.match(calls[0].url, /\/api\/v4\/account\/111\/client\/222\/pin\/verify$/);
  assert.match(calls[2].url, /\/api\/v1\/accounts\/111\/networks\/55\/state\/arm$/);
  assert.match(calls[3].url, /\/media\/production\/account\/111\/thumb\.jpg$/);
});

test('blink client: surfaces server error messages', async () => {
  const { fetchFn } = blinkFetch([{ match: '/api/v5/account/login', method: 'POST', status: 401, json: { message: 'Invalid credentials' } }]);
  const client = new BlinkClient({ fetchFn });
  await assert.rejects(() => client.login({ email: 'a@b.c', password: 'bad', uniqueId: 'u' }), /Invalid credentials/);
});
