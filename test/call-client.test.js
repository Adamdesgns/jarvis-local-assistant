'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CallClient } = require('../core/call/call-client');

// fetch stub: records calls, returns a canned response.
function stubFetch(status = 200, body = { ok: true }) {
  const calls = [];
  const fn = async (url, options) => {
    calls.push({ url: String(url), options });
    return { status, ok: status < 400, json: async () => body };
  };
  return { fn, calls };
}

const peer = () => ({ host: '100.101.5.5', secret: 's3cret' });

test('requests hit http://host:27184/call/<path> with the bearer secret', async () => {
  const { fn, calls } = stubFetch();
  const client = new CallClient({ getPeer: peer, fetchFn: fn });
  await client.ping();
  assert.equal(calls[0].url, 'http://100.101.5.5:27184/call/ping');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer s3cret');
});

test('offer/answer/ice/hangup POST their JSON bodies', async () => {
  const { fn, calls } = stubFetch();
  const client = new CallClient({ getPeer: peer, fetchFn: fn });
  await client.offer({ callId: 'c1', kind: 'call', sdp: 'v=0' });
  const sent = JSON.parse(calls[0].options.body);
  assert.deepEqual(sent, { callId: 'c1', kind: 'call', sdp: 'v=0' });
  assert.equal(calls[0].options.method, 'POST');
});

test('unpaired: every call refuses with a plain reason and never fetches', async () => {
  const { fn, calls } = stubFetch();
  const client = new CallClient({ getPeer: () => null, fetchFn: fn });
  const result = await client.ping();
  assert.equal(result.ok, false);
  assert.match(result.reason, /paired/i);
  assert.equal(calls.length, 0);
});

test('network failure comes back as {ok:false, reason}, never a throw', async () => {
  const client = new CallClient({ getPeer: peer, fetchFn: async () => { throw new Error('ECONNREFUSED 100.101.5.5'); } });
  const result = await client.ping();
  assert.equal(result.ok, false);
  assert.ok(!/ECONNREFUSED/.test(result.reason));   // raw network text never reaches the UI
});

test('peer rejection surfaces the body reason (busy)', async () => {
  const { fn } = stubFetch(409, { ok: false, reason: 'busy' });
  const client = new CallClient({ getPeer: peer, fetchFn: fn });
  const result = await client.offer({ callId: 'c1', kind: 'call', sdp: 'v=0' });
  assert.deepEqual(result, { ok: false, reason: 'busy' });
});

test('claim posts code+name to an explicit host with no auth header', async () => {
  const { fn, calls } = stubFetch(200, { secret: 'newsecret', name: 'JARVIS' });
  const client = new CallClient({ getPeer: () => null, fetchFn: fn });
  const result = await client.claim('100.90.1.1', '123456', 'JR');
  assert.equal(calls[0].url, 'http://100.90.1.1:27184/call/pair');
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.deepEqual(result, { ok: true, secret: 'newsecret', name: 'JARVIS' });
});
