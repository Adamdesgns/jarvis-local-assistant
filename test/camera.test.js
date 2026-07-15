const test = require('node:test');
const assert = require('node:assert/strict');
const { CameraDriver, NotSupportedError } = require('../core/camera/driver-interface');

test('base driver: contract shape and NotSupported defaults', async () => {
  const driver = new CameraDriver({ account: { id: 'a1', name: 'Test' }, secrets: {} });
  assert.equal(driver.brand, 'generic');
  assert.deepEqual(await driver.listCameras(), []);
  assert.deepEqual(await driver.listSystems(), []);
  assert.equal(typeof driver.persistSecrets, 'function');
  driver.persistSecrets({}); // default is a no-op, never a crash
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

test('camera service: blink account flow with PIN, systems, and arming', async () => {
  const config = fakeConfig();
  const logged = [];
  class TestBlinkDriver extends BlinkDriver {
    constructor(options) {
      super({
        ...options,
        clientFactory: () => fakeBlinkClient({
          login: async () => ({ token: 't1', accountId: 1, clientId: 2, tier: 'u1', verificationRequired: true })
        })
      });
      this.freshWaitMs = 0;
    }
  }
  const service = new CameraService({
    config, go2rtc: fakeGo2rtc(), emit: () => {}, log: { write: (entry) => logged.push(entry) },
    driverClasses: { blink: TestBlinkDriver }
  });
  await service.init();

  const added = await service.addBlinkAccount({ email: 'a@b.c', password: 'pw' });
  assert.equal(added.ok, true);
  assert.equal(added.needsPin, true);
  assert.ok(!JSON.stringify(config.getSettings()).includes('pw'), 'password only in secrets');

  const pinned = await service.submitBlinkPin(added.accountId, '4321');
  assert.equal(pinned.ok, true);

  const cameras = await service.listCameras();
  assert.equal(cameras.length, 3);
  assert.ok(cameras.every((camera) => camera.brand === 'blink'));

  const systems = await service.listSystems();
  assert.equal(systems.length, 1);
  assert.equal(systems[0].armed, false);
  assert.equal(systems[0].key, `${added.accountId}:55`);

  const armed = await service.setArmed(systems[0].key, true);
  assert.equal(armed.ok, true);
  assert.ok(logged.some((entry) => entry.command === 'camera arm'));
});

test('camera service: alerts pipeline notifies, logs, dedupes, and emits', async () => {
  const config = fakeConfig();
  const notified = [];
  const emitted = [];
  const logged = [];
  class NoisyDriver extends RtspDriver {
    async connect() { this.setState('connected'); }
  }
  const service = new CameraService({
    config, go2rtc: fakeGo2rtc(),
    emit: (channel, payload) => emitted.push({ channel, payload }),
    log: { write: (entry) => logged.push(entry) },
    notify: (title, body) => notified.push({ title, body }),
    driverClasses: { rtsp: NoisyDriver }
  });
  await service.init();
  await service.addRtspAccount({ name: 'Home', cameras: [{ name: 'Front Door', url: 'rtsp://u:p@h/s' }] });
  const [camera] = await service.listCameras();
  const driver = service.drivers.get(camera.accountId);

  driver.emit('doorbell', { cameraId: camera.id, name: 'Front Door' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(notified.length, 1);
  assert.match(notified[0].body, /doorbell/i);
  assert.ok(logged.some((entry) => entry.type === 'camera-alert'));
  assert.ok(emitted.some((event) => event.channel === 'cameras:alert' && event.payload.kind === 'doorbell'));

  // Same camera again inside the dedupe window: silently dropped.
  driver.emit('doorbell', { cameraId: camera.id, name: 'Front Door' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(notified.length, 1, 'deduped within 60s window');
});

test('camera service: sdp-bridge live view for drivers with sessions', async () => {
  const config = fakeConfig();
  class SdpDriver extends RtspDriver {
    async connect() { this.setState('connected'); }
    async createSdpSession(cameraId, offerSdp) { return { answerSdp: `ans:${cameraId}:${offerSdp}`, close: () => {} }; }
  }
  const service = new CameraService({
    config, go2rtc: fakeGo2rtc(), emit: () => {}, log: { write: () => {} },
    driverClasses: { rtsp: SdpDriver }
  });
  await service.init();
  await service.addRtspAccount({ name: 'Home', cameras: [{ name: 'Cam', url: 'rtsp://u:p@h/s' }] });
  const [camera] = await service.listCameras();
  const live = await service.openLiveView(camera.key);
  assert.equal(live.ok, true);
  assert.equal(live.mode, 'sdp-bridge');
  const answer = await service.answerLiveView(camera.key, 'offer-1');
  assert.equal(answer.ok, true);
  assert.equal(answer.answerSdp, `ans:${camera.id}:offer-1`);
  await service.closeLiveView(camera.key);
});

const { RingDriver } = require('../core/camera/drivers/ring-driver');

function fakeSubject() {
  const subs = [];
  return { subscribe: (fn) => { subs.push(fn); return { unsubscribe: () => {} }; }, fire: (v) => subs.forEach((fn) => fn(v)) };
}

function fakeRingApi() {
  const motion = fakeSubject();
  const doorbell = fakeSubject();
  const camera = {
    id: 77, name: 'Front Door', isDoorbot: true,
    onMotionDetected: motion, onDoorbellPressed: doorbell,
    getSnapshot: async () => Buffer.from([9, 9]),
    createSimpleWebRtcSession: () => ({
      start: async (offerSdp) => `answer-for:${offerSdp}`,
      end: () => {}
    })
  };
  const location = {
    id: 'loc1', name: 'Home',
    getLocationMode: async () => ({ mode: 'disarmed' }),
    setLocationMode: async () => {},
    supportsLocationModeSwitching: true
  };
  return {
    getCameras: async () => [camera],
    getLocations: async () => [location],
    disconnect: () => {},
    _fire: { motion, doorbell }
  };
}

test('ring driver: cameras, systems, snapshot, sdp session, motion events', async () => {
  const persisted = [];
  const api = fakeRingApi();
  const driver = new RingDriver({
    account: { id: 'r1', name: 'ring@a.c' },
    secrets: { email: 'ring@a.c', refreshToken: 'rt-1' },
    persistSecrets: (secrets) => persisted.push(secrets),
    apiFactory: ({ onTokenUpdate }) => { setTimeout(() => onTokenUpdate('rt-2'), 0); return api; }
  });
  await driver.connect();
  assert.equal(driver.status().state, 'connected');

  const cameras = await driver.listCameras();
  assert.deepEqual(cameras, [{ id: '77', name: 'Front Door', brand: 'ring', canStream: true, canArm: false, kind: 'doorbell' }]);

  const systems = await driver.listSystems();
  assert.deepEqual(systems, [{ id: 'loc1', name: 'Home', armed: false, canArm: true }]);

  const jpeg = await driver.getSnapshot('77');
  assert.ok(Buffer.isBuffer(jpeg) && jpeg.length === 2);

  const session = await driver.createSdpSession('77', 'my-offer');
  assert.equal(session.answerSdp, 'answer-for:my-offer');
  session.close();

  const events = [];
  driver.on('motion', (event) => events.push(event));
  driver.on('doorbell', (event) => events.push({ ...event, bell: true }));
  api._fire.motion.fire({});
  api._fire.doorbell.fire({});
  assert.equal(events.length, 2);
  assert.equal(events[0].cameraId, '77');
  assert.equal(events[1].bell, true);

  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(persisted.some((secrets) => secrets.refreshToken === 'rt-2'), 'rotated token persisted');
});

test('ring driver: without a refresh token it reports a clear error state', async () => {
  const driver = new RingDriver({
    account: { id: 'r1', name: 'ring@a.c' },
    secrets: { email: 'ring@a.c' },
    apiFactory: () => { throw new Error('should not be called'); }
  });
  await driver.connect();
  assert.equal(driver.status().state, 'error');
  assert.match(driver.status().message, /sign in/i);
});

test('router: "who\'s at the front door" answers from a camera frame', async () => {
  const { CommandRouter } = require('../core/router');
  const router = new CommandRouter({
    config: { getSettings: () => ({ projects: {} }) },
    tools: {},
    ai: {
      describeCameraFrame: async (_jpeg, subject) => ({ ok: true, text: `a courier at ${subject}` }),
      reply: async () => ({ ok: true, text: 'I have no camera by that name.', source: 'local-core' })
    },
    memory: { list: () => [], search: () => [] },
    tasks: { list: () => [], summary: () => ({ open: 0, overdue: 0, tasks: [] }) },
    log: { write: () => {} },
    cameras: {
      listCameras: async () => [{ key: 'a1:9', id: '9', name: 'Front Door', brand: 'blink' }],
      getSnapshot: async () => ({ ok: true, jpegBase64: 'abc' })
    }
  });
  const answer = await router.handle("Who's at the front door?");
  assert.match(answer.response, /Front Door: a courier/);
  // Unknown camera names fall through to normal handling, not an error.
  const fallthrough = await router.handle("Who's at the moon base?");
  assert.doesNotMatch(fallthrough.response || '', /moon base:/i);
});

const nestClient = require('../core/camera/nest-client');

test('nest client: consent URL, token exchange, device listing, webrtc command', async () => {
  const url = nestClient.authUrl({ projectId: 'proj-1', clientId: 'cid-1', redirectUri: 'http://127.0.0.1:9/cb' });
  assert.match(url, /^https:\/\/nestservices\.google\.com\/partnerconnections\/proj-1\/auth\?/);
  assert.ok(url.includes('client_id=cid-1'));
  assert.ok(url.includes('access_type=offline'));
  assert.ok(url.includes(encodeURIComponent('https://www.googleapis.com/auth/sdm.service')));

  const calls = [];
  const fetchFn = async (target, options = {}) => {
    calls.push({ target, options });
    if (target.includes('oauth2.googleapis.com/token')) {
      return { ok: true, json: async () => ({ refresh_token: 'rt', access_token: 'at', expires_in: 3600 }) };
    }
    if (target.endsWith('/devices')) {
      return { ok: true, json: async () => ({ devices: [
        { name: 'enterprises/proj-1/devices/dev-1', type: 'sdm.devices.types.DOORBELL',
          traits: { 'sdm.devices.traits.Info': { customName: 'Front Door' }, 'sdm.devices.traits.CameraLiveStream': { supportedProtocols: ['WEB_RTC'] } } },
        { name: 'enterprises/proj-1/devices/dev-2', type: 'sdm.devices.types.THERMOSTAT', traits: {} }
      ] }) };
    }
    if (target.includes(':executeCommand')) {
      return { ok: true, json: async () => ({ results: { answerSdp: 'nest-answer', mediaSessionId: 'ms-1' } }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  const token = await nestClient.exchangeCode({ clientId: 'cid-1', clientSecret: 'sec', code: 'code-1', redirectUri: 'http://127.0.0.1:9/cb', fetchFn });
  assert.equal(token.refreshToken, 'rt');
  assert.ok(token.expiresAt > Date.now());
  assert.ok(calls[0].options.body.includes('grant_type=authorization_code'));

  const devices = await nestClient.listDevices({ accessToken: 'at', fetchFn }, 'proj-1');
  assert.deepEqual(devices, [{ id: 'dev-1', name: 'Front Door', protocols: ['WEB_RTC'] }]);

  const stream = await nestClient.generateWebRtcStream({ accessToken: 'at', fetchFn }, 'proj-1', 'dev-1', 'my-offer');
  assert.equal(stream.answerSdp, 'nest-answer');
  const command = calls.find((call) => call.target.includes(':executeCommand'));
  assert.ok(command.target.includes('enterprises/proj-1/devices/dev-1'));
  assert.ok(command.options.body.includes('GenerateWebRtcStream'));
});

const { NestDriver } = require('../core/camera/drivers/nest-driver');

test('nest driver: refreshes token, lists live-only cameras, bridges sdp', async () => {
  const persisted = [];
  const fakeClient = {
    refreshAccessToken: async () => ({ accessToken: 'at-2', expiresAt: Date.now() + 3600000 }),
    listDevices: async () => ([{ id: 'dev-1', name: 'Front Door', protocols: ['WEB_RTC'] }]),
    generateWebRtcStream: async (_s, _p, _d, offer) => ({ answerSdp: `ans:${offer}`, mediaSessionId: 'ms' }),
    generateRtspStream: async () => ({ rtspUrl: 'rtsps://nest/stream' })
  };
  const driver = new NestDriver({
    account: { id: 'n1', name: 'Nest' },
    secrets: { projectId: 'proj-1', clientId: 'cid', clientSecret: 'sec', refreshToken: 'rt' },
    persistSecrets: (secrets) => persisted.push(secrets),
    client: fakeClient
  });
  await driver.connect();
  assert.equal(driver.status().state, 'connected');
  assert.ok(persisted.some((secrets) => secrets.accessToken === 'at-2'));

  const cameras = await driver.listCameras();
  assert.deepEqual(cameras, [{ id: 'dev-1', name: 'Front Door', brand: 'nest', canStream: true, canArm: false, kind: 'camera', liveOnly: true }]);
  assert.deepEqual(await driver.listSystems(), []);

  const session = await driver.createSdpSession('dev-1', 'offer-x');
  assert.equal(session.answerSdp, 'ans:offer-x');
  session.close();
  await assert.rejects(() => driver.getSnapshot('dev-1'), (e) => e.code === 'NOT_SUPPORTED');
});

test('camera service: nest account added through an injected oauth flow', async () => {
  const config = fakeConfig();
  class FakeNest extends NestDriver {
    async connect() { this.setState('connected'); }
  }
  const service = new CameraService({
    config, go2rtc: fakeGo2rtc(), emit: () => {}, log: { write: () => {} },
    driverClasses: { nest: FakeNest }
  });
  await service.init();
  const added = await service.addNestAccount(
    { projectId: 'proj-1', clientId: 'cid', clientSecret: 'sec' },
    { oauthFlow: async () => ({ refreshToken: 'rt-9', accessToken: 'at-9', expiresAt: Date.now() + 1000 }) }
  );
  assert.equal(added.ok, true);
  assert.equal(service.listAccounts()[0].brand, 'nest');
  assert.ok(config._secrets[`cameraAccount:${service.listAccounts()[0].id}`].includes('rt-9'));
  assert.ok(!JSON.stringify(config.getSettings()).includes('sec'), 'client secret only in secrets');
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

const { BlinkDriver } = require('../core/camera/drivers/blink-driver');

function fakeBlinkClient(overrides = {}) {
  return {
    login: async () => ({ token: 't1', accountId: 1, clientId: 2, tier: 'u1', verificationRequired: false }),
    verifyPin: async () => ({ ok: true, message: '' }),
    homescreen: async () => ({
      networks: [{ id: 55, name: 'Home', armed: false }],
      cameras: [{ id: 9, name: 'Garage', network_id: 55, thumbnail: '/media/thumb9' }],
      owls: [{ id: 10, name: 'Mini', network_id: 55, thumbnail: '/media/thumb10' }],
      doorbells: [{ id: 11, name: 'Front Door', network_id: 55, thumbnail: '/media/thumb11' }]
    }),
    requestThumbnail: async () => {},
    getImage: async () => Buffer.from([1, 2, 3]),
    setArmed: async () => {},
    ...overrides
  };
}

test('blink driver: connects, merges camera kinds, lists systems, snapshots', async () => {
  const persisted = [];
  const driver = new BlinkDriver({
    account: { id: 'b1', name: 'a@b.c' },
    secrets: { email: 'a@b.c', password: 'pw', uniqueId: 'u1' },
    persistSecrets: (secrets) => persisted.push(secrets),
    clientFactory: () => fakeBlinkClient()
  });
  await driver.connect();
  assert.equal(driver.brand, 'blink');
  assert.equal(driver.status().state, 'connected');
  assert.equal(driver.snapshotCooldownMs, 600000);
  assert.ok(persisted.length >= 1 && persisted[0].token === 't1', 'session persisted after login');

  const cameras = await driver.listCameras();
  assert.deepEqual(cameras.map((c) => `${c.kind}:${c.name}`), ['camera:Garage', 'owl:Mini', 'doorbell:Front Door']);
  assert.ok(cameras.every((c) => c.brand === 'blink' && c.canStream === false && c.canArm === false));

  const systems = await driver.listSystems();
  assert.deepEqual(systems, [{ id: 55, name: 'Home', armed: false, canArm: true }]);

  const jpeg = await driver.getSnapshot('9');
  assert.ok(Buffer.isBuffer(jpeg) && jpeg.length === 3);
  await driver.setArmed(55, true);
});

test('blink driver: 2FA flow pauses in verify state until the PIN arrives', async () => {
  let pinChecked = '';
  const driver = new BlinkDriver({
    account: { id: 'b1', name: 'a@b.c' },
    secrets: { email: 'a@b.c', password: 'pw', uniqueId: 'u1' },
    clientFactory: () => fakeBlinkClient({
      login: async () => ({ token: 't1', accountId: 1, clientId: 2, tier: 'u1', verificationRequired: true }),
      verifyPin: async (_session, pin) => { pinChecked = pin; return { ok: true, message: '' }; }
    })
  });
  await driver.connect();
  assert.equal(driver.status().state, 'verify');
  assert.match(driver.status().message, /PIN/);
  const result = await driver.submitPin('4321');
  assert.equal(result.ok, true);
  assert.equal(pinChecked, '4321');
  assert.equal(driver.status().state, 'connected');
});

test('blink driver: falls back to the current thumbnail when a fresh one fails', async () => {
  const driver = new BlinkDriver({
    account: { id: 'b1', name: 'a@b.c' },
    secrets: { email: 'a@b.c', password: 'pw', uniqueId: 'u1', token: 't1', accountId: 1, clientId: 2, tier: 'u1' },
    clientFactory: () => fakeBlinkClient({
      requestThumbnail: async () => { throw new Error('busy'); }
    })
  });
  driver.freshWaitMs = 0;
  await driver.connect();
  const jpeg = await driver.getSnapshot('10');
  assert.ok(Buffer.isBuffer(jpeg), 'still returns the last known picture');
});

test('blink client: surfaces server error messages', async () => {
  const { fetchFn } = blinkFetch([{ match: '/api/v5/account/login', method: 'POST', status: 401, json: { message: 'Invalid credentials' } }]);
  const client = new BlinkClient({ fetchFn });
  await assert.rejects(() => client.login({ email: 'a@b.c', password: 'bad', uniqueId: 'u' }), /Invalid credentials/);
});
