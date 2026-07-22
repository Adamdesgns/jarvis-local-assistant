// Best-effort helper that puts an HTTPS front — via `tailscale serve` — in
// front of the mobile companion's loopback HTTP server, and auto-detects the
// tailnet HTTPS address the phone should use.
//
// Why this exists: iPhone Safari refuses microphone access (and won't install a
// PWA) on anything that isn't HTTPS, so the phone needs a real
// `https://host.tailnet.ts.net` address, not the plain `http://100.x.x.x:port`
// tailnet IP. Getting that used to be a manual chore — run `tailscale serve`
// by hand, read the URL, paste it into MOBILE PUBLIC URL. If any of that was
// skipped, the phone just "wouldn't load". This module does it automatically.
//
// Everything here is BEST-EFFORT: if Tailscale isn't installed, isn't logged
// in, or a command fails, callers fall back to the plain-HTTP tailnet address
// and nothing breaks. No method throws; failures are returned as data.
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

function tailscaleExe() {
  if (process.platform !== 'win32') return 'tailscale';
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const candidates = [
    path.join(pf, 'Tailscale', 'tailscale.exe'),
    path.join(pf, 'Tailscale IPN', 'tailscale.exe'),
    'tailscale.exe'
  ];
  return candidates.find((candidate) => candidate === 'tailscale.exe' || fs.existsSync(candidate)) || 'tailscale.exe';
}

// From `tailscale status --json`, the machine's own MagicDNS name → https URL.
// DNSName arrives fully-qualified with a trailing dot ("host.tailnet.ts.net.");
// strip it. Returns null when MagicDNS gives us nothing usable (no name, or a
// bare label with no tailnet suffix), which is the signal to fall back to HTTP.
function selfHttpsUrl(statusJson) {
  try {
    const data = typeof statusJson === 'string' ? JSON.parse(statusJson) : statusJson;
    const dns = data && data.Self && data.Self.DNSName;
    if (!dns) return null;
    const host = String(dns).replace(/\.+$/, '');
    if (!host || !host.includes('.')) return null;
    return `https://${host}`;
  } catch {
    return null;
  }
}

// Does `tailscale serve status --json` already forward an HTTPS handler to our
// loopback port? If so we leave it alone rather than reconfiguring on every
// toggle. Recent-CLI shape:
//   { "Web": { "host:443": { "Handlers": { "/": { "Proxy": "http://127.0.0.1:27183" } } } } }
function serveTargetsPort(serveJson, port) {
  try {
    const data = typeof serveJson === 'string' ? JSON.parse(serveJson) : serveJson;
    const web = data && data.Web;
    if (!web || typeof web !== 'object') return false;
    const needle = `127.0.0.1:${port}`;
    for (const entry of Object.values(web)) {
      const handlers = entry && entry.Handlers;
      if (!handlers || typeof handlers !== 'object') continue;
      for (const handler of Object.values(handlers)) {
        if (handler && typeof handler.Proxy === 'string' && handler.Proxy.includes(needle)) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

class Tailscale {
  constructor({ exe = tailscaleExe(), run } = {}) {
    this.exe = exe;
    // Injectable runner so the logic above/below is unit-testable without a
    // real tailscale binary. Contract: resolves { code, stdout, stderr } and
    // never rejects — a missing binary is code !== 0, not a thrown error.
    this.run = run || ((args) => new Promise((resolve) => {
      execFile(this.exe, args, { windowsHide: true, timeout: 8000 }, (error, stdout, stderr) => {
        resolve({ code: error ? (error.code ?? 1) : 0, stdout: stdout || '', stderr: stderr || '' });
      });
    }));
  }

  // The tailnet HTTPS URL for this machine, or null if we can't determine one.
  async detectHttpsUrl() {
    const { code, stdout } = await this.run(['status', '--json']);
    if (code !== 0) return null;
    return selfHttpsUrl(stdout);
  }

  async isServing(port) {
    const { code, stdout } = await this.run(['serve', 'status', '--json']);
    if (code !== 0) return false;
    return serveTargetsPort(stdout, port);
  }

  // Point https:443 at our loopback server. Idempotent: if serve already
  // forwards to this port we report ok without touching anything. Returns
  // { ok, reason } — reason is only set on failure.
  async startServe(port) {
    if (await this.isServing(port)) return { ok: true };
    const { code, stderr } = await this.run(['serve', '--bg', '--https=443', `http://127.0.0.1:${port}`]);
    if (code === 0) return { ok: true };
    return { ok: false, reason: String(stderr || '').trim() || `tailscale serve exited with code ${code}` };
  }

  // Tear down the HTTPS front we put up. Best-effort — the result is ignored.
  async stopServe() {
    await this.run(['serve', '--https=443', 'off']);
  }
}

module.exports = { tailscaleExe, selfHttpsUrl, serveTargetsPort, Tailscale };
