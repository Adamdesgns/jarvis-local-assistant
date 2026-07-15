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
