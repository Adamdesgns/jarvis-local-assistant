const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

// Supervises the bundled go2rtc.exe: localhost-only config, restart-once
// watchdog on exit (same philosophy as the local voice engine).
class Go2RtcManager {
  constructor({ binaryPath, dataDir, emit, spawnFn = spawn, fetchFn = globalThis.fetch }) {
    this.binaryPath = binaryPath;
    this.dataDir = dataDir;
    this.emit = emit || (() => {});
    this.spawnFn = spawnFn;
    this.fetchFn = fetchFn;
    this.process = null;
    this.apiPort = 0;
    this.retried = false;
    this.stopping = false;
    this.message = 'Streaming helper not started';
    this.starting = null;
  }

  installed() { return fs.existsSync(this.binaryPath); }
  apiBase() { return `http://127.0.0.1:${this.apiPort}`; }
  whepUrl(name) { return `${this.apiBase()}/api/webrtc?src=${encodeURIComponent(name)}`; }
  getStatus() { return { installed: this.installed(), running: Boolean(this.process), message: this.message }; }

  configPath() { return path.join(this.dataDir, 'go2rtc.yaml'); }

  writeConfig(apiPort, webrtcPort) {
    const yaml = [
      'api:',
      `  listen: "127.0.0.1:${apiPort}"`,
      'rtsp:',
      '  listen: ""',
      'webrtc:',
      `  listen: "127.0.0.1:${webrtcPort}/tcp"`,
      'srtp:',
      '  listen: ""',
      'log:',
      '  level: warn',
      ''
    ].join('\n');
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.writeFileSync(this.configPath(), yaml, 'utf8');
  }

  async start() {
    if (this.process) return { ok: true, message: this.message };
    if (this.starting) return this.starting;
    if (!this.installed()) {
      this.message = 'The camera streaming helper is missing. Reinstall JARVIS to restore it.';
      return { ok: false, message: this.message };
    }
    this.starting = (async () => {
      this.apiPort = await freePort();
      const webrtcPort = await freePort();
      this.writeConfig(this.apiPort, webrtcPort);
      const child = this.spawnFn(this.binaryPath, ['-config', this.configPath()], {
        cwd: this.dataDir, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore']
      });
      this.process = child;
      child.on('error', () => this.#handleExit(child));
      child.on('exit', () => this.#handleExit(child));
      this.message = 'Streaming helper running';
      this.emit('cameras:helper', this.getStatus());
      return { ok: true, message: this.message };
    })();
    try { return await this.starting; } finally { this.starting = null; }
  }

  #handleExit(child) {
    if (this.process !== child) return;
    this.process = null;
    if (this.stopping) return;
    if (!this.retried) {
      this.retried = true;
      this.message = 'Streaming helper stopped — restarting it';
      this.emit('cameras:helper', this.getStatus());
      this.start();
    } else {
      this.message = 'The camera streaming helper keeps stopping. Open Diagnostics and copy the report.';
      this.emit('cameras:helper', this.getStatus());
    }
  }

  async stop() {
    this.stopping = true;
    if (this.process) { try { this.process.kill(); } catch {} }
    this.process = null;
    this.message = 'Streaming helper stopped';
    this.stopping = false;
  }

  async #api(pathname, options = {}) {
    const response = await this.fetchFn(`${this.apiBase()}${pathname}`, options);
    if (!response.ok) throw new Error(`Streaming helper error ${response.status || ''}`.trim());
    return response;
  }

  async setStream(name, source) {
    await this.#api(`/api/streams?name=${encodeURIComponent(name)}&src=${encodeURIComponent(source)}`, { method: 'PUT' });
  }

  async removeStream(name) {
    await this.#api(`/api/streams?src=${encodeURIComponent(name)}`, { method: 'DELETE' });
  }

  async snapshot(name) {
    const response = await this.#api(`/api/frame.jpeg?src=${encodeURIComponent(name)}`);
    return Buffer.from(await response.arrayBuffer());
  }
}

module.exports = { Go2RtcManager, freePort };
