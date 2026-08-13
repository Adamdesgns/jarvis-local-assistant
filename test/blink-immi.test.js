const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseTarget, buildAuthHeader, keepAliveFrame, latencyStatsFrame,
  FrameReader, isVideoFrame, AUTH_HEADER_BYTES, MAX_PAYLOAD_BYTES
} = require('../core/camera/blink-immi');

// Blink live view speaks Amazon's own "IMMI" protocol, not RTSP — go2rtc cannot
// touch it. The payload is already MPEG-TS, so JARVIS needs no ffmpeg, only the
// framing. Byte layout ported from blinkpy's livestream.py; these tests pin it,
// because a one-byte drift produces a connection that opens and then silently
// never delivers video.

const SERVER = 'immis://immis-prod.immedia-semi.com:443/AB12CD34EF__session9?client_id=456';

test('immi: pulls host, port, client id and connection id out of the immis URL', () => {
  assert.deepEqual(parseTarget(SERVER), {
    host: 'immis-prod.immedia-semi.com',
    port: 443,
    clientId: 456,
    connId: 'AB12CD34EF'
  });
});

test('immi: a URL with no client id still yields a usable target', () => {
  const target = parseTarget('immis://10.0.0.5:8443/ONLYID');
  assert.equal(target.clientId, 0);
  assert.equal(target.connId, 'ONLYID');
  assert.equal(target.port, 8443);
});

test('immi: the auth header is exactly 122 bytes, field for field', () => {
  const header = buildAuthHeader({ serial: 'G8T1-1234-5678', clientId: 456, connId: 'AB12CD34EF' });
  assert.equal(header.length, AUTH_HEADER_BYTES);

  assert.deepEqual([...header.subarray(0, 4)], [0x00, 0x00, 0x00, 0x28], 'magic number');
  assert.equal(header.readUInt32BE(4), 16, 'serial length prefix');
  assert.equal(header.subarray(8, 24).toString('utf8').replace(/\0+$/, ''), 'G8T1-1234-5678');
  assert.equal(header.readUInt32BE(24), 456, 'client id');
  assert.deepEqual([...header.subarray(28, 30)], [0x01, 0x08], 'static field');
  assert.equal(header.readUInt32BE(30), 64, 'token length prefix');
  assert.ok(header.subarray(34, 98).every((byte) => byte === 0), 'token is sent empty');
  assert.equal(header.readUInt32BE(98), 16, 'connection id length prefix');
  assert.equal(header.subarray(102, 118).toString('utf8').replace(/\0+$/, ''), 'AB12CD34EF');
  assert.deepEqual([...header.subarray(118, 122)], [0x00, 0x00, 0x00, 0x01], 'trailer');
});

test('immi: over-long fields are truncated, not allowed to shift the header', () => {
  const header = buildAuthHeader({
    serial: 'THIS-SERIAL-IS-FAR-TOO-LONG-TO-FIT',
    clientId: 1,
    connId: 'ALSO-A-VERY-LONG-CONNECTION-ID'
  });
  assert.equal(header.length, AUTH_HEADER_BYTES, 'still 122 bytes');
  assert.equal(header.subarray(8, 24).toString('utf8'), 'THIS-SERIAL-IS-F');
});

test('immi: a missing serial pads rather than throwing', () => {
  const header = buildAuthHeader({ serial: undefined, clientId: 0, connId: 'X' });
  assert.equal(header.length, AUTH_HEADER_BYTES);
  assert.ok(header.subarray(8, 24).every((byte) => byte === 0));
});

test('immi: keep-alive is a bare header with a rising sequence', () => {
  const frame = keepAliveFrame(7);
  assert.equal(frame.length, 9, 'header only, no payload');
  assert.equal(frame.readUInt8(0), 0x0a);
  assert.equal(frame.readUInt32BE(1), 7);
  assert.equal(frame.readUInt32BE(5), 0, 'zero payload length');
});

test('immi: latency stats is a 24-byte zero report on a static sequence', () => {
  const frame = latencyStatsFrame();
  assert.equal(frame.length, 33);
  assert.equal(frame.readUInt8(0), 0x12);
  assert.equal(frame.readUInt32BE(1), 1000, 'Blink expects the static 1000');
  assert.equal(frame.readUInt32BE(5), 24);
  assert.ok(frame.subarray(9).every((byte) => byte === 0));
});

// Helper: build a wire frame the way Blink would.
function wireFrame(msgtype, sequence, payload) {
  const header = Buffer.alloc(9);
  header.writeUInt8(msgtype, 0);
  header.writeUInt32BE(sequence, 1);
  header.writeUInt32BE(payload.length, 5);
  return Buffer.concat([header, payload]);
}

