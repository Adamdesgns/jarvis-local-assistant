'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CallSession, RING_TIMEOUT_MS, AUTO_ANSWER_MS, RECONNECT_GRACE_MS } = require('../core/call/call-session');

// Manual timer harness: captures callbacks, fires them by hand.
function timers() {
  const pending = new Map();
  let id = 0;
  return {
    setTimer: (fn, ms) => { pending.set(++id, { fn, ms }); return id; },
    clearTimer: (t) => pending.delete(t),
    fire(ms) { for (const [key, { fn, ms: due }] of [...pending]) if (due === ms) { pending.delete(key); fn(); } },
    count: () => pending.size
  };
}

function harness(opts = {}) {
  const events = [];
  const t = timers();
  const session = new CallSession({
    ...opts, setTimer: t.setTimer, clearTimer: t.clearTimer,
    onEvent: (type, data) => events.push({ type, ...data })
  });
  return { session, events, t };
}

test('dial: idle → ringing-out with a callId; busy while not idle', () => {
  const { session } = harness();
  const dialed = session.dial();
  assert.ok(dialed.ok);
  assert.ok(dialed.callId.length > 10);
  assert.equal(session.status().state, 'ringing-out');
  assert.deepEqual(session.dial(), { ok: false, reason: 'busy' });
});

test('caller gives up at 45s: ring-timeout event, back to idle', () => {
  const { session, events, t } = harness();
  session.dial();
  t.fire(RING_TIMEOUT_MS);
  assert.equal(events.at(-1).type, 'ring-timeout');
  assert.equal(session.status().state, 'idle');
});

test('full happy path caller side: dial → peerAnswered → connected → end', () => {
  const { session, events, t } = harness();
  const { callId } = session.dial();
  session.peerAnswered(callId);
  assert.equal(session.status().state, 'connecting');
  assert.equal(t.count(), 0);                       // ring timer cleared
  session.connected();
  assert.equal(session.status().state, 'live');
  assert.equal(events.at(-1).type, 'live');
  session.end('hangup');
  assert.equal(session.status().state, 'idle');
  assert.deepEqual(events.at(-1), { type: 'ended', reason: 'hangup', callId });
});

test('callee side: incomingOffer rings, localAnswered connects; busy when not idle', () => {
  const { session } = harness();
  const incoming = session.incomingOffer('call-1');
  assert.ok(incoming.ok);
  assert.equal(session.status().state, 'ringing-in');
  assert.deepEqual(session.incomingOffer('call-2'), { ok: false, reason: 'busy' });
  session.localAnswered('call-1');
  assert.equal(session.status().state, 'connecting');
});

test('unanswered incoming call is missed at 45s', () => {
  const { session, events, t } = harness();
  session.incomingOffer('call-1');
  t.fire(RING_TIMEOUT_MS);
  assert.equal(events.at(-1).type, 'missed');
  assert.equal(session.status().state, 'idle');
});

test('auto-answer fires at 20s ONLY when constructed with autoAnswer: true', () => {
  const kid = harness({ autoAnswer: true });
  const at = kid.session.incomingOffer('call-1');
  assert.ok(at.autoAnswerAt > 0);
  kid.t.fire(AUTO_ANSWER_MS);
  assert.equal(kid.events.at(-1).type, 'auto-answer');

  const dad = harness();                            // default: no auto-answer path at all
  const plain = dad.session.incomingOffer('call-2');
  assert.equal(plain.autoAnswerAt, null);
  dad.t.fire(AUTO_ANSWER_MS);
  assert.ok(!dad.events.some((e) => e.type === 'auto-answer'));
});

test('drop: disconnected arms an 8s grace; reconnected clears it; expiry ends the call', () => {
  const { session, events, t } = harness();
  const { callId } = session.dial();
  session.peerAnswered(callId); session.connected();
  session.disconnected();
  session.reconnected();
  t.fire(RECONNECT_GRACE_MS);                       // cleared — must NOT end
  assert.equal(session.status().state, 'live');
  session.disconnected();
  t.fire(RECONNECT_GRACE_MS);
  assert.deepEqual(events.at(-1), { type: 'ended', reason: 'dropped', callId });
  assert.equal(session.status().state, 'idle');
});

test('end always returns to idle and clears every timer, from any state', () => {
  const { session, t } = harness({ autoAnswer: true });
  session.incomingOffer('call-1');
  session.end('declined');
  assert.equal(session.status().state, 'idle');
  assert.equal(t.count(), 0);
});

test('stale callIds are ignored: an answer for a dead call does nothing', () => {
  const { session } = harness();
  const { callId } = session.dial();
  session.end('hangup');
  session.peerAnswered(callId);                     // late packet from the ended call
  assert.equal(session.status().state, 'idle');
});
