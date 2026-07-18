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

module.exports = { pickBindAddress, sseFrame };  // MobileServer added in the next task
