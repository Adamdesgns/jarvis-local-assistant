// The mobile companion's HTTP + SSE server. Binds ONLY to the Tailscale
// interface (100.64.0.0/10) plus loopback; refuses to start without one.
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// Tailscale hands out CGNAT addresses: 100.64.0.0/10 → 100.64.0.0–100.127.255.255.
function pickBindAddress(interfaces = os.networkInterfaces()) {
  for (const list of Object.values(interfaces)) {
    for (const entry of list || []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      const [a, b] = entry.address.split('.').map(Number);
      if (a === 100 && b >= 64 && b <= 127) return entry.address;
    }
  }
  return null;
}

function sseFrame(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

async function readBody(req, limit = 10 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Body too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const UPLOAD_BODY_LIMIT = 25 * 1024 * 1024;

class MobileServer {
  constructor({ config, router, transcribe, auth, staticDir, documents, getCameras, onDevicesChanged = () => {} }) {
    this.config = config; this.router = router; this.transcribe = transcribe;
    this.auth = auth; this.staticDir = staticDir; this.documents = documents; this.onDevicesChanged = onDevicesChanged;
    // Lazy getter: `cameras` may not exist yet at MobileServer construction
    // time (main.js builds it after), or may never exist (no cameras set up
    // at all) — same pattern as buildToolRegistry's getCameras for look_at_camera.
    this.getCameras = typeof getCameras === 'function' ? getCameras : () => undefined;
    this.server = null; this.reason = ''; this.address = null; this.port = null;
    this.streams = new Map();   // deviceId → Set<res>
    this.lastReply = new Map(); // deviceId → { reply, at }
  }

  json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }

  pushEvent(deviceId, event, data) {
    for (const res of this.streams.get(deviceId) || []) { try { res.write(sseFrame(event, data)); } catch {} }
  }

  async handleRequest(req, res) {
    try {
      const ip = req.socket?.remoteAddress || '';
      const url = String(req.url || '/');
      const pathname = url.split('?')[0];
      if (pathname === '/api/pair' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)).toString() || '{}');
        const claimed = this.auth.claimPairing(body.code, body.name, ip);
        if (!claimed) return this.json(res, 403, { error: 'Pairing code is wrong or expired. Start pairing again in Settings.' });
        this.onDevicesChanged();
        return this.json(res, 200, { key: claimed.key, name: claimed.device.name });
      }
      if (pathname.startsWith('/api/')) {
        // EventSource can't set headers, so /api/events alone also accepts ?key=.
        let authHeader = req.headers.authorization;
        if (pathname === '/api/events' && !authHeader) {
          const query = new URLSearchParams(url.split('?')[1] || '');
          const queryKey = query.get('key');
          if (queryKey) authHeader = `Bearer ${queryKey}`;
        }
        const device = this.auth.verify(authHeader, ip);
        if (!device) return this.json(res, 401, { error: 'Not paired.' });
        if (pathname === '/api/chat' && req.method === 'POST') {
          const body = JSON.parse((await readBody(req)).toString() || '{}');
          return this.#chat(res, device, String(body.text || ''));
        }
        if (pathname === '/api/voice' && req.method === 'POST') {
          const audio = await readBody(req);
          const out = await this.transcribe(audio, req.headers['content-type'] || 'audio/mp4');
          const transcript = (typeof out === 'string' ? out : out?.text || '').trim();
          if (!transcript) return this.json(res, 422, { error: "I couldn't make that out — try again closer to the mic." });
          return this.#chat(res, device, transcript, transcript);
        }
        if (pathname === '/api/last') return this.json(res, 200, this.lastReply.get(device.id) || { reply: null });
        if (pathname === '/api/folders' && req.method === 'GET') {
          return this.json(res, 200, { folders: this.documents.approvedRoots() });
        }
        if (pathname === '/api/upload' && req.method === 'POST') {
          return this.#upload(req, res);
        }
        if (pathname === '/api/cameras' && req.method === 'GET') {
          return this.#camerasList(res);
        }
        if (pathname === '/api/cameras/snapshot' && req.method === 'GET') {
          return this.#cameraSnapshot(url, res);
        }
        if (pathname === '/api/events') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
          const set = this.streams.get(device.id) || new Set();
          set.add(res); this.streams.set(device.id, set);
          req.on('close', () => set.delete(res));
          return;
        }
        return this.json(res, 404, { error: 'Unknown endpoint.' });
      }
      return this.#static(pathname === '/' ? '/index.html' : pathname, res);
    } catch (error) {
      return this.json(res, 500, { error: error.message });
    }
  }

  async #chat(res, device, text, transcript = null) {
    // remote: the person is on their phone, not at the desk. Capabilities
    // that need eyes on the desktop (screen driving) refuse on this flag.
    const result = await this.router.handle(text, 'general', {
      remote: true,
      onStep: (step) => this.pushEvent(device.id, 'agent-step', step)
    });
    let reply;
    if (result?.approval) {
      // Confirming/declining risky actions only makes sense at the desktop —
      // the phone has no UI for it. Decline the pending entry so it doesn't
      // sit around waiting to expire, and tell the phone where to look.
      reply = 'Run that one at the desktop, sir.';
      if (typeof this.router.resolveApproval === 'function') {
        try { await this.router.resolveApproval(result.approval.id, false); } catch {}
      }
    } else {
      reply = result?.response || result?.text || 'No response.';
    }
    this.lastReply.set(device.id, { reply, at: Date.now() });
    this.pushEvent(device.id, 'reply', { reply });
    return this.json(res, 200, transcript ? { transcript, reply } : { reply });
  }

  // Same one-file-per-POST, raw-binary-body pattern as /api/voice — there is
  // no multipart parser in this repo. Metadata rides in headers because a raw
  // body can't carry a filename. This writes bytes to the owner's disk from a
  // network client, so every check below is load-bearing: don't trim any of
  // them for convenience.
  async #upload(req, res) {
    const filename = String(req.headers['x-filename'] || '').trim();
    const destination = String(req.headers['x-destination'] || '').trim();
    if (!filename) return this.json(res, 400, { ok: false, error: 'Missing filename.' });
    if (!destination) return this.json(res, 400, { ok: false, error: 'Missing destination.' });
    if (!this.documents.isAllowed(destination)) {
      return this.json(res, 400, { ok: false, error: 'That destination is outside your approved folders.' });
    }
    let buffer;
    try {
      buffer = await readBody(req, UPLOAD_BODY_LIMIT);
    } catch {
      return this.json(res, 413, { ok: false, error: 'That file is larger than the 25 MB upload limit.' });
    }
    try {
      const result = await this.documents.createBinaryFile(destination, filename, buffer);
      return this.json(res, 200, { ok: true, path: result.path });
    } catch (error) {
      // Never hand the phone a raw error message — it can carry the
      // absolute server-side path. Log the detail here instead.
      console.error('[mobile-server] upload failed:', error);
      return this.json(res, 400, { ok: false, error: "Couldn't save that file. Check the destination folder and try again." });
    }
  }

  // Only what the phone needs to render a list — never the raw driver
  // camera object, which can carry account internals we don't want to ship
  // over the wire.
  async #camerasList(res) {
    const cameras = this.getCameras();
    if (!cameras) return this.json(res, 200, { cameras: [] });
    let list = [];
    try { list = (await cameras.listCameras()) || []; } catch { list = []; }
    return this.json(res, 200, { cameras: list.map((camera) => ({ key: camera.key, name: camera.name })) });
  }

  // Raw JPEG bytes, not base64-in-JSON: snapshots can be hundreds of KB and
  // base64 through a synchronous JSON.stringify write adds real latency over
  // cellular. Cache-Control: no-store because a stale cached still would be
  // actively misleading for a security camera.
  async #cameraSnapshot(url, res) {
    const cameras = this.getCameras();
    if (!cameras) return this.json(res, 404, { error: 'No cameras are configured.' });
    const query = new URLSearchParams(url.split('?')[1] || '');
    const key = query.get('key') || '';
    if (!key) return this.json(res, 400, { error: 'Missing camera key.' });
    let shot;
    try {
      shot = await cameras.getSnapshot(key, { manual: true });
    } catch (error) {
      return this.json(res, 500, { error: error.message });
    }
    if (!shot || !shot.ok || !shot.jpegBase64) {
      return this.json(res, 404, { error: shot?.message || 'Could not get a picture.' });
    }
    const buffer = Buffer.from(shot.jpegBase64, 'base64');
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
    res.end(buffer);
  }

  #static(url, res) {
    const safe = path.normalize(url).replace(/^([.][.][/\\])+/, '');
    const file = path.join(this.staticDir, safe);
    const rel = path.relative(this.staticDir, file);
    if (rel.startsWith('..') || path.isAbsolute(rel) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  }

  async start() {
    const settings = this.config.getSettings();
    const address = pickBindAddress();
    if (!address) { this.reason = 'Tailscale is not running on this PC. Install/start Tailscale, then flip the toggle again.'; return { ok: false, reason: this.reason }; }
    const port = Number(settings.mobilePort) || 27183;
    const handler = (req, res) => this.handleRequest(req, res);
    return new Promise((resolve) => {
      this.server = http.createServer(handler);
      this.server.on('error', (error) => { this.reason = `Could not start on port ${port}: ${error.message}`; this.server = null; resolve({ ok: false, reason: this.reason }); });
      this.server.listen(port, address, () => {
        // Also answer on loopback so `tailscale serve` can put a real HTTPS
        // certificate in front of us: iPhone Safari refuses microphone access
        // on any page that is not HTTPS, so plain tailnet HTTP can chat but
        // never listen. Loopback reaches this machine only, so this does not
        // widen network exposure — the tailnet bind above is still the only
        // way in from another device.
        this.loopback = http.createServer(handler);
        this.loopback.on('error', () => { this.loopback = null; });
        this.loopback.listen(port, '127.0.0.1', () => {});
        this.address = address; this.port = port; this.reason = '';
        resolve({ ok: true, address, port });
      });
    });
  }

  stop() {
    for (const set of this.streams.values()) {
      for (const res of set) { try { res.end(); } catch {} }
    }
    this.streams.clear();
    try { this.server?.close(); } catch {}
    try { this.loopback?.close(); } catch {}
    this.server = null; this.loopback = null; this.address = null;
  }
  status() { return { running: !!this.server, address: this.address, port: this.port, reason: this.reason }; }
}

module.exports = { pickBindAddress, sseFrame, MobileServer };
