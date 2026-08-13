// Blink's live-view wire protocol ("IMMI"), the pure half.
//
// Blink live view is not RTSP and go2rtc cannot touch it. Asking Blink for a
// live view returns `immis://{host}:{port}/{connId}__...?client_id=N` — Amazon's
// own protocol. What comes back over it, though, is **already MPEG-TS**, so
// JARVIS needs no transcoding and no ffmpeg (which `99ee18b` deleted on purpose
// for licensing reasons). It only has to speak the framing.
//
// Protocol per blinkpy's `livestream.py` (itself credited to
// amattu2/blink-liveview-middleware), ported rather than guessed:
//
//   1. TLS to host:port. Blink's stream endpoints present certificates that do
//      not validate, so verification is off here as it is in every other
//      client — see connectLiveStream in blink-livestream.js for the caveat.
//   2. Write a 122-byte auth header (buildAuthHeader below).
//   3. Read frames: [msgtype:1][sequence:4 BE][payloadLength:4 BE][payload].
//      msgtype 0x00 carrying a 0x47 sync byte is video; everything else is
//      bookkeeping and gets dropped.
//   4. Keep writing: a latency-stats frame every second and a keep-alive every
//      ten, or Blink hangs up.
//
// Nothing in this file does I/O, so all of it is directly testable.

const MAGIC = [0x00, 0x00, 0x00, 0x28];
const STATIC_FIELD = [0x01, 0x08];
const TRAILER = [0x00, 0x00, 0x00, 0x01];
const SERIAL_BYTES = 16;
const TOKEN_BYTES = 64;
const CONN_ID_BYTES = 16;
const AUTH_HEADER_BYTES = 122;

const HEADER_BYTES = 9;
// Blink's own cap. A larger claimed length means the stream is out of sync, and
// trusting it would let a bad frame allocate unbounded memory.
const MAX_PAYLOAD_BYTES = 1024 * 1024;

const MSG_VIDEO = 0x00;
const MSG_KEEPALIVE = 0x0a;
const MSG_LATENCY_STATS = 0x12;
const TS_SYNC_BYTE = 0x47;

// immis://host:port/CONNID__something?client_id=123
function parseTarget(serverUrl) {
  const url = new URL(String(serverUrl));
  const lastSegment = url.pathname.split('/').filter(Boolean).pop() || '';
  return {
    host: url.hostname,
    port: Number(url.port),
    clientId: Number(url.searchParams.get('client_id') || 0),
    connId: lastSegment.split('__')[0]
  };
}

// A length-prefixed, null-padded fixed-width string field.
function stringField(value, width) {
  const padded = Buffer.alloc(width);
  Buffer.from(String(value ?? ''), 'utf8').copy(padded, 0, 0, width);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(width, 0);
  return Buffer.concat([length, padded]);
}

function buildAuthHeader({ serial, clientId, connId }) {
  const clientIdField = Buffer.alloc(4);
  clientIdField.writeUInt32BE(Number(clientId) || 0, 0);
  const header = Buffer.concat([
    Buffer.from(MAGIC),
    stringField(serial, SERIAL_BYTES),
    clientIdField,
    Buffer.from(STATIC_FIELD),
    // The token field is length-prefixed but sent empty; Blink authenticates
    // the session through the connection id, not through this.
    stringField('', TOKEN_BYTES),
    stringField(connId, CONN_ID_BYTES),
    Buffer.from(TRAILER)
  ]);
  if (header.length !== AUTH_HEADER_BYTES) {
    throw new Error(`Blink auth header must be ${AUTH_HEADER_BYTES} bytes, built ${header.length}`);
  }
  return header;
}

function frameHeader(msgtype, sequence, payloadLength) {
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt8(msgtype, 0);
  header.writeUInt32BE(sequence, 1);
  header.writeUInt32BE(payloadLength, 5);
  return header;
}

const keepAliveFrame = (sequence) => frameHeader(MSG_KEEPALIVE, sequence, 0);

// Blink expects a stats report even though it never uses ours: 24 zero bytes of
// audio/video latency and frame counts.
const latencyStatsFrame = () => Buffer.concat([
  frameHeader(MSG_LATENCY_STATS, 1000, 24),
  Buffer.alloc(24)
]);

// Reassembles frames from arbitrarily-chopped TCP chunks. blinkpy reads 9 bytes
// and then the payload straight off the socket, which silently truncates
// whenever TLS hands over a partial record; buffering is the correct shape.
class FrameReader {
  constructor() {
    this.buffer = Buffer.alloc(0);
  }

  push(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : Buffer.from(chunk);
    const frames = [];
    for (;;) {
      if (this.buffer.length < HEADER_BYTES) break;
      const msgtype = this.buffer.readUInt8(0);
      const sequence = this.buffer.readUInt32BE(1);
      const payloadLength = this.buffer.readUInt32BE(5);
      if (payloadLength > MAX_PAYLOAD_BYTES) {
        throw new Error(`Blink sent an implausible frame (${payloadLength} bytes) — stream out of sync`);
      }
      if (this.buffer.length < HEADER_BYTES + payloadLength) break;
      const payload = this.buffer.subarray(HEADER_BYTES, HEADER_BYTES + payloadLength);
      this.buffer = this.buffer.subarray(HEADER_BYTES + payloadLength);
      frames.push({ msgtype, sequence, payload: Buffer.from(payload) });
    }
    return frames;
  }
}

// Video only, and only frames that really start a transport-stream packet.
const isVideoFrame = (frame) => frame.msgtype === MSG_VIDEO
  && frame.payload.length > 0
  && frame.payload[0] === TS_SYNC_BYTE;

module.exports = {
  parseTarget,
  buildAuthHeader,
  keepAliveFrame,
  latencyStatsFrame,
  FrameReader,
  isVideoFrame,
  AUTH_HEADER_BYTES,
  HEADER_BYTES,
  MAX_PAYLOAD_BYTES,
  MSG_VIDEO,
  MSG_KEEPALIVE,
  MSG_LATENCY_STATS,
  TS_SYNC_BYTE
};
