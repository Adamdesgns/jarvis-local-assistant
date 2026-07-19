// Pairing codes, device keys and lockout for the mobile companion. Pure logic:
// no I/O, no Electron. Persistence is the caller's job via toJSON().
const crypto = require('node:crypto');

const PAIRING_TTL_MS = 120000;
const LOCKOUT_LIMIT = 10;

class MobileAuth {
  constructor({ devices = [], random = crypto.randomBytes, now = () => Date.now() } = {}) {
    this.devices = devices.map((d) => ({ ...d }));
    this.random = random;
    this.now = now;
    this.pairing = null;               // { code, expiresAt }
    this.failures = new Map();         // ip → consecutive failure count
  }

  startPairing() {
    const code = String(this.random(4).readUInt32BE(0) % 1000000).padStart(6, '0');
    this.pairing = { code, expiresAt: this.now() + PAIRING_TTL_MS };
    this.failures.clear();             // a human is at the desk; clear lockouts
    return { ...this.pairing };
  }

  claimPairing(code, deviceName, ip) {
    if (this.isLockedOut(ip)) return null;
    const p = this.pairing;
    if (!p || this.now() > p.expiresAt || String(code) !== p.code) {
      this.failures.set(ip, (this.failures.get(ip) || 0) + 1);
      return null;
    }
    this.pairing = null;               // single use
    const key = this.random(32).toString('base64url');
    const device = { id: crypto.randomUUID(), name: String(deviceName || 'Phone').slice(0, 60), createdAt: this.now() };
    this.devices.push({ ...device, key });
    this.failures.delete(ip);
    return { key, device };
  }

  verify(authHeader, ip) {
    if (this.isLockedOut(ip)) return null;
    const offered = String(authHeader || '').replace(/^Bearer\s+/i, '');
    const offeredBuf = Buffer.from(offered);
    let matched = null;
    for (const d of this.devices) {
      const keyBuf = Buffer.from(d.key);
      if (offeredBuf.length === keyBuf.length && crypto.timingSafeEqual(offeredBuf, keyBuf)) matched = d;
    }
    if (!matched) { this.failures.set(ip, (this.failures.get(ip) || 0) + 1); return null; }
    this.failures.delete(ip);
    const { key, ...device } = matched;
    return device;
  }

  isLockedOut(ip) { return (this.failures.get(ip) || 0) >= LOCKOUT_LIMIT; }
  revoke(deviceId) {
    const before = this.devices.length;
    this.devices = this.devices.filter((d) => d.id !== deviceId);
    return this.devices.length < before;
  }
  listDevices() { return this.devices.map(({ id, name, createdAt }) => ({ id, name, createdAt })); }
  toJSON() { return this.devices.map((d) => ({ ...d })); }
}

module.exports = { MobileAuth };
