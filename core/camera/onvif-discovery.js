function defaultProbe() {
  const { Discovery } = require('onvif');
  return new Promise((resolve, reject) => {
    Discovery.probe({ timeout: 5000, resolve: false }, (error, cams) => {
      if (error) return reject(error);
      resolve((cams || []).map((cam) => ({
        hostname: cam.hostname || cam.address || '',
        name: cam.name || ''
      })));
    });
  });
}

// Finds ONVIF cameras on the local network. Read-only: it never signs in
// and never stores anything — the user completes the RTSP address manually.
async function discoverCameras({ probeFn = defaultProbe } = {}) {
  try {
    const found = await probeFn();
    const byAddress = new Map();
    for (const cam of found) {
      const address = String(cam.hostname || '').trim();
      if (!address || byAddress.has(address)) continue;
      byAddress.set(address, { address, name: String(cam.name || '').trim() || `Camera at ${address}` });
    }
    return [...byAddress.values()];
  } catch {
    return [];
  }
}

module.exports = { discoverCameras };
