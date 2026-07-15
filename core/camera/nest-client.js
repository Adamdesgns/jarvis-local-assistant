// Google Smart Device Management (Nest) — the one official cloud camera API
// in this module. The user brings their own Device Access project ($5 one-time
// Google fee) and OAuth client; JARVIS never ships shared Google credentials.
const SDM_BASE = 'https://smartdevicemanagement.googleapis.com/v1';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/sdm.service';

function authUrl({ projectId, clientId, redirectUri }) {
  const params = new URLSearchParams({
    redirect_uri: redirectUri,
    access_type: 'offline',
    prompt: 'consent',
    client_id: clientId,
    response_type: 'code',
    scope: SCOPE
  });
  return `https://nestservices.google.com/partnerconnections/${encodeURIComponent(projectId)}/auth?${params}`;
}

async function tokenRequest(body, fetchFn) {
  const response = await (fetchFn || globalThis.fetch)(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString()
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error_description || payload?.error || 'Google sign-in failed.');
  return payload;
}

async function exchangeCode({ clientId, clientSecret, code, redirectUri, fetchFn }) {
  const payload = await tokenRequest({
    client_id: clientId, client_secret: clientSecret, code,
    grant_type: 'authorization_code', redirect_uri: redirectUri
  }, fetchFn);
  return {
    refreshToken: payload.refresh_token,
    accessToken: payload.access_token,
    expiresAt: Date.now() + (Number(payload.expires_in) || 3600) * 1000
  };
}

async function refreshAccessToken({ clientId, clientSecret, refreshToken, fetchFn }) {
  const payload = await tokenRequest({
    client_id: clientId, client_secret: clientSecret,
    refresh_token: refreshToken, grant_type: 'refresh_token'
  }, fetchFn);
  return {
    accessToken: payload.access_token,
    expiresAt: Date.now() + (Number(payload.expires_in) || 3600) * 1000
  };
}

async function sdmRequest(session, pathname, options = {}) {
  const response = await (session.fetchFn || globalThis.fetch)(`${SDM_BASE}${pathname}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.accessToken}`, ...(options.headers || {}) }
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || 'Nest did not answer.');
  return payload;
}

// Only devices that can actually stream become camera tiles.
async function listDevices(session, projectId) {
  const payload = await sdmRequest(session, `/enterprises/${encodeURIComponent(projectId)}/devices`);
  return (payload.devices || [])
    .filter((device) => device.traits?.['sdm.devices.traits.CameraLiveStream'])
    .map((device) => ({
      id: String(device.name || '').split('/').pop(),
      name: device.traits?.['sdm.devices.traits.Info']?.customName
        || device.parentRelations?.[0]?.displayName
        || 'Nest camera',
      protocols: device.traits['sdm.devices.traits.CameraLiveStream'].supportedProtocols || []
    }));
}

async function executeCommand(session, projectId, deviceId, command, params) {
  const payload = await sdmRequest(session, `/enterprises/${encodeURIComponent(projectId)}/devices/${encodeURIComponent(deviceId)}:executeCommand`, {
    method: 'POST',
    body: JSON.stringify({ command, params })
  });
  return payload.results || {};
}

async function generateWebRtcStream(session, projectId, deviceId, offerSdp) {
  const results = await executeCommand(session, projectId, deviceId, 'sdm.devices.commands.CameraLiveStream.GenerateWebRtcStream', { offerSdp });
  return { answerSdp: results.answerSdp, mediaSessionId: results.mediaSessionId };
}

async function generateRtspStream(session, projectId, deviceId) {
  const results = await executeCommand(session, projectId, deviceId, 'sdm.devices.commands.CameraLiveStream.GenerateRtspStream', {});
  return { rtspUrl: results.streamUrls?.rtspUrl };
}

module.exports = { authUrl, exchangeCode, refreshAccessToken, listDevices, generateWebRtcStream, generateRtspStream };
