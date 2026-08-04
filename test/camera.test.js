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
  assert.ok(DEFAULTS.settingsVersion >= 6, 'camera migration shipped in v6');
  assert.deepEqual(DEFAULTS.cameraAccounts, []);
  assert.ok(DEFAULTS.hiddenModules.includes('cameras'));
  assert.ok(DEFAULTS.moduleLayout.cameras);
  const migrated = mergeS(DEFAULTS, { settingsVersion: 5, hiddenModules: [] });
  assert.ok(migrated.hiddenModules.includes('cameras'));
  assert.equal(migrated.settingsVersion, DEFAULTS.settingsVersion);
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

test('camera service: blink account flow via the browser sign-in, systems, and arming', async () => {
  const config = fakeConfig();
  const logged = [];
  class TestBlinkDriver extends BlinkDriver {
    constructor(options) {
      super({ ...options, clientFactory: () => fakeBlinkClient() });
      this.freshWaitMs = 0;
    }
  }
  const service = new CameraService({
    config, go2rtc: fakeGo2rtc(), emit: () => {}, log: { write: (entry) => logged.push(entry) },
    driverClasses: { blink: TestBlinkDriver }
  });
  await service.init();

  const added = await service.addBlinkAccount({}, {
    signInFlow: async ({ hardwareId }) => ({ hardwareId, session: { ...FAKE_SESSION } })
  });
  assert.equal(added.ok, true);
  assert.ok(!JSON.stringify(config.getSettings()).includes('r1'), 'tokens stay in secrets, never in settings');

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

test('camera service: notifyGate can silence the notification without touching the alert pipeline', async () => {
  const config = fakeConfig();
  const notified = [];
  const emitted = [];
  const gateCalls = [];
  class NoisyDriver2 extends RtspDriver {
    async connect() { this.setState('connected'); }
  }
  const service = new CameraService({
    config, go2rtc: fakeGo2rtc(),
    emit: (channel, payload) => emitted.push({ channel, payload }),
    log: { write: () => {} },
    notify: (title, body) => notified.push({ title, body }),
    notifyGate: (alert) => { gateCalls.push(alert); return alert.kind !== 'motion'; },
    driverClasses: { rtsp: NoisyDriver2 }
  });
  await service.init();
  await service.addRtspAccount({ name: 'Home', cameras: [{ name: 'Yard', url: 'rtsp://u:p@h/s' }] });
  const [camera] = await service.listCameras();
  const driver = service.drivers.get(camera.accountId);

  driver.emit('motion', { cameraId: camera.id, name: 'Yard' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(notified.length, 0, 'gated motion shows no Windows notification');
  assert.ok(emitted.some((event) => event.channel === 'cameras:alert' && event.payload.kind === 'motion'), 'the alert still reaches the UI');
  assert.equal(gateCalls.length, 1);
  assert.equal(gateCalls[0].kind, 'motion');
  assert.equal(gateCalls[0].name, 'Yard');
});

test('camera service: setArmed passes non-numeric system ids through unchanged (Ring)', async () => {
  const config = fakeConfig();
  const armedWith = [];
  // Mimics Ring: location ids are non-numeric strings, and setArmed looks the
  // location up by exact string id. Number()-coercing the id would break this.
  class RingLikeDriver extends RtspDriver {
    async connect() { this.setState('connected'); }
    async listSystems() { return [{ id: 'loc-abc123', name: 'Home', armed: false, canArm: true }]; }
    async setArmed(systemId, armed) {
      if (systemId !== 'loc-abc123') throw new Error('That location was not found.');
      armedWith.push({ systemId, armed });
    }
  }
  const service = new CameraService({
    config, go2rtc: fakeGo2rtc(), emit: () => {}, log: { write: () => {} },
    driverClasses: { rtsp: RingLikeDriver }
  });
  await service.init();
  await service.addRtspAccount({ name: 'Home', cameras: [{ name: 'Cam', url: 'rtsp://u:p@h/s' }] });
  const [system] = await service.listSystems();
  const result = await service.setArmed(system.key, true);
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(armedWith, [{ systemId: 'loc-abc123', armed: true }]);
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
    calls.push({
      url,
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body,
      redirect: options.redirect
    });
    for (const route of routes) {
      const matches = url.includes(route.match)
        && (!route.method || route.method === (options.method || 'GET'))
        && (!route.once || !route.spent);
      if (!matches) continue;
      route.spent = true;
      const status = route.status || 200;
      return {
        ok: status < 300,
        status,
        headers: {
          get: (name) => (route.headers || {})[String(name).toLowerCase()] ?? null,
          getSetCookie: () => route.setCookie || []
        },
        json: async () => route.json ?? {},
        arrayBuffer: async () => route.buffer ?? new ArrayBuffer(4),
        text: async () => route.text ?? JSON.stringify(route.json ?? {})
      };
    }
    return {
      ok: false,
      status: 404,
      headers: { get: () => null, getSetCookie: () => [] },
      json: async () => ({ message: 'not found' }),
      text: async () => 'not found'
    };
  };
  return { fetchFn, calls };
}

const OAUTH_TOKENS = { access_token: 'tok123', refresh_token: 'ref456', expires_in: 3600 };

test('blink client: builds an authorize URL a browser window can open', async () => {
  const client = new BlinkClient({ fetchFn: blinkFetch([]).fetchFn });
  const request = client.authorizeRequest({ hardwareId: 'HW-1' });

  assert.match(request.url, /^https:\/\/api\.oauth\.blink\.com\/oauth\/v2\/authorize\?/);
  const query = new URLSearchParams(request.url.split('?')[1]);
  assert.equal(query.get('hardware_id'), 'HW-1');
  assert.equal(query.get('code_challenge_method'), 'S256');
  assert.equal(query.get('response_type'), 'code');
  assert.equal(query.get('client_id'), 'ios');
  assert.equal(query.get('redirect_uri'), 'immedia-blink://applinks.blink.com/signin/callback');
  assert.ok(query.get('code_challenge'), 'sends the hashed challenge');
  assert.ok(request.verifier, 'keeps the verifier for the exchange');
  assert.ok(!request.url.includes(request.verifier), 'the verifier itself never goes to Blink');
});

test('blink client: reads the code only off Blink own redirect', () => {
  assert.equal(
    BlinkClient.codeFromRedirect('immedia-blink://applinks.blink.com/signin/callback?code=code-xyz&state=s'),
    'code-xyz'
  );
  assert.equal(BlinkClient.codeFromRedirect('https://api.oauth.blink.com/oauth/v2/signin'), null);
  assert.equal(BlinkClient.codeFromRedirect('https://evil.example/callback?code=stolen'), null, 'a lookalike is ignored');
  assert.equal(BlinkClient.codeFromRedirect('immedia-blink://applinks.blink.com/signin/callback?error=denied'), null);
  assert.equal(BlinkClient.codeFromRedirect(''), null);
  assert.equal(BlinkClient.codeFromRedirect(undefined), null);
});

test('blink client: trades a code for a session', async () => {
  const { fetchFn, calls } = blinkFetch([
    { match: '/oauth/token', method: 'POST', json: OAUTH_TOKENS },
    { match: '/api/v1/users/tier_info', json: { tier: 'u011', account_id: 111 } }
  ]);
  const client = new BlinkClient({ fetchFn });
  const session = await client.session(await client.exchangeCode({ code: 'code-xyz', verifier: 'ver-1', hardwareId: 'HW-1' }));

  assert.equal(session.token, 'tok123');
  assert.equal(session.refreshToken, 'ref456');
  assert.equal(session.tier, 'u011');
  assert.equal(session.accountId, 111);
  assert.ok(session.expiresAt > Date.now(), 'session carries an expiry');

  const body = new URLSearchParams(calls[0].body);
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('code'), 'code-xyz');
  assert.equal(body.get('code_verifier'), 'ver-1', 'proves possession of the PKCE verifier');
  assert.equal(calls[1].headers.Authorization, 'Bearer tok123');
});

test('blink client: refreshing trades the refresh token for a new session', async () => {
  const { fetchFn, calls } = blinkFetch([
    { match: '/oauth/token', method: 'POST', json: { access_token: 'tok999', refresh_token: 'ref999', expires_in: 7200 } },
    { match: '/api/v1/users/tier_info', json: { tier: 'u022', account_id: 222 } }
  ]);
  const client = new BlinkClient({ fetchFn });
  const session = await client.refreshSession({ refreshToken: 'ref456', hardwareId: 'HW-1' });
  assert.equal(session.token, 'tok999');
  assert.equal(session.tier, 'u022');
  assert.equal(session.accountId, 222);
  const body = new URLSearchParams(calls[0].body);
  assert.equal(body.get('grant_type'), 'refresh_token');
  assert.equal(body.get('refresh_token'), 'ref456');
});

test('blink client: a refused token request surfaces the reason Blink gave', async () => {
  const { fetchFn } = blinkFetch([{
    match: '/oauth/token', method: 'POST', status: 401,
    json: { error: 'invalid_grant', error_description: 'The provided authorization grant is invalid.' }
  }]);
  const client = new BlinkClient({ fetchFn });
  await assert.rejects(
    () => client.exchangeCode({ code: 'stale', verifier: 'v', hardwareId: 'HW-1' }),
    /authorization grant is invalid/
  );
});

test('blink client: authenticated calls hit the tier host with a Bearer token', async () => {
  const session = { token: 'tok123', accountId: 111, tier: 'u011' };
  const { fetchFn, calls } = blinkFetch([
    { match: '/homescreen', json: { networks: [], cameras: [] } },
    { match: '/state/arm', method: 'POST', json: {} },
    { match: '/media/production/', buffer: new ArrayBuffer(6) }
  ]);
  const client = new BlinkClient({ fetchFn });
  await client.homescreen(session);
  await client.setArmed(session, 55, true);
  const image = await client.getImage(session, '/media/production/account/111/thumb');
  assert.ok(Buffer.isBuffer(image) && image.length === 6);
  for (const call of calls) {
    assert.match(call.url, /^https:\/\/rest-u011\.immedia-semi\.com/);
    assert.equal(call.headers.Authorization, 'Bearer tok123');
    assert.equal(call.headers['TOKEN-AUTH'], undefined, 'the dead auth header is gone');
  }
  assert.match(calls[0].url, /\/api\/v3\/accounts\/111\/homescreen$/);
  assert.match(calls[1].url, /\/api\/v1\/accounts\/111\/networks\/55\/state\/arm$/);
  assert.match(calls[2].url, /\/media\/production\/account\/111\/thumb\.jpg$/);
});

// Both of these were tried against Blink's live servers and are permanently
// dead ends; a future "simplification" back to either one would break sign-in.
test('blink client: the retired login endpoint and blocked password POST are gone for good', async () => {
  const source = require('fs').readFileSync(require.resolve('../core/camera/blink-client.js'), 'utf8');
  const live = source.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  assert.ok(!live.includes('/api/v5/account/login'), 'nothing still calls the endpoint Blink retired');
  assert.ok(!live.includes('TOKEN-AUTH'), 'nothing still sends the retired auth header');
  assert.ok(!live.includes('/oauth/v2/signin'), 'nothing posts the password itself — Cloudflare answers 406');
  assert.ok(!live.includes('password'), 'the client never handles a Blink password at all');
});

const { runBlinkSignIn } = require('../core/camera/blink-oauth');

// A stand-in for the Electron window: replays the navigations a real sign-in
// would make, ending on Blink's redirect.
function fakeWindow(navigations, { closes = false } = {}) {
  const opened = [];
  const state = { closed: false };
  const openWindow = ({ url, onRedirect, onClosed }) => {
    opened.push(url);
    setImmediate(() => {
      for (const target of navigations) onRedirect(target);
      if (closes) onClosed();
    });
    return { close: () => { state.closed = true; } };
  };
  return { openWindow, opened, state };
}

test('blink sign-in: catches the code off the redirect and closes the window', async () => {
  const { fetchFn } = blinkFetch([
    { match: '/oauth/token', method: 'POST', json: OAUTH_TOKENS },
    { match: '/api/v1/users/tier_info', json: { tier: 'u011', account_id: 111 } }
  ]);
  const win = fakeWindow([
    'https://api.oauth.blink.com/oauth/v2/signin',
    'https://api.oauth.blink.com/oauth/v2/2fa',
    'immedia-blink://applinks.blink.com/signin/callback?code=code-xyz&state=s'
  ]);
  const result = await runBlinkSignIn({
    openWindow: win.openWindow,
    hardwareId: 'HW-1',
    client: new BlinkClient({ fetchFn })
  });
  assert.equal(result.session.token, 'tok123');
  assert.equal(result.hardwareId, 'HW-1');
  assert.match(win.opened[0], /oauth\/v2\/authorize\?/);
  assert.equal(win.state.closed, true, 'the sign-in window does not linger');
});

test('blink sign-in: closing the window cancels instead of hanging', async () => {
  const win = fakeWindow([], { closes: true });
  await assert.rejects(
    () => runBlinkSignIn({ openWindow: win.openWindow, hardwareId: 'HW-1', client: new BlinkClient({ fetchFn: blinkFetch([]).fetchFn }) }),
    /cancelled/
  );
});

test('blink sign-in: gives up rather than waiting forever', async () => {
  const win = fakeWindow(['https://api.oauth.blink.com/oauth/v2/signin']);
  await assert.rejects(
    () => runBlinkSignIn({ openWindow: win.openWindow, hardwareId: 'HW-1', timeoutMs: 30, client: new BlinkClient({ fetchFn: blinkFetch([]).fetchFn }) }),
    /timed out/
  );
});


const { BlinkDriver } = require('../core/camera/drivers/blink-driver');

const FAKE_SESSION = { token: 't1', refreshToken: 'r1', expiresAt: Date.now() + 3600000, accountId: 1, tier: 'u1' };

function fakeBlinkClient(overrides = {}) {
  return {
    refreshSession: async () => ({ ...FAKE_SESSION, token: 't2' }),
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
    account: { id: 'b1', name: 'Blink account' },
    secrets: { hardwareId: 'hw-1', ...FAKE_SESSION },
    persistSecrets: (secrets) => persisted.push(secrets),
    clientFactory: () => fakeBlinkClient()
  });
  await driver.connect();
  assert.equal(driver.brand, 'blink');
  assert.equal(driver.status().state, 'connected');
  assert.equal(driver.snapshotCooldownMs, 600000);
  assert.ok(persisted.length >= 1 && persisted[0].token === 't2', 'renewed session persisted');
  assert.equal(persisted[0].refreshToken, 'r1', 'the refresh token is kept for silent renewal');

  const cameras = await driver.listCameras();
  assert.deepEqual(cameras.map((c) => `${c.kind}:${c.name}`), ['camera:Garage', 'owl:Mini', 'doorbell:Front Door']);
  // canStream is true now that live view is implemented (blink-immi.js).
  assert.ok(cameras.every((c) => c.brand === 'blink' && c.canStream === true && c.canArm === false));

  const systems = await driver.listSystems();
  assert.deepEqual(systems, [{ id: 55, name: 'Home', armed: false, canArm: true }]);

  const jpeg = await driver.getSnapshot('9');
  assert.ok(Buffer.isBuffer(jpeg) && jpeg.length === 3);
  await driver.setArmed(55, true);
});

test('blink driver: falls back to the current thumbnail when a fresh one fails', async () => {
  const driver = new BlinkDriver({
    account: { id: 'b1', name: 'Blink account' },
    secrets: { hardwareId: 'hw-1', ...FAKE_SESSION },
    clientFactory: () => fakeBlinkClient({
      requestThumbnail: async () => { throw new Error('busy'); }
    })
  });
  driver.freshWaitMs = 0;
  await driver.connect();
  const jpeg = await driver.getSnapshot('10');
  assert.ok(Buffer.isBuffer(jpeg), 'still returns the last known picture');
});

test('blink driver: a stored refresh token reconnects with no sign-in window', async () => {
  const persisted = [];
  const driver = new BlinkDriver({
    account: { id: 'b1', name: 'Blink account' },
    secrets: { hardwareId: 'hw-1', refreshToken: 'r1' },
    persistSecrets: (secrets) => persisted.push(secrets),
    clientFactory: () => fakeBlinkClient()
  });
  await driver.connect();
  assert.equal(driver.status().state, 'connected');
  assert.equal(persisted.at(-1).token, 't2', 'the renewed token is saved');
});

// There is no password stored to retry with, so this has to say so plainly
// rather than failing silently or looking like a broken camera.
test('blink driver: a dead refresh token asks for a fresh sign-in', async () => {
  const driver = new BlinkDriver({
    account: { id: 'b1', name: 'Blink account' },
    secrets: { hardwareId: 'hw-1', refreshToken: 'stale' },
    clientFactory: () => fakeBlinkClient({
      refreshSession: async () => { throw new Error('revoked'); }
    })
  });
  await driver.connect();
  assert.equal(driver.status().state, 'error');
  assert.match(driver.status().message, /revoked/);
});

test('blink driver: with no stored session at all it points at the BLINK tab', async () => {
  const driver = new BlinkDriver({
    account: { id: 'b1', name: 'Blink account' },
    secrets: { hardwareId: 'hw-1' },
    clientFactory: () => fakeBlinkClient()
  });
  await driver.connect();
  assert.equal(driver.status().state, 'error');
  assert.match(driver.status().message, /signing in again/);
});

test('blink driver: an expiring token is renewed before the next camera call', async () => {
  let refreshes = 0;
  const driver = new BlinkDriver({
    account: { id: 'b1', name: 'Blink account' },
    secrets: {
      hardwareId: 'hw-1',
      token: 'old', refreshToken: 'r1', accountId: 1, tier: 'u1',
      expiresAt: Date.now() + 5000 // inside the refresh margin
    },
    clientFactory: () => fakeBlinkClient({
      refreshSession: async () => { refreshes += 1; return { ...FAKE_SESSION, token: 't2' }; }
    })
  });
  await driver.connect();
  const before = refreshes;
  driver.secrets.expiresAt = Date.now() + 5000; // expire it again mid-session
  await driver.listCameras();
  await driver.getSnapshot('9');
  assert.ok(refreshes > before, 'renewed rather than failing the call');
  assert.equal(driver.status().state, 'connected');
});

test('blink driver: an old account stored as uniqueId still reconnects', async () => {
  let seenHardwareId = '';
  const driver = new BlinkDriver({
    account: { id: 'b1', name: 'Blink account' },
    secrets: { uniqueId: 'abc-def', refreshToken: 'r1' },
    clientFactory: () => fakeBlinkClient({
      refreshSession: async ({ hardwareId }) => { seenHardwareId = hardwareId; return { ...FAKE_SESSION, token: 't2' }; }
    })
  });
  await driver.connect();
  assert.equal(seenHardwareId, 'ABC-DEF', 'reuses the old id, uppercased the way Blink wants');
  assert.equal(driver.status().state, 'connected');
});

// Blink live view rides Amazon's own MPEG-TS protocol, so it cannot go through
// go2rtc or WebRTC like the other brands. The driver's job is to ask Blink for a
// session, hand the camera's serial to the socket, and pump chunks out.
test('blink driver: opens a live stream with the camera serial and its own network', async () => {
  const asked = [];
  const built = [];
  const instances = [];
  class FakeStream {
    constructor(options) { built.push(options); instances.push(this); this.stopped = false; }
    async start() { return this; }
    stop() { this.stopped = true; }
  }
  const driver = new BlinkDriver({
    account: { id: 'b1', name: 'Blink account' },
    secrets: { hardwareId: 'hw-1', ...FAKE_SESSION },
    clientFactory: () => fakeBlinkClient({
      homescreen: async () => ({
        networks: [{ id: 55, name: 'Home', armed: false }],
        cameras: [{ id: 9, name: 'Garage', network_id: 55, serial: 'G8T1-0009', thumbnail: '/m/9' }],
        owls: [{ id: 10, name: 'Mini', network_id: 55, serial: 'G8T1-0010', thumbnail: '/m/10' }]
      }),
      liveView: async (_session, networkId, cameraId, kind) => {
        asked.push({ networkId, cameraId, kind });
        return { server: 'immis://h.example:443/CONN__x?client_id=7', commandId: 42, pollingInterval: 3 };
      }
    }),
    LiveStream: FakeStream,
    connectLiveStream: async () => ({ on() {}, write() {}, destroy() {} })
  });
  await driver.connect();

  const chunks = [];
  await driver.startLiveStream('9', { onVideo: (c) => chunks.push(c) });
  assert.deepEqual(asked, [{ networkId: 55, cameraId: 9, kind: 'camera' }]);
  assert.equal(built[0].serial, 'G8T1-0009', 'Blink authenticates the socket with the serial');
  assert.equal(built[0].commandId, 42);
  assert.equal(built[0].pollingInterval, 3);

  // A Mini is a different endpoint shape, so the kind has to travel through.
  await driver.startLiveStream('10', {});
  assert.equal(asked[1].kind, 'owl');

  driver.stopLiveStream('9');
  assert.equal(instances[0].stopped, true, 'the Garage stream was torn down');
  assert.equal(instances[1].stopped, false, 'the Mini stream is untouched');
});

test('blink driver: live view on an unknown camera fails loudly', async () => {
  const driver = new BlinkDriver({
    account: { id: 'b1', name: 'Blink account' },
    secrets: { hardwareId: 'hw-1', ...FAKE_SESSION },
    clientFactory: () => fakeBlinkClient()
  });
  await driver.connect();
  await assert.rejects(() => driver.startLiveStream('nope', {}), /was not found/);
});

test('blink driver: disconnecting stops every open live stream', async () => {
  const streams = [];
  class FakeStream {
    constructor() { this.stopped = false; streams.push(this); }
    async start() { return this; }
    stop() { this.stopped = true; }
  }
  const driver = new BlinkDriver({
    account: { id: 'b1', name: 'Blink account' },
    secrets: { hardwareId: 'hw-1', ...FAKE_SESSION },
    clientFactory: () => fakeBlinkClient({
      homescreen: async () => ({
        networks: [], doorbells: [{ id: 11, name: 'Front', network_id: 55, serial: 'S11', thumbnail: '/m/11' }]
      }),
      liveView: async () => ({ server: 'immis://h:443/C__x?client_id=1', commandId: 1, pollingInterval: 1 })
    }),
    LiveStream: FakeStream,
    connectLiveStream: async () => ({ on() {}, write() {}, destroy() {} })
  });
  await driver.connect();
  await driver.startLiveStream('11', {});
  await driver.disconnect();
  assert.equal(streams.length, 1);
  assert.equal(streams[0].stopped, true, 'no camera left awake after teardown');
});
