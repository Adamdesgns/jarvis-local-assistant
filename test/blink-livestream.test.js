const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { BlinkLiveStream, KEEPALIVE_EVERY } = require('../core/camera/blink-livestream');

// The moving half of Blink live view. A fake socket stands in for TLS so the
// three concurrent jobs — read video, keep the connection warm, poll the command
// API — can be driven deterministically.

const SERVER = 'immis://immis-prod.immedia-semi.com:443/AB12CD34EF__s?client_id=456';

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.written = [];
    this.destroyed = false;
  }

  write(buffer) { this.written.push(Buffer.from(buffer)); return true; }
  destroy() { this.destroyed = true; this.emit('close'); }
}

function wireFrame(msgtype, sequence, payload) {
  const header = Buffer.alloc(9);
  header.writeUInt8(msgtype, 0);
  header.writeUInt32BE(sequence, 1);
  header.writeUInt32BE(payload.length, 5);
  return Buffer.concat([header, payload]);
}

const tsPacket = (fill = 1) => Buffer.concat([Buffer.from([0x47]), Buffer.alloc(187, fill)]);

async function startStream(overrides = {}) {
  const socket = new FakeSocket();
  const video = [];
  const ended = [];
  const calls = { status: [], done: [] };
  const stream = new BlinkLiveStream({
    connect: async () => socket,
    serial: 'G8T1-0001',
    server: SERVER,
    commandId: 99,
    pollingInterval: 1,
    commands: {
      status: async (id) => { calls.status.push(id); return { commands: [{ id, state_condition: 'running' }] }; },
      done: async (id) => { calls.done.push(id); }
    },
    onVideo: (chunk) => video.push(chunk),
    onEnd: (error) => ended.push(error),
    ...overrides
  });
  await stream.start();
  return { stream, socket, video, ended, calls };
}

test('livestream: opens the target from the immis URL and leads with the auth header', async () => {
  const seen = [];
  const socket = new FakeSocket();
  const stream = new BlinkLiveStream({
    connect: async (target) => { seen.push(target); return socket; },
    serial: 'G8T1-0001',
    server: SERVER,
    commandId: 1
  });
  await stream.start();
  assert.deepEqual(seen, [{ host: 'immis-prod.immedia-semi.com', port: 443 }]);
  assert.equal(socket.written.length, 1, 'nothing is sent before the auth header');
  assert.equal(socket.written[0].length, 122);
  assert.equal(socket.written[0].readUInt32BE(24), 456, 'client id came from the URL');
  stream.stop();
});

test('livestream: forwards video payloads and drops everything else', async () => {
  const { stream, socket, video } = await startStream();
  socket.emit('data', Buffer.concat([
    wireFrame(0x0a, 1, Buffer.alloc(0)),        // keep-alive echo
    wireFrame(0x00, 2, tsPacket(1)),            // video
    wireFrame(0x05, 3, Buffer.alloc(16, 9)),    // audio
    wireFrame(0x00, 4, tsPacket(2))             // video
  ]));
  assert.equal(video.length, 2);
  assert.ok(video.every((chunk) => chunk[0] === 0x47));
  assert.equal(Buffer.concat(video).length, 376);
  stream.stop();
});

test('livestream: a frame split across TCP chunks still arrives whole', async () => {
  const { stream, socket, video } = await startStream();
  const frame = wireFrame(0x00, 1, tsPacket(3));
  socket.emit('data', frame.subarray(0, 30));
  assert.equal(video.length, 0, 'nothing emitted from a partial frame');
  socket.emit('data', frame.subarray(30));
  assert.equal(video.length, 1);
  assert.equal(video[0].length, 188);
  stream.stop();
});

