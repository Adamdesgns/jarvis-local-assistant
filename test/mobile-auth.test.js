const test = require('node:test');
const assert = require('node:assert/strict');
const { MobileAuth } = require('../core/mobile-auth');

function fixed(bytes) { return () => Buffer.alloc(bytes, 7); }

test('pairing: code is 6 digits, single-use, and expires after 120s', () => {
  let t = 1000;
  const auth = new MobileAuth({ now: () => t });
  const { code, expiresAt } = auth.startPairing();
  assert.match(code, /^\d{6}$/);
  assert.equal(expiresAt, 1000 + 120000);
  assert.equal(auth.claimPairing('000000', 'x'), null);          // wrong code
  const claimed = auth.claimPairing(code, "Adam's iPhone");
  assert.ok(claimed.key.length >= 40);                            // 32 bytes base64url
  assert.equal(claimed.device.name, "Adam's iPhone");
  assert.equal(auth.claimPairing(code, 'again'), null);           // single-use
  const { code: c2 } = auth.startPairing();
  t += 120001;
  assert.equal(auth.claimPairing(c2, 'late'), null);              // expired
});

test('verify: accepts the real key, rejects wrong/absent, and locks out after 10 fails', () => {
  const auth = new MobileAuth({ now: () => 0 });
  const { code } = auth.startPairing();
  const { key, device } = auth.claimPairing(code, 'phone');
  assert.equal(auth.verify(`Bearer ${key}`, '100.1.1.1').id, device.id);
  assert.equal(auth.verify('Bearer nope', '100.1.1.1'), null);
  assert.equal(auth.verify(undefined, '100.1.1.1'), null);
  for (let i = 0; i < 10; i++) auth.verify('Bearer nope', '100.9.9.9');
  assert.equal(auth.isLockedOut('100.9.9.9'), true);
  assert.equal(auth.verify(`Bearer ${key}`, '100.9.9.9'), null);  // right key, locked ip
  assert.equal(auth.verify(`Bearer ${key}`, '100.1.1.1').id, device.id); // other ip fine
  auth.startPairing();                                            // reopening pairing clears lockouts
  assert.equal(auth.isLockedOut('100.9.9.9'), false);
});

test('revoke + persistence round-trip', () => {
  const auth = new MobileAuth({ now: () => 0 });
  const { code } = auth.startPairing();
  const { key, device } = auth.claimPairing(code, 'phone');
  const reloaded = new MobileAuth({ devices: auth.toJSON(), now: () => 0 });
  assert.equal(reloaded.verify(`Bearer ${key}`, 'ip').id, device.id);
  assert.deepEqual(reloaded.listDevices(), [{ id: device.id, name: 'phone', createdAt: device.createdAt }]);
  assert.equal(reloaded.revoke(device.id), true);
  assert.equal(reloaded.verify(`Bearer ${key}`, 'ip'), null);
  assert.equal(reloaded.revoke('missing'), false);
});
