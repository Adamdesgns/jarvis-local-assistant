const test = require('node:test');
const assert = require('node:assert/strict');
const { pickBindAddress, sseFrame } = require('../core/mobile-server');

test('pickBindAddress: finds the Tailscale IPv4 and ignores everything else', () => {
  assert.equal(pickBindAddress({
    'Ethernet': [{ family: 'IPv4', address: '192.168.1.20', internal: false }],
    'Tailscale': [{ family: 'IPv4', address: '100.101.102.103', internal: false },
                  { family: 'IPv6', address: 'fd7a::1', internal: false }]
  }), '100.101.102.103');
  assert.equal(pickBindAddress({ 'Ethernet': [{ family: 'IPv4', address: '192.168.1.20', internal: false }] }), null);
  // CGNAT range is 100.64.0.0/10 — 100.63.x and 100.128.x are NOT in it.
  assert.equal(pickBindAddress({ 'X': [{ family: 'IPv4', address: '100.63.0.1', internal: false }] }), null);
  assert.equal(pickBindAddress({ 'X': [{ family: 'IPv4', address: '100.128.0.1', internal: false }] }), null);
});

test('sseFrame formats an SSE event', () => {
  assert.equal(sseFrame('reply', { text: 'hi' }), 'event: reply\ndata: {"text":"hi"}\n\n');
});
