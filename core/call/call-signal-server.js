// The inbound half of signaling: five endpoints on the Tailscale line, in
// the mobile-server.js mold. Binds ONLY the Tailscale interface plus
// loopback, refuses to start without one, and answers nothing but the
// pairing claim until a peer is stored. No SSE here — the renderer lives in
// the same app and hears everything over IPC via onSignal.
'use strict';
const http = require('node:http');
const { pickBindAddress } = require('../mobile-server');

const DEFAULT_PORT = 27184;

async function readBody(req, limit = 256 * 1024) {   // SDP + ICE are small; nothing here is a file
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Body too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

class CallSignalServer {
  constructor({ config, auth, session, ourName = () => 'JARVIS', onSignal = () => {}, bindAddress = pickBindAddress } = {}) {
    this.config = config; this.auth = auth; this.session = session;
    this.ourName = ourName; this.onSignal = onSignal; this.bindAddress = bindAddress;
    this.server = null; this.loopback = null;
    this.address = null; this.port = null; this.reason = '';
  }

  json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }

  async handleRequest(req, res) {
    try {
      const ip = req.socket?.remoteAddress || '';
      const pathname = String(req.url || '/').split('?')[0];
      if (pathname === '/call/pair' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)).toString() || '{}');
        const claimed = this.auth.claimPairing(body.code, body.name, ip);
        if (!claimed) return this.json(res, 403, { reason: 'Pairing code is wrong or expired. Start pairing again in Settings.' });
        this.onSignal('paired', { peer: { name: claimed.peer.name, host: claimed.peer.host } });
        return this.json(res, 200, { secret: claimed.secret, name: this.ourName() });
      }
      if (!pathname.startsWith('/call/')) return this.json(res, 404, { reason: 'Unknown endpoint.' });
      const peer = this.auth.verify(req.headers.authorization, ip);
      if (!peer) return this.json(res, 403, { reason: 'Not paired.' });

      if (pathname === '/call/ping' && req.method === 'GET') {
        return this.json(res, 200, { name: this.ourName(), state: this.session.status().state });
      }
      const body = req.method === 'POST' ? JSON.parse((await readBody(req)).toString() || '{}') : {};
      if (pathname === '/call/offer' && req.method === 'POST') {
        const callId = String(body.callId || '');
        const kind = body.kind === 'control' ? 'control' : 'call';
        const rang = this.session.incomingOffer(callId);
        if (!rang.ok) return this.json(res, 409, { reason: rang.reason });
        this.onSignal('incoming', { callId, kind, sdp: String(body.sdp || ''), autoAnswerAt: rang.autoAnswerAt });
        return this.json(res, 200, { ok: true, autoAnswerAt: rang.autoAnswerAt });
      }
      if (pathname === '/call/answer' && req.method === 'POST') {
        this.session.peerAnswered(body.callId);
        this.onSignal('answered', { callId: String(body.callId || ''), sdp: String(body.sdp || '') });
        return this.json(res, 200, { ok: true });
      }
      if (pathname === '/call/ice' && req.method === 'POST') {
        this.onSignal('ice', { callId: String(body.callId || ''), candidate: body.candidate || null });
        return this.json(res, 200, { ok: true });
      }
      if (pathname === '/call/hangup' && req.method === 'POST') {
        this.session.end(String(body.reason || 'hangup'));
        return this.json(res, 200, { ok: true });
      }
      return this.json(res, 404, { reason: 'Unknown endpoint.' });
    } catch (error) {
      return this.json(res, 500, { reason: 'That request went sideways. Try again.' });
    }
  }

  async start() {
    const settings = this.config.getSettings();
    const address = this.bindAddress();
    if (!address) { this.reason = 'Tailscale is not running on this PC. Start Tailscale, then try again.'; return { ok: false, reason: this.reason }; }
    const port = Number.isFinite(Number(settings.callPort)) ? Number(settings.callPort) : DEFAULT_PORT;
    const handler = (req, res) => this.handleRequest(req, res);
    return new Promise((resolve) => {
      this.server = http.createServer(handler);
      this.server.on('error', (error) => { this.reason = `Could not start on port ${port}: ${error.message}`; this.server = null; resolve({ ok: false, reason: this.reason }); });
      this.server.listen(port, address, () => {
        const bound = this.server.address().port;      // resolves port 0 in tests
        if (address !== '127.0.0.1') {
          this.loopback = http.createServer(handler);
          this.loopback.on('error', () => { this.loopback = null; });
          this.loopback.listen(bound, '127.0.0.1', () => {});
        }
        this.address = address; this.port = bound; this.reason = '';
        resolve({ ok: true, address, port: bound });
      });
    });
  }

  stop() {
    try { this.server?.close(); } catch {}
    try { this.loopback?.close(); } catch {}
    this.server = null; this.loopback = null; this.address = null;
  }

  status() { return { running: !!this.server, address: this.address, port: this.port, reason: this.reason }; }
}

module.exports = { CallSignalServer, DEFAULT_PORT };
