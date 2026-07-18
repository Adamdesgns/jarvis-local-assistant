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

class MobileServer {
  constructor({ config, router, transcribe, auth, staticDir, onDevicesChanged = () => {} }) {
    this.config = config; this.router = router; this.transcribe = transcribe;
    this.auth = auth; this.staticDir = staticDir; this.onDevicesChanged = onDevicesChanged;
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
      if (url === '/api/pair' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)).toString() || '{}');
        const claimed = this.auth.claimPairing(body.code, body.name);
        if (!claimed) return this.json(res, 403, { error: 'Pairing code is wrong or expired. Start pairing again in Settings.' });
        this.onDevicesChanged();
        return this.json(res, 200, { key: claimed.key, name: claimed.device.name });
      }
      if (url.startsWith('/api/')) {
        const device = this.auth.verify(req.headers.authorization, ip);
        if (!device) return this.json(res, 401, { error: 'Not paired.' });
        if (url === '/api/chat' && req.method === 'POST') {
          const body = JSON.parse((await readBody(req)).toString() || '{}');
          return this.#chat(res, device, String(body.text || ''));
        }
        if (url === '/api/voice' && req.method === 'POST') {
          const audio = await readBody(req);
          const out = await this.transcribe(audio, req.headers['content-type'] || 'audio/mp4');
          const transcript = (typeof out === 'string' ? out : out?.text || '').trim();
          if (!transcript) return this.json(res, 422, { error: "I couldn't make that out — try again closer to the mic." });
          return this.#chat(res, device, transcript, transcript);
        }
        if (url === '/api/last') return this.json(res, 200, this.lastReply.get(device.id) || { reply: null });
        if (url === '/api/events') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
          const set = this.streams.get(device.id) || new Set();
          set.add(res); this.streams.set(device.id, set);
          req.on('close', () => set.delete(res));
          return;
        }
        return this.json(res, 404, { error: 'Unknown endpoint.' });
      }
      return this.#static(url === '/' ? '/index.html' : url, res);
    } catch (error) {
      return this.json(res, 500, { error: error.message });
    }
  }

  async #chat(res, device, text, transcript = null) {
    const result = await this.router.handle(text, 'general', {
      onStep: (step) => this.pushEvent(device.id, 'agent-step', step)
    });
    const reply = result?.response || result?.text || 'No response.';
    this.lastReply.set(device.id, { reply, at: Date.now() });
    this.pushEvent(device.id, 'reply', { reply });
    return this.json(res, 200, transcript ? { transcript, reply } : { reply });
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
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));
      this.server.on('error', (error) => { this.reason = `Could not start on port ${port}: ${error.message}`; this.server = null; resolve({ ok: false, reason: this.reason }); });
      this.server.listen(port, address, () => {
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
    this.server = null; this.address = null;
  }
  status() { return { running: !!this.server, address: this.address, port: this.port, reason: this.reason }; }
}

module.exports = { pickBindAddress, sseFrame, MobileServer };
