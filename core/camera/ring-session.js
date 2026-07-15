// Thin wrapper around ring-client-api so the Ring driver can be unit-tested
// with fakes. Known accepted advisory: werift (ring-client-api's WebRTC
// stack) depends on the `ip` package (GHSA-2p57-rm9w-gvfp, disputed, no
// patched release). It does not process untrusted input in our usage —
// JARVIS only negotiates WebRTC with Ring's own cloud.

// Sign in with email/password. Ring always requires a 2FA code on a new
// device: the first call returns {needs2fa, prompt}; call again with `code`.
async function ringLogin({ email, password, code }) {
  const { RingRestClient } = require('ring-client-api/rest-client');
  const client = new RingRestClient({ email, password, controlCenterDisplayName: 'JARVIS' });
  try {
    if (code) {
      const auth = await client.getAuth(String(code).trim());
      return { refreshToken: auth.refresh_token };
    }
    const auth = await client.getCurrentAuth();
    return { refreshToken: auth.refresh_token };
  } catch (error) {
    if (client.using2fa || client.promptFor2fa) {
      return { needs2fa: true, prompt: client.promptFor2fa || 'Enter the code Ring sent you.' };
    }
    throw new Error(error?.message || 'Ring sign-in failed.');
  }
}

// Build the live API from a stored refresh token. Ring rotates the token on
// every connection — onTokenUpdate MUST persist it or the account breaks.
function createRingApi({ refreshToken, onTokenUpdate }) {
  const { RingApi } = require('ring-client-api');
  const api = new RingApi({ refreshToken, controlCenterDisplayName: 'JARVIS' });
  api.onRefreshTokenUpdated.subscribe(({ newRefreshToken }) => {
    if (newRefreshToken) onTokenUpdate(newRefreshToken);
  });
  return api;
}

module.exports = { ringLogin, createRingApi };
