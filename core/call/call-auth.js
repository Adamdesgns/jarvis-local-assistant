// Pairing and the single trusted peer for JARVIS ↔ JR calls. Pure logic in
// the mobile-auth.js mold: no I/O, no Electron; persistence is the caller's
// job via toJSON(). Differences from MobileAuth are deliberate:
//   - exactly ONE peer, never a list — re-pairing replaces it
//   - the claim hands the generated secret back so BOTH sides hold the same
//     one; every later request in either direction carries it
//   - roles are stamped at pairing time: the side that showed the code is
//     'parent' to the claimer, the claimer is 'kid' to the shower. Phase 2
//     control offers are only honored from the parent side, so this field is
//     enforced locally, never trusted off the wire.
'use strict';
const crypto = require('node:crypto');

const PAIRING_TTL_MS = 120000;
const LOCKOUT_LIMIT = 10;

class CallAuth {
  constructor({ peer = null, random = crypto.randomBytes, now = () => Date.now() } = {}) {
    this.peer = peer ? { ...peer } : null;   // { name, role, secret, host, pairedAt }
    this.random = random;
    this.now = now;
    this.pairing = null;                     // { code, expiresAt }
    this.failures = new Map();               // ip → consecutive failure count
  }

  startPairing() {
    const code = String(this.random(4).readUInt32BE(0) % 1000000).padStart(6, '0');
    this.pairing = { code, expiresAt: this.now() + PAIRING_TTL_MS };
    this.failures.clear();                   // a human is at the desk; clear lockouts
    return { ...this.pairing };
  }

  // The claim arrives over the wire from the OTHER machine: it becomes our
  // peer, its Tailscale address becomes the host we dial back, and the
  // generated secret goes back in the response so both ends match forever.
  claimPairing(code, peerName, ip) {
    if (this.isLockedOut(ip)) return null;
    const p = this.pairing;
    if (!p || this.now() > p.expiresAt || String(code) !== p.code) {
      this.failures.set(ip, (this.failures.get(ip) || 0) + 1);
      return null;
    }
    this.pairing = null;                     // single use
    const secret = this.random(32).toString('base64url');
    this.peer = {
      name: String(peerName || 'JR').slice(0, 60),
      role: 'kid', secret, host: String(ip || ''), pairedAt: this.now()
    };
    this.failures.delete(ip);
    return { secret, peer: { ...this.peer } };
  }

  // The other half of claimPairing: the machine that TYPED the code stores
  // what the claim response handed back. Its peer is the parent side.
  adoptPeer({ name, host, secret }) {
    this.peer = {
      name: String(name || 'JARVIS').slice(0, 60),
      role: 'parent', secret: String(secret), host: String(host), pairedAt: this.now()
    };
    return { ...this.peer };
  }

  verify(authHeader, ip) {
    if (this.isLockedOut(ip)) return null;
    const offered = Buffer.from(String(authHeader || '').replace(/^Bearer\s+/i, ''));
    const held = this.peer ? Buffer.from(this.peer.secret) : Buffer.alloc(0);
    const match = this.peer && offered.length === held.length &&
      offered.length > 0 && crypto.timingSafeEqual(offered, held);
    if (!match) {
      this.failures.set(ip, (this.failures.get(ip) || 0) + 1);
      return null;
    }
    this.failures.delete(ip);
    const { secret, ...peer } = this.peer;
    return peer;
  }

  isLockedOut(ip) { return (this.failures.get(ip) || 0) >= LOCKOUT_LIMIT; }
  unpair() { this.peer = null; }
  toJSON() { return this.peer ? { ...this.peer } : null; }
}

module.exports = { CallAuth, PAIRING_TTL_MS };
