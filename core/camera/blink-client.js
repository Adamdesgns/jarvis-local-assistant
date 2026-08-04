// Minimal REST client for Blink's unofficial API.
//
// Sign-in is Blink's OAuth 2.0 authorization-code flow with PKCE, the same one
// the phone apps use (protocol mirrored from github.com/fronzbot/blinkpy,
// verified against Blink's live servers 2026-08-04). Two dead ends are already
// closed off, so don't reopen them:
//
//  1. The old /api/v5/account/login endpoint JARVIS used until now is gone.
//     Blink answers every request to it with 426 "An app update is required"
//     before it ever looks at the password.
//  2. Posting the password to /oauth/v2/signin from code does not work either.
//     api.oauth.blink.com sits behind Cloudflare bot management, which answers
//     406 Not Acceptable to any scripted POST while GETs sail through. Verified
//     invariant across csrf/password/header/Accept variations and from two
//     different HTTP clients, so it is an edge block, not our request shape.
//
// So the password step happens in a real Chromium window on Blink's own page
// (see blink-oauth.js) and this client only builds the authorize URL and trades
// the returned code for tokens. JARVIS never sees the Blink password at all,
// and Blink's page handles its own 2FA. The token endpoints are NOT blocked.
//
// Amazon can change this at any time: every failure must bubble up with the
// server's message so the UI can show a clear state.
const crypto = require('crypto');

const OAUTH_HOST = 'https://api.oauth.blink.com';
const AUTHORIZE_URL = `${OAUTH_HOST}/oauth/v2/authorize`;
const TOKEN_URL = `${OAUTH_HOST}/oauth/token`;
const TIER_URL = 'https://rest-prod.immedia-semi.com/api/v1/users/tier_info';

const TOKEN_USER_AGENT = 'Blink/2511191620 CFNetwork/3860.200.71 Darwin/25.1.0';
const REST_USER_AGENT = '27.0ANDROID_28373244';

const CLIENT_ID = 'ios';
const REDIRECT_URI = 'immedia-blink://applinks.blink.com/signin/callback';
const SCOPE = 'client';
// Refresh this far ahead of expiry so a long call can't run out mid-flight.
const REFRESH_MARGIN_MS = 60000;

class BlinkClient {
  constructor({ fetchFn = globalThis.fetch, randomBytes = crypto.randomBytes } = {}) {
    this.fetchFn = fetchFn;
    this.randomBytes = randomBytes;
  }

  host(tier) { return `https://rest-${tier}.immedia-semi.com`; }

  async #json(response) {
    try { return await response.json(); } catch { return {}; }
  }

  // Authenticated calls against the account's regional REST host.
  async #request(url, { method = 'GET', token, body } = {}) {
    const headers = { 'Content-Type': 'application/json', 'User-Agent': REST_USER_AGENT };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await this.fetchFn(url, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (!response.ok) {
      const payload = await this.#json(response);
      throw new Error(payload.message || `Blink answered with error ${response.status}`);
    }
    return response;
  }

  #pkce() {
    const verifier = this.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge };
  }

  // The page a real browser window opens for the password step. The verifier
  // never leaves JARVIS — only its hash goes to Blink — so the code Blink hands
  // back is worthless to anyone who intercepts it.
  authorizeRequest({ hardwareId }) {
    const { verifier, challenge } = this.#pkce();
    const query = new URLSearchParams({
      app_brand: 'blink',
      app_version: '50.1',
      client_id: CLIENT_ID,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      device_brand: 'Apple',
      device_model: 'iPhone16,1',
      device_os_version: '26.1',
      hardware_id: hardwareId,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: SCOPE
    });
    return { url: `${AUTHORIZE_URL}?${query}`, verifier, redirectUri: REDIRECT_URI };
  }

  // Pull the authorization code out of the redirect Blink sends the window to.
  static codeFromRedirect(url) {
    if (!String(url || '').startsWith(REDIRECT_URI)) return null;
    const query = String(url).split('?')[1] || '';
    return new URLSearchParams(query).get('code');
  }

  // Trade the code for the tokens JARVIS actually stores.
  async exchangeCode({ code, verifier, hardwareId }) {
    const body = new URLSearchParams({
      app_brand: 'blink',
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      hardware_id: hardwareId,
      redirect_uri: REDIRECT_URI,
      scope: SCOPE
    });
    return this.#token(body);
  }

  async #token(body) {
    const response = await this.fetchFn(TOKEN_URL, {
      method: 'POST',
      headers: {
        'User-Agent': TOKEN_USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: '*/*'
      },
      body: body.toString()
    });
    if (response.status !== 200) {
      const payload = await this.#json(response);
      throw new Error(payload.message || payload.error_description
        || `Blink refused to issue a session (error ${response.status}).`);
    }
    return this.#json(response);
  }

  // Which regional host and account the tokens belong to.
  async tierInfo(token) {
    const response = await this.#request(TIER_URL, { token });
    const payload = await this.#json(response);
    const tier = payload.tier || payload.region_id;
    if (!tier) throw new Error('Blink did not say which region this account lives in.');
    return { tier, accountId: payload.account_id };
  }

  // Turn a raw token response into the shape JARVIS stores.
  async session(tokens) {
    const token = tokens.access_token;
    if (!token) throw new Error('Blink returned a session with no access token.');
    const { tier, accountId } = await this.tierInfo(token);
    return {
      token,
      refreshToken: tokens.refresh_token || '',
      expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000,
      tier,
      accountId
    };
  }

  async refreshSession({ refreshToken, hardwareId }) {
    const tokens = await this.#token(new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
      scope: SCOPE,
      hardware_id: hardwareId
    }));
    return this.session(tokens);
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

module.exports = { BlinkClient, REFRESH_MARGIN_MS };
