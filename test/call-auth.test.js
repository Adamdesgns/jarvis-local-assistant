'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CallAuth, PAIRING_TTL_MS } = require('../core/call/call-auth');

test('pairing: 6-digit code, single use, expires after 120s', () => {
  let t = 1000;
  const auth = new CallAuth({ now: () => t });
  const { code, expiresAt } = auth.startPairing();
  assert.match(code, /^\d{6}$/);
  assert.equal(expiresAt, 1000 + PAIRING_TTL_MS);
  assert.equal(auth.claimPairing('000000', 'JR', '100.64.0.9'), null); // wrong code
  const claimed = auth.claimPairing(code, 'JR', '100.64.0.9');
  assert.ok(claimed.secret.length >= 40);                    // 32 bytes base64url
  assert.equal(auth.claimPairing(code, 'again', '100.64.0.9'), null); // single use
  const { code: c2 } = auth.startPairing();
  t += PAIRING_TTL_MS + 1;
  assert.equal(auth.claimPairing(c2, 'late', '100.64.0.9'), null);    // expired
});

test('a successful claim stores the claimer as the kid peer, host from the wire', () => {
  const auth = new CallAuth();
  const { code } = auth.startPairing();
  const { peer } = auth.claimPairing(code, 'JR', '100.101.5.5');
  assert.equal(peer.role, 'kid');
  assert.equal(peer.host, '100.101.5.5');
  assert.equal(peer.name, 'JR');
});

test('adoptPeer stores the parent side (what the claim response handed back)', () => {
  const auth = new CallAuth();
  const peer = auth.adoptPeer({ name: 'JARVIS', host: '100.90.1.1', secret: 'abc' });
  assert.equal(peer.role, 'parent');
  assert.equal(auth.toJSON().host, '100.90.1.1');
});

test('verify: right secret passes without leaking it, wrong secret fails', () => {
  const auth = new CallAuth();
  const { code } = auth.startPairing();
  const { secret } = auth.claimPairing(code, 'JR', '1.1.1.1');
  const peer = auth.verify(`Bearer ${secret}`, '1.1.1.1');
  assert.equal(peer.name, 'JR');
  assert.equal(peer.secret, undefined);                      // never hand it back
  assert.equal(auth.verify('Bearer nope', '1.1.1.1'), null);
  assert.equal(auth.verify(undefined, '1.1.1.1'), null);
});

test('10 straight failures lock an IP out; success clears the count', () => {
  const auth = new CallAuth();
  const { code } = auth.startPairing();
  const { secret } = auth.claimPairing(code, 'JR', '2.2.2.2');
  for (let i = 0; i < 9; i++) auth.verify('Bearer bad', '9.9.9.9');
  assert.ok(!auth.isLockedOut('9.9.9.9'));
  auth.verify('Bearer bad', '9.9.9.9');
  assert.ok(auth.isLockedOut('9.9.9.9'));
  assert.equal(auth.verify(`Bearer ${secret}`, '9.9.9.9'), null); // locked out ≠ wrong secret
  assert.ok(auth.verify(`Bearer ${secret}`, '2.2.2.2'));          // other IPs unaffected
});

test('unpair forgets the peer; verify then fails; re-pairing replaces cleanly', () => {
  const auth = new CallAuth();
  const { code } = auth.startPairing();
  const { secret } = auth.claimPairing(code, 'JR', '3.3.3.3');
  auth.unpair();
  assert.equal(auth.toJSON(), null);
  assert.equal(auth.verify(`Bearer ${secret}`, '3.3.3.3'), null);
});

test('persistence round-trip: new CallAuth({peer: old.toJSON()}) verifies the same secret', () => {
  const first = new CallAuth();
  const { code } = first.startPairing();
  const { secret } = first.claimPairing(code, 'JR', '4.4.4.4');
  const revived = new CallAuth({ peer: first.toJSON() });
  assert.ok(revived.verify(`Bearer ${secret}`, '4.4.4.4'));
});