// Blink drops a client that goes quiet, so the cadence is load-bearing.
test('livestream: stats every tick, keep-alive every tenth, sequence rising', async () => {
  const { stream, socket } = await startStream();
  socket.written.length = 0; // drop the auth header

  stream.tick();
  assert.equal(socket.written.length, 2, 'first tick sends keep-alive AND stats');
  assert.equal(socket.written[0].readUInt8(0), 0x0a, 'keep-alive');
  assert.equal(socket.written[0].readUInt32BE(1), 1, 'sequence starts at 1');
  assert.equal(socket.written[1].readUInt8(0), 0x12, 'latency stats');

  socket.written.length = 0;
  for (let i = 1; i < KEEPALIVE_EVERY; i += 1) stream.tick();
  assert.equal(socket.written.length, KEEPALIVE_EVERY - 1, 'stats only on the in-between ticks');
  assert.ok(socket.written.every((frame) => frame.readUInt8(0) === 0x12));

  socket.written.length = 0;
  stream.tick();
  const keepAlives = socket.written.filter((frame) => frame.readUInt8(0) === 0x0a);
  assert.equal(keepAlives.length, 1, 'the tenth tick sends another keep-alive');
  assert.equal(keepAlives[0].readUInt32BE(1), 2, 'sequence advanced');
  stream.stop();
});

test('livestream: a finished command ends the stream', async () => {
  const { stream, ended, calls } = await startStream({
    commands: {
      status: async (id) => ({ commands: [{ id, state_condition: 'done' }] }),
      done: async () => {}
    }
  });
  await stream.poll();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ended.length, 1, 'Blink ended the session, so JARVIS does too');
  assert.equal(calls.status.length, 0, 'used the overridden commands');
});

test('livestream: a still-running command keeps the stream open', async () => {
  const { stream, ended, calls } = await startStream();
  await stream.poll();
  assert.equal(ended.length, 0);
  assert.deepEqual(calls.status, [99]);
  stream.stop();
});

// A flaky poll must not kill a stream that is still delivering video.
test('livestream: a failed poll does not tear down a working stream', async () => {
  const { stream, socket, video, ended } = await startStream({
    commands: { status: async () => { throw new Error('network blip'); }, done: async () => {} }
  });
  await stream.poll();
  assert.equal(ended.length, 0, 'survives the blip');
  socket.emit('data', wireFrame(0x00, 1, tsPacket()));
  assert.equal(video.length, 1, 'still forwarding video');
  stream.stop();
});

test('livestream: releases the Blink session when it stops, so the camera sleeps', async () => {
  const { stream, calls, ended } = await startStream();
  stream.stop();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.done, [99], 'told Blink the command is done');
  assert.equal(ended.length, 1);
  assert.equal(ended[0], undefined, 'a clean stop reports no error');
});

test('livestream: stop is idempotent — a socket close after stop cannot double-release', async () => {
  const { stream, socket, calls, ended } = await startStream();
  stream.stop();
  socket.emit('close');
  stream.stop();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.done.length, 1, 'released exactly once');
  assert.equal(ended.length, 1, 'ended exactly once');
});

test('livestream: a socket error ends the stream and still releases the session', async () => {
  const { socket, calls, ended } = await startStream();
  socket.emit('error', new Error('connection reset'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ended.length, 1);
  assert.match(ended[0].message, /connection reset/);
  assert.deepEqual(calls.done, [99]);
});

test('livestream: a desynced frame ends the stream instead of reading on', async () => {
  const { socket, ended } = await startStream();
  const bogus = Buffer.alloc(9);
  bogus.writeUInt8(0x00, 0);
  bogus.writeUInt32BE(1, 1);
  bogus.writeUInt32BE(50 * 1024 * 1024, 5); // absurd payload length
  socket.emit('data', bogus);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ended.length, 1);
  assert.match(ended[0].message, /out of sync/);
});

test('livestream: video stops being forwarded once stopped', async () => {
  const { stream, socket, video } = await startStream();
  stream.stop();
  socket.emit('data', wireFrame(0x00, 1, tsPacket()));
  assert.equal(video.length, 0, 'no late writes after teardown');
});

test('livestream: a polling interval in seconds becomes a sane millisecond delay', async () => {
  const socket = new FakeSocket();
  const make = (pollingInterval) => new BlinkLiveStream({
    connect: async () => socket, serial: 's', server: SERVER, commandId: 1, pollingInterval
  });
  assert.equal(make(5).pollMs, 5000);
  assert.equal(make(undefined).pollMs, 5000, 'falls back rather than polling in a tight loop');
  assert.equal(make(0).pollMs, 5000);
  assert.equal(make(0.1).pollMs, 1000, 'never faster than a second');
});
