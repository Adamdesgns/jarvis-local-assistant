const test = require('node:test');
const assert = require('node:assert/strict');
const { alignAnswerToOffer, mediaKinds } = require('../src/sdp-align');

// Ring's live view failed on Adam's Front Door camera with:
//   "Failed to set remote answer sdp: The order of m-lines in answer doesn't
//    match order in offer. Rejecting answer."
// JARVIS offers datachannel -> video -> audio (cameras-ui.js), Ring's cloud
// answers with the media sections in its own order, and WebRTC matches m-lines
// by POSITION, so Chromium throws the whole answer out. Realigning the answer
// is the safe half of that fix: the offer's order is what Nest (datachannel
// first) and go2rtc already work with, so it must not move.

const CRLF = '\r\n';
const join = (lines) => lines.join(CRLF) + CRLF;

function offer() {
  return join([
    'v=0',
    'o=- 1 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0 1 2',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'a=mid:0',
    'm=video 9 UDP/TLS/RTP/SAVPF 96',
    'a=mid:1',
    'a=recvonly',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    'a=mid:2',
    'a=recvonly'
  ]);
}

// Same three sections, Ring's order: audio and video swapped ahead of the
// datachannel.
function ringAnswer() {
  return join([
    'v=0',
    'o=- 3 4 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 2 1 0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    'a=mid:2',
    'a=sendonly',
    'm=video 9 UDP/TLS/RTP/SAVPF 96',
    'a=mid:1',
    'a=sendonly',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'a=mid:0'
  ]);
}

const mediaOrder = (sdp) => sdp.split(/\r?\n/)
  .filter((line) => line.startsWith('m='))
  .map((line) => line.slice(2).split(' ')[0]);

const midOrder = (sdp) => sdp.split(/\r?\n/)
  .filter((line) => line.startsWith('a=mid:'))
  .map((line) => line.slice('a=mid:'.length).trim());

test('sdp align: reorders the answer to match the offer, by mid', () => {
  const aligned = alignAnswerToOffer(offer(), ringAnswer());
  assert.deepEqual(mediaOrder(aligned), ['application', 'video', 'audio']);
  assert.deepEqual(midOrder(aligned), ['0', '1', '2']);
});

test('sdp align: keeps each answer section whole, attributes and all', () => {
  const aligned = alignAnswerToOffer(offer(), ringAnswer());
  // The audio section must still carry Ring's own direction and payload line,
  // moved as a unit rather than merged with its neighbours.
  assert.match(aligned, /m=audio 9 UDP\/TLS\/RTP\/SAVPF 111\r\na=mid:2\r\na=sendonly/);
  assert.match(aligned, /m=video 9 UDP\/TLS\/RTP\/SAVPF 96\r\na=mid:1\r\na=sendonly/);
  assert.ok(aligned.includes('o=- 3 4 IN IP4 127.0.0.1'), "keeps the answer's own session line");
  assert.ok(!aligned.includes('o=- 1 2 IN IP4 127.0.0.1'), 'never borrows the offer session line');
});

test('sdp align: rewrites the BUNDLE group into the new order', () => {
  const aligned = alignAnswerToOffer(offer(), ringAnswer());
  assert.match(aligned, /a=group:BUNDLE 0 1 2/, 'BUNDLE must follow the m-line order');
});

test('sdp align: an answer already in the right order comes back untouched', () => {
  const good = join([
    'v=0', 'o=- 3 4 IN IP4 127.0.0.1', 's=-', 't=0 0',
    'a=group:BUNDLE 0 1',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'a=mid:0',
    'm=video 9 UDP/TLS/RTP/SAVPF 96', 'a=mid:1'
  ]);
  const smallOffer = join([
    'v=0', 'o=- 1 2 IN IP4 127.0.0.1', 's=-', 't=0 0',
    'a=group:BUNDLE 0 1',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'a=mid:0',
    'm=video 9 UDP/TLS/RTP/SAVPF 96', 'a=mid:1'
  ]);
  assert.equal(alignAnswerToOffer(smallOffer, good), good, 'byte-identical, no needless rewriting');
});

test('sdp align: falls back to media type when mids are missing', () => {
  const noMidOffer = join([
    'v=0', 'o=- 1 2 IN IP4 127.0.0.1', 's=-', 't=0 0',
    'm=video 9 UDP/TLS/RTP/SAVPF 96', 'a=recvonly',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111', 'a=recvonly'
  ]);
  const noMidAnswer = join([
    'v=0', 'o=- 3 4 IN IP4 127.0.0.1', 's=-', 't=0 0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111', 'a=sendonly',
    'm=video 9 UDP/TLS/RTP/SAVPF 96', 'a=sendonly'
  ]);
  assert.deepEqual(mediaOrder(alignAnswerToOffer(noMidOffer, noMidAnswer)), ['video', 'audio']);
});

// Reordering can only ever be safe when the two describe the same sections. A
// different count is a different problem (a missing m-line, not a shuffled
// one), and rewriting it would bury Chromium's much clearer error.
test('sdp align: leaves a mismatched answer alone rather than guessing', () => {
  const shortAnswer = join([
    'v=0', 'o=- 3 4 IN IP4 127.0.0.1', 's=-', 't=0 0',
    'm=video 9 UDP/TLS/RTP/SAVPF 96', 'a=mid:1'
  ]);
  assert.equal(alignAnswerToOffer(offer(), shortAnswer), shortAnswer);
});

test('sdp align: survives junk instead of throwing mid-call', () => {
  assert.equal(alignAnswerToOffer(offer(), ''), '');
  assert.equal(alignAnswerToOffer('', 'v=0\r\n'), 'v=0\r\n');
  assert.equal(alignAnswerToOffer(offer(), undefined), undefined);
  const noMedia = 'v=0\r\no=- 3 4 IN IP4 127.0.0.1\r\n';
  assert.equal(alignAnswerToOffer(offer(), noMedia), noMedia);
});

test('sdp align: keeps CRLF line endings, which WebRTC requires', () => {
  const aligned = alignAnswerToOffer(offer(), ringAnswer());
  assert.ok(aligned.includes(CRLF), 'CRLF preserved');
  assert.ok(!/[^\r]\n/.test(aligned), 'no bare LF anywhere');
});

test('sdp align: names the media kinds in order, for the failure message', () => {
  assert.deepEqual(mediaKinds(offer()), ['application', 'video', 'audio']);
  assert.deepEqual(mediaKinds(ringAnswer()), ['audio', 'video', 'application']);
  assert.deepEqual(mediaKinds(''), []);
  assert.deepEqual(mediaKinds(undefined), []);
});
