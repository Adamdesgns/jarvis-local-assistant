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
