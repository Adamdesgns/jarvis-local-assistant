const http = require('node:http');
const crypto = require('node:crypto');

// Carries Blink's MPEG-TS bytes the last hop, from the main process to the
// renderer's video element.
//
// Blink live view cannot ride the WebRTC path the other brands use, and a
// renderer cannot open a raw TLS socket, so the bytes need a local carrier. This
// is deliberately the smallest one that works:
//
//   * bound to 127.0.0.1 only — never a LAN address, unlike the mobile server
//   * one unguessable token per live view, so another local process cannot
//     stumble onto a camera feed by guessing a URL. This matters: without it any
//     program on the PC could read `/blink/garage.ts`.
//   * a token dies with its view and is never reused
//   * when the renderer disconnects, the Blink stream stops — otherwise a closed
//     window leaves a battery camera awake until Blink's own timeout
//
// Live only: nothing is buffered or recorded to disk, matching what PRIVACY.md
// says about cameras.
const BIND_ADDRESS = '127.0.0.1';
const PATH_PREFIX = '/blink/';

class BlinkStreamServer {
  constructor({ bindAddress = BIND_ADDRESS, randomToken } = {}) {
    this.bindAddress = bindAddress;
    this.randomToken = randomToken || (() => crypto.randomBytes(24).toString('hex'));
    this.sessions = new Map();
    this.server = null;
  }

  async start() {
    if (this.server) return this;
    this.server = http.createServer((request, response) => this.#serve(request, response));
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      // Port 0 lets the OS pick; nothing outside this process needs to guess it.
      this.server.listen(0, this.bindAddress, resolve);
    });
    return this;
  }

  get port() {
    const address = this.server?.address();
    return address && typeof address === 'object' ? address.port : 0;
  }

  #serve(request, response) {
    const path = (request.url || '').split('?')[0];
    if (!path.startsWith(PATH_PREFIX) || !path.endsWith('.ts')) {
      response.writeHead(404).end();
      return;
    }
    const token = path.slice(PATH_PREFIX.length, -'.ts'.length);
    const session = this.sessions.get(token);
    if (!session) {
      response.writeHead(404).end();
      return;
    }
    // One viewer per live view. A second request would silently steal the
    // stream from the first.
    if (session.response) {
      response.writeHead(409).end();
      return;
    }

    session.response = response;
    response.writeHead(200, {
      'Content-Type': 'video/mp2t',
      'Cache-Control': 'no-store',
      Connection: 'close'
    });
    const disconnect = () => {
      if (session.response !== response) return;
      session.response = null;
      // The viewer went away: let the camera go back to sleep.
      session.onStop?.();
    };
    request.on('close', disconnect);
    request.on('aborted', disconnect);
  }

  // Returns the handle the camera service pumps Blink's chunks into.
  register({ onStop } = {}) {
    const token = this.randomToken();
    const session = { token, onStop, response: null };
    this.sessions.set(token, session);
    return {
      token,
      url: `http://${this.bindAddress}:${this.port}${PATH_PREFIX}${token}.ts`,
      push: (chunk) => {
        // Before the renderer connects there is nowhere to put bytes. Dropping
        // them is correct for live video — buffering would only ever play back
        // a moment that has already passed.
        if (session.response && !session.response.writableEnded) session.response.write(chunk);
      },
      close: () => this.unregister(token)
    };
  }

  unregister(token) {
    const session = this.sessions.get(token);
    if (!session) return;
    this.sessions.delete(token);
    // Detach first, so ending the response cannot loop back into onStop.
    const { response } = session;
    session.response = null;
    try { response?.end(); } catch { /* already gone */ }
  }

  async stop() {
    for (const token of [...this.sessions.keys()]) this.unregister(token);
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise((resolve) => server.close(resolve));
  }
}

module.exports = { BlinkStreamServer, BIND_ADDRESS, PATH_PREFIX };
