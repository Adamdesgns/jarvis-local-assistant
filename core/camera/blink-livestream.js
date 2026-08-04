const immi = require('./blink-immi');

// Blink live view, the moving half: hold the TLS connection open and turn it
// into a plain MPEG-TS byte stream. The wire format lives in blink-immi.js.
//
// Three things run at once for as long as the view is open, and dropping any of
// them ends the stream:
//   recv  — read frames, forward the video ones
//   send  — latency stats every second, keep-alive every ten
//   poll  — ask Blink's command API whether the session is still alive, then
//           tell it we are done so the camera can go back to sleep
//
// `connect` is injected so this is testable without a socket, and so the TLS
// choice stays visible at the call site rather than buried in here.
const LATENCY_INTERVAL_MS = 1000;
const KEEPALIVE_EVERY = 10; // latency ticks between keep-alives
const DEFAULT_POLL_MS = 5000;

class BlinkLiveStream {
  // `onVideo` receives raw MPEG-TS chunks; `onEnd` fires exactly once.
  constructor({ connect, serial, server, commandId, pollingInterval, commands, onVideo, onEnd }) {
    this.connect = connect;
    this.serial = serial;
    this.target = immi.parseTarget(server);
    this.commandId = commandId;
    this.pollMs = Math.max(1000, Number(pollingInterval) * 1000 || DEFAULT_POLL_MS);
    this.commands = commands || {};
    this.onVideo = onVideo || (() => {});
    this.onEnd = onEnd || (() => {});
    this.reader = new immi.FrameReader();
    this.socket = null;
    this.timer = null;
    this.pollTimer = null;
    this.ticks = 0;
    this.sequence = 0;
    this.stopped = false;
    this.bytes = 0;
  }

  async start() {
    this.socket = await this.connect({ host: this.target.host, port: this.target.port });
    this.socket.on('data', (chunk) => this.#onData(chunk));
    this.socket.on('error', (error) => this.stop(error));
    this.socket.on('end', () => this.stop());
    this.socket.on('close', () => this.stop());

    this.socket.write(immi.buildAuthHeader({
      serial: this.serial,
      clientId: this.target.clientId,
      connId: this.target.connId
    }));

    this.timer = setInterval(() => this.tick(), LATENCY_INTERVAL_MS);
    if (this.timer.unref) this.timer.unref();
    this.#schedulePoll();
    return this;
  }

  #onData(chunk) {
    if (this.stopped) return;
    let frames;
    try {
      frames = this.reader.push(chunk);
    } catch (error) {
      // A desynced stream cannot be recovered by reading further.
      this.stop(error);
      return;
    }
    for (const frame of frames) {
      if (!immi.isVideoFrame(frame)) continue;
      this.bytes += frame.payload.length;
      this.onVideo(frame.payload);
    }
  }

  // Blink hangs up on a quiet client, so this is not optional. Public only so
  // tests can drive the cadence without waiting real seconds.
  tick() {
    if (this.stopped || !this.socket) return;
    try {
      if (this.ticks % KEEPALIVE_EVERY === 0) {
        this.sequence += 1;
        this.socket.write(immi.keepAliveFrame(this.sequence));
      }
      this.socket.write(immi.latencyStatsFrame());
      this.ticks += 1;
    } catch (error) {
      this.stop(error);
    }
  }

  #schedulePoll() {
    if (this.stopped) return;
    this.pollTimer = setTimeout(() => this.poll(), this.pollMs);
    if (this.pollTimer.unref) this.pollTimer.unref();
  }

  // Blink ends a live view server-side (battery, quota, its own timeout). The
  // command API is the only place that says so. Public for the same reason as
  // tick().
  async poll() {
    if (this.stopped) return;
    try {
      const status = await this.commands.status?.(this.commandId);
      const command = (status?.commands || []).find((entry) => entry.id === this.commandId);
      const condition = command?.state_condition;
      if (command && condition !== 'new' && condition !== 'running') {
        this.stop();
        return;
      }
    } catch {
      // A failed poll is not itself a reason to tear down a working stream;
      // the socket closing is. Try again next interval.
    }
    this.#schedulePoll();
  }

  stop(error) {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.timer);
    clearTimeout(this.pollTimer);
    try { this.socket?.destroy?.(); } catch { /* already gone */ }
    // Always release the session, even on the error path, or the camera stays
    // awake burning battery until Blink's own timeout catches it.
    Promise.resolve(this.commands.done?.(this.commandId)).catch(() => {});
    this.onEnd(error);
  }
}

// The real connection. Blink's stream endpoints present certificates that do
// not validate against a public root, and blinkpy disables verification for the
// same reason. Narrow by construction: it applies to this one socket, carries no
// credentials (the auth header holds only the camera serial and a connection id
// Blink just issued), and the payload is checked for MPEG-TS framing regardless.
function tlsConnect({ host, port }) {
  const tls = require('node:tls');
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, rejectUnauthorized: false }, () => resolve(socket));
    socket.once('error', reject);
  });
}

module.exports = { BlinkLiveStream, tlsConnect, LATENCY_INTERVAL_MS, KEEPALIVE_EVERY };
