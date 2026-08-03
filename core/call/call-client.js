// The outbound half of signaling: five tiny POST/GETs to the peer's
// signal server. Everything resolves to {ok, ...} — a dead peer is a
// normal answer here ("JR is offline"), never an exception, and raw
// network error text never crosses into the UI.
'use strict';

const DEFAULT_PORT = 27184;
const TIMEOUT_MS = 5000;

class CallClient {
  constructor({ getPeer, port = DEFAULT_PORT, fetchFn = fetch, timeoutMs = TIMEOUT_MS } = {}) {
    this.getPeer = typeof getPeer === 'function' ? getPeer : () => null;
    this.port = port; this.fetchFn = fetchFn; this.timeoutMs = timeoutMs;
  }

  async #request(host, path, { method = 'POST', body = null, secret = null } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (secret) headers.Authorization = `Bearer ${secret}`;
    const controller = new AbortController();
    const kill = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(`http://${host}:${this.port}/call/${path}`, {
        method, headers, signal: controller.signal,
        body: body === null ? undefined : JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, reason: data.reason || data.error || 'The other side said no.' };
      return { ok: true, ...data };
    } catch {
      return { ok: false, reason: "Couldn't reach the other PC. It may be off, or Tailscale may be down." };
    } finally {
      clearTimeout(kill);
    }
  }

  async #toPeer(path, body = null, method = 'POST') {
    const peer = this.getPeer();
    if (!peer) return { ok: false, reason: 'Not paired yet. Pair the two PCs in Settings first.' };
    return this.#request(peer.host, path, { method, body, secret: peer.secret });
  }

  ping() { return this.#toPeer('ping', null, 'GET'); }
  offer({ callId, kind, sdp }) { return this.#toPeer('offer', { callId, kind, sdp }); }
  answer({ callId, sdp }) { return this.#toPeer('answer', { callId, sdp }); }
  ice({ callId, candidate }) { return this.#toPeer('ice', { callId, candidate }); }
  hangup({ callId, reason }) { return this.#toPeer('hangup', { callId, reason }); }

  // Pre-pairing: we do not have a peer yet, the human typed the host + code.
  async claim(host, code, name) {
    return this.#request(String(host).trim(), 'pair', { body: { code, name } });
  }
}

module.exports = { CallClient, DEFAULT_PORT };
