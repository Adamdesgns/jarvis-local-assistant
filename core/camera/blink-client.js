// Minimal REST client for Blink's unofficial API, endpoints per the
// community-documented protocol (github.com/MattTW/BlinkMonitorProtocol,
// verified 2026-07-14). Amazon can change this at any time: every failure
// must bubble up with the server's message so the UI can show a clear state.
const LOGIN_HOST = 'https://rest-prod.immedia-semi.com';

class BlinkClient {
  constructor({ fetchFn = globalThis.fetch } = {}) {
    this.fetchFn = fetchFn;
  }

  host(tier) { return `https://rest-${tier}.immedia-semi.com`; }

  async #json(response) {
    try { return await response.json(); } catch { return {}; }
  }

  async #request(url, { method = 'GET', token, body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['TOKEN-AUTH'] = token;
    const response = await this.fetchFn(url, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (!response.ok) {
      const payload = await this.#json(response);
      throw new Error(payload.message || `Blink answered with error ${response.status}`);
    }
    return response;
  }

  async login({ email, password, uniqueId }) {
    const response = await this.#request(`${LOGIN_HOST}/api/v5/account/login`, {
      method: 'POST',
      body: {
        email,
        password,
        unique_id: uniqueId,
        device_identifier: 'JARVIS Windows Assistant',
        client_name: 'JARVIS',
        reauth: 'true'
      }
    });
    const payload = await this.#json(response);
    return {
      token: payload.auth?.token || '',
      accountId: payload.account?.account_id,
      clientId: payload.account?.client_id,
      tier: payload.account?.tier || 'prod',
      verificationRequired: Boolean(payload.account?.client_verification_required)
    };
  }

  async verifyPin(session, pin) {
    const url = `${this.host(session.tier)}/api/v4/account/${session.accountId}/client/${session.clientId}/pin/verify`;
    const response = await this.#request(url, { method: 'POST', token: session.token, body: { pin: String(pin || '').trim() } });
    const payload = await this.#json(response);
    return { ok: payload.valid !== false, message: payload.message || '' };
  }

  async homescreen(session) {
    const url = `${this.host(session.tier)}/api/v3/accounts/${session.accountId}/homescreen`;
    const response = await this.#request(url, { token: session.token });
    return this.#json(response);
  }

  async requestThumbnail(session, networkId, cameraId, kind = 'camera') {
    const base = this.host(session.tier);
    const url = kind === 'owl'
      ? `${base}/api/v1/accounts/${session.accountId}/networks/${networkId}/owls/${cameraId}/thumbnail`
      : kind === 'doorbell'
        ? `${base}/api/v1/accounts/${session.accountId}/networks/${networkId}/doorbells/${cameraId}/thumbnail`
        : `${base}/network/${networkId}/camera/${cameraId}/thumbnail`;
    await this.#request(url, { method: 'POST', token: session.token });
  }

  async getImage(session, path) {
    const suffix = /\.jpe?g$/i.test(path) ? '' : '.jpg';
    const response = await this.#request(`${this.host(session.tier)}${path}${suffix}`, { token: session.token });
    return Buffer.from(await response.arrayBuffer());
  }

  async setArmed(session, networkId, armed) {
    const url = `${this.host(session.tier)}/api/v1/accounts/${session.accountId}/networks/${networkId}/state/${armed ? 'arm' : 'disarm'}`;
    await this.#request(url, { method: 'POST', token: session.token });
  }
}

module.exports = { BlinkClient };
