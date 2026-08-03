// The one call at a time, and what state it is in. Pure logic: timers are
// injected so tests fire them by hand, and every transition that matters to
// a human surfaces as an onEvent — main.js forwards those to the renderer
// and to the peer, this module never touches a socket.
//
// Auto-answer exists only when constructed with { autoAnswer: true } — the
// JR build passes it, the JARVIS build never does, so Dad's PC has no code
// path that answers by itself (spec: "never auto-answers").
'use strict';
const crypto = require('node:crypto');

const RING_TIMEOUT_MS = 45000;
const AUTO_ANSWER_MS = 20000;
const RECONNECT_GRACE_MS = 8000;

class CallSession {
  constructor({ autoAnswer = false, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, onEvent = () => {} } = {}) {
    this.autoAnswer = !!autoAnswer;
    this.now = now; this.setTimer = setTimer; this.clearTimer = clearTimer;
    this.onEvent = onEvent;
    this.state = 'idle';
    this.callId = null;
    this.timers = { ring: null, auto: null, grace: null };
  }

  #emit(type, data = {}) { this.onEvent(type, { callId: this.callId, ...data }); }
  #clearAll() { for (const key of Object.keys(this.timers)) { if (this.timers[key]) { this.clearTimer(this.timers[key]); this.timers[key] = null; } } }
  #reset() { this.#clearAll(); this.state = 'idle'; this.callId = null; }

  dial() {
    if (this.state !== 'idle') return { ok: false, reason: 'busy' };
    this.state = 'ringing-out';
    this.callId = crypto.randomUUID();
    this.timers.ring = this.setTimer(() => { this.#emit('ring-timeout'); this.#reset(); }, RING_TIMEOUT_MS);
    return { ok: true, callId: this.callId };
  }

  incomingOffer(callId) {
    if (this.state !== 'idle') return { ok: false, reason: 'busy' };
    this.state = 'ringing-in';
    this.callId = String(callId);
    this.timers.ring = this.setTimer(() => { this.#emit('missed'); this.#reset(); }, RING_TIMEOUT_MS);
    let autoAnswerAt = null;
    if (this.autoAnswer) {
      autoAnswerAt = this.now() + AUTO_ANSWER_MS;
      this.timers.auto = this.setTimer(() => { this.#emit('auto-answer'); }, AUTO_ANSWER_MS);
    }
    return { ok: true, autoAnswerAt };
  }

  peerAnswered(callId) {
    if (this.state !== 'ringing-out' || String(callId) !== this.callId) return;
    this.#clearAll();
    this.state = 'connecting';
  }

  localAnswered(callId) {
    if (this.state !== 'ringing-in' || String(callId) !== this.callId) return;
    this.#clearAll();
    this.state = 'connecting';
  }

  connected() {
    if (this.state !== 'connecting' && this.state !== 'live') return;
    if (this.timers.grace) { this.clearTimer(this.timers.grace); this.timers.grace = null; }
    if (this.state !== 'live') { this.state = 'live'; this.#emit('live'); }
  }

  disconnected() {
    if (this.state !== 'live' || this.timers.grace) return;
    this.timers.grace = this.setTimer(() => { const callId = this.callId; this.#reset(); this.onEvent('ended', { callId, reason: 'dropped' }); }, RECONNECT_GRACE_MS);
  }

  reconnected() {
    if (this.timers.grace) { this.clearTimer(this.timers.grace); this.timers.grace = null; }
  }

  end(reason = 'hangup') {
    if (this.state === 'idle') return { ok: true, reason };
    const callId = this.callId;
    this.#reset();
    this.onEvent('ended', { callId, reason });
    return { ok: true, reason };
  }

  status() { return { state: this.state, callId: this.callId, autoAnswer: this.autoAnswer }; }
}

module.exports = { CallSession, RING_TIMEOUT_MS, AUTO_ANSWER_MS, RECONNECT_GRACE_MS };
