'use strict';

const os = require('node:os');

// JARVIS Pro — the Lemon Squeezy side of licensing. Three calls, all of them
// user-initiated button presses: ACTIVATE, VALIDATE, DEACTIVATE. This service
// is NEVER called at startup and owns no timers — the app makes no network
// request the user didn't ask for, and once activated it stays licensed
// offline forever (see license-gate.js for why gating reads persisted state).
//
// The licenses endpoints are public by design (no API secret), so nothing
// here is worth hiding and nothing secret ships in this public repo. The key
// itself is stored through ConfigStore.setSecret like the cloud API keys.

const LICENSE_API_BASE = 'https://api.lemonsqueezy.com/v1/licenses';

// Keys arrive from email copy-paste: strip whitespace and stray quotes.
function cleanLicenseKey(raw) {
  return String(raw || '').trim().replace(/^["']+|["']+$/g, '').trim();
}

class LicenseService {
  constructor({ config, fetchImpl = fetch, timeoutMs = 12000, instanceName = '' } = {}) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    // The instance name shows in the Lemon Squeezy dashboard so a buyer can
    // tell their PCs apart when a seat needs freeing. Sent only on activate.
    this.instanceName = instanceName || os.hostname() || 'Windows PC';
  }

  state() {
    return this.config.getSettings().license || { status: 'none' };
  }

  async activate(rawKey) {
    const key = cleanLicenseKey(rawKey);
    if (!key) return { ok: false, message: 'Paste your JARVIS Pro license key first.' };
    const result = await this.#post('activate', { license_key: key, instance_name: this.instanceName });
    if (result.offline) {
      return { ok: false, offline: true, message: 'Could not reach Lemon Squeezy. Check your internet connection and try again — nothing was changed.' };
    }
    const payload = result.payload;
    if (!payload || payload.activated !== true) {
      return { ok: false, message: this.#friendlyError(payload, 'That key could not be activated.') };
    }
    this.config.setSecret('licenseKey', key);
    const customerName = String(payload.meta?.customer_name || '').trim();
    this.config.setLicenseState({
      status: 'active',
      productName: String(payload.meta?.product_name || 'JARVIS Pro'),
      customerName,
      activatedAt: new Date().toISOString(),
      instanceId: String(payload.instance?.id || ''),
      lastValidatedAt: new Date().toISOString()
    });
    return { ok: true, message: `Licensed${customerName ? ` to ${customerName}` : ''}. All Pro features are unlocked on this PC.` };
  }

  // VALIDATE button only. Downgrades the stored status ONLY on an explicit
  // answer from Lemon Squeezy that the key is no longer good (refund, disable,
  // expiry). A network failure changes nothing: offline users stay licensed.
  async validate() {
    const key = cleanLicenseKey(this.config.getSecret('licenseKey'));
    if (!key) return { ok: false, message: 'No license key is saved on this PC.' };
    const current = this.state();
    const body = { license_key: key };
    if (current.instanceId) body.instance_id = current.instanceId;
    const result = await this.#post('validate', body);
    if (result.offline) {
      return { ok: false, offline: true, message: 'Could not reach Lemon Squeezy — you stay licensed. Try again when you are online.' };
    }
    const payload = result.payload;
    if (payload && payload.valid === true) {
      this.config.setLicenseState({ ...current, status: 'active', lastValidatedAt: new Date().toISOString() });
      return { ok: true, message: 'Your license is valid.' };
    }
    // An explicit "not valid" — the only path that ever downgrades.
    const status = String(payload?.license_key?.status || 'disabled');
    this.config.setLicenseState({ ...current, status: status === 'active' ? 'disabled' : status, lastValidatedAt: new Date().toISOString() });
    return { ok: false, message: this.#friendlyError(payload, 'Lemon Squeezy says this key is no longer valid.') };
  }

  // Frees this PC's seat so the key can be used on another machine.
  async deactivate() {
    const key = cleanLicenseKey(this.config.getSecret('licenseKey'));
    const current = this.state();
    if (!key || !current.instanceId) return { ok: false, message: 'There is no active license on this PC.' };
    const result = await this.#post('deactivate', { license_key: key, instance_id: current.instanceId });
    if (result.offline) {
      return { ok: false, offline: true, message: 'Could not reach Lemon Squeezy, so the seat was not freed. You are still licensed on this PC — try again when you are online.' };
    }
    const payload = result.payload;
    const seatAlreadyGone = /instance not found/i.test(String(payload?.error || ''));
    if (!payload || (payload.deactivated !== true && !seatAlreadyGone)) {
      return { ok: false, message: this.#friendlyError(payload, 'Lemon Squeezy did not release this seat.') };
    }
    this.config.setSecret('licenseKey', '');
    this.config.setLicenseState({ status: 'none', productName: '', customerName: '', activatedAt: '', instanceId: '', lastValidatedAt: '' });
    return { ok: true, message: 'License removed from this PC. The seat is free for another machine.' };
  }

  #friendlyError(payload, fallback) {
    const raw = String(payload?.error || '').trim();
    if (!raw) return fallback;
    if (/activation limit/i.test(raw)) {
      return 'This key has reached its PC limit. Open JARVIS on the old PC and press DEACTIVATE there to free the seat, then try again.';
    }
    return raw;
  }

  // Form-encoded POST per the Lemon Squeezy License API. Errors come back as
  // 4xx with a JSON body, so the body is read regardless of response.ok; only
  // a transport failure (no connection, timeout) counts as offline.
  async #post(action, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${LICENSE_API_BASE}/${action}`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body).toString(),
        signal: controller.signal
      });
      const payload = await response.json().catch(() => null);
      return { payload };
    } catch {
      return { offline: true };
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = { LicenseService, cleanLicenseKey };