const tsPacket = (fill = 1) => Buffer.concat([Buffer.from([0x47]), Buffer.alloc(187, fill)]);

test('immi: reads whole frames out of one chunk', () => {
  const reader = new FrameReader();
  const frames = reader.push(Buffer.concat([
    wireFrame(0x00, 1, tsPacket()),
    wireFrame(0x0a, 2, Buffer.alloc(0))
  ]));
  assert.equal(frames.length, 2);
  assert.equal(frames[0].msgtype, 0x00);
  assert.equal(frames[0].payload.length, 188);
  assert.equal(frames[1].sequence, 2);
});

// This is the case blinkpy gets wrong (it reads straight off the socket, so a
// split TLS record truncates the frame). TCP splits wherever it likes.
test('immi: reassembles a frame split across chunks, even mid-header', () => {
  const reader = new FrameReader();
  const whole = wireFrame(0x00, 1, tsPacket(9));
  assert.deepEqual(reader.push(whole.subarray(0, 4)), [], 'partial header yields nothing yet');
  assert.deepEqual(reader.push(whole.subarray(4, 9)), [], 'header complete but no payload yet');
  assert.deepEqual(reader.push(whole.subarray(9, 100)), [], 'partial payload still waits');
  const frames = reader.push(whole.subarray(100));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].payload.length, 188);
  assert.ok(frames[0].payload.every((byte, i) => (i === 0 ? byte === 0x47 : byte === 9)), 'payload intact');
});

test('immi: several frames arriving glued together all come out', () => {
  const reader = new FrameReader();
  const glued = Buffer.concat([
    wireFrame(0x00, 1, tsPacket()), wireFrame(0x00, 2, tsPacket()),
    wireFrame(0x05, 3, Buffer.alloc(10)), wireFrame(0x00, 4, tsPacket())
  ]);
  assert.deepEqual(reader.push(glued).map((f) => f.sequence), [1, 2, 3, 4]);
});

test('immi: leftover bytes carry over to the next chunk', () => {
  const reader = new FrameReader();
  const a = wireFrame(0x00, 1, tsPacket());
  const b = wireFrame(0x00, 2, tsPacket());
  const first = reader.push(Buffer.concat([a, b.subarray(0, 50)]));
  assert.equal(first.length, 1);
  const second = reader.push(b.subarray(50));
  assert.equal(second.length, 1);
  assert.equal(second[0].sequence, 2);
});

// A desync would otherwise let a bogus length allocate unbounded memory.
test('immi: refuses an implausible payload length instead of allocating it', () => {
  const reader = new FrameReader();
  const bogus = Buffer.alloc(9);
  bogus.writeUInt8(0x00, 0);
  bogus.writeUInt32BE(1, 1);
  bogus.writeUInt32BE(MAX_PAYLOAD_BYTES + 1, 5);
  assert.throws(() => reader.push(bogus), /out of sync/);
});

test('immi: keeps only video frames that really start a transport packet', () => {
  assert.equal(isVideoFrame({ msgtype: 0x00, payload: tsPacket() }), true);
  assert.equal(isVideoFrame({ msgtype: 0x05, payload: tsPacket() }), false, 'audio is not video');
  assert.equal(isVideoFrame({ msgtype: 0x17, payload: tsPacket() }), false, 'session command');
  assert.equal(isVideoFrame({ msgtype: 0x00, payload: Buffer.from([0x00, 0x01]) }), false, 'no sync byte');
  assert.equal(isVideoFrame({ msgtype: 0x00, payload: Buffer.alloc(0) }), false, 'empty payload');
});

test('immi: a realistic burst yields a clean MPEG-TS byte stream', () => {
  const reader = new FrameReader();
  const burst = Buffer.concat([
    wireFrame(0x0a, 1, Buffer.alloc(0)),          // keep-alive echo
    wireFrame(0x00, 2, tsPacket(1)),              // video
    wireFrame(0x05, 3, Buffer.alloc(32, 7)),      // audio
    wireFrame(0x00, 4, tsPacket(2)),              // video
    wireFrame(0x00, 5, Buffer.from([0x00, 0x00])) // malformed video
  ]);
  const video = Buffer.concat(reader.push(burst).filter(isVideoFrame).map((f) => f.payload));
  assert.equal(video.length, 376, 'exactly the two good packets');
  assert.equal(video[0], 0x47);
  assert.equal(video[188], 0x47, 'every 188 bytes starts a new TS packet');
});
