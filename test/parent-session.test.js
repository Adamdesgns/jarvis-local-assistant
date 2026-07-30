'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ParentSession, IDLE_MS, CEILING_MS } = require('../core/parent-session');

function fakeClock(start = 1000000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('locked by default; only unlock() opens it', () => {
  const clock = fakeClock();
  const s = new ParentSession({ now: clock.now });
  assert.equal(s.status().unlocked, false);
  assert.equal(s.admit(), false);
  s.unlock();
  assert.equal(s.status().unlocked, true);
  assert.equal(s.admit(), true);
});

test('idle cap: ten quiet minutes closes it, and it never revives on its own', () => {
  const clock = fakeClock();
  const s = new ParentSession({ now: clock.now });
  s.unlock();
  clock.advance(IDLE_MS - 1000);
  assert.equal(s.admit(), true, 'still inside the idle window');
  clock.advance(IDLE_MS + 1);
  assert.equal(s.admit(), false, 'idle cap expired');
  clock.advance(1000);
  assert.equal(s.admit(), false, 'an expired session stays expired');
});

test('admit() is the heartbeat; status() is only a read', () => {
  const clock = fakeClock();
  const s = new ParentSession({ now: clock.now });
  s.unlock();
  for (let i = 0; i < 5; i += 1) {
    clock.advance(IDLE_MS - 1000);
    assert.equal(s.admit(), true, `refresh ${i}`);
  }
  clock.advance(IDLE_MS - 1000);
  s.status(); s.status(); s.status();
  clock.advance(2000);
  assert.equal(s.admit(), false, 'status() must not keep a session alive');
});

test('absolute ceiling: an hour of steady use still ends the session', () => {
  const clock = fakeClock();
  const s = new ParentSession({ now: clock.now });
  s.unlock();
  let admitted = true;
  for (let elapsed = 0; elapsed < CEILING_MS + IDLE_MS; elapsed += 60000) {
    clock.advance(60000);
    admitted = s.admit();
  }
  assert.equal(admitted, false, 'the ceiling is not refreshable');
});

test('lock() is immediate and needs no PIN — narrowing is always safe', () => {
  const clock = fakeClock();
  const s = new ParentSession({ now: clock.now });
  s.unlock();
  s.lock();
  assert.equal(s.admit(), false);
});

test('status() reports seconds left so the UI can warn before it drops', () => {
  const clock = fakeClock();
  const s = new ParentSession({ now: clock.now });
  assert.equal(s.status().expiresInSeconds, 0);
  s.unlock();
  clock.advance(60000);
  const left = s.status().expiresInSeconds;
  assert.ok(left > 0 && left <= IDLE_MS / 1000, `unexpected ${left}`);
});
