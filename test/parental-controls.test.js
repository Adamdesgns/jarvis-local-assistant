const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  UNLOCK_MINUTES,
  MAX_FAILURES,
  DEFAULT_PARENTAL,
  normalizePin,
  makePinRecord,
  verifyPin,
  pinIsSet,
  freshLock,
  isUnlocked,
  isLockedOut,
  attemptUnlock,
  relock,
  sanitizeParentalPatch,
  publicParentalView,
  inQuietHours,
  playtimeGate,
  UsageStore,
} = require('../core/parental-controls');

// ── the PIN ─────────────────────────────────────────────────────────────

test('normalizePin: 4-8 digits only, everything else is one falsy shape', () => {
  assert.equal(normalizePin('1234'), '1234');
  assert.equal(normalizePin(' 12345678 '), '12345678');
  assert.equal(normalizePin('123'), '');
  assert.equal(normalizePin('123456789'), '');
  assert.equal(normalizePin('12a4'), '');
  assert.equal(normalizePin(''), '');
  assert.equal(normalizePin(null), '');
});

test('a PIN record stores a salted hash, never the PIN', () => {
  const record = makePinRecord('4321');
  assert.ok(record.pinHash && record.pinSalt && record.pinSetAt);
  assert.ok(!JSON.stringify(record).includes('4321'));
  assert.equal(verifyPin('4321', record), true);
  assert.equal(verifyPin('1234', record), false);
  // Two records for the same PIN differ — the salt is real.
  assert.notEqual(makePinRecord('4321').pinHash, record.pinHash);
});

test('an invalid PIN produces no record at all', () => {
  assert.equal(makePinRecord('12'), null);
  assert.equal(makePinRecord('abcd'), null);
});

test('verifyPin refuses when no PIN was ever set — absence is not a wildcard', () => {
  assert.equal(verifyPin('1234', DEFAULT_PARENTAL), false);
  assert.equal(verifyPin('', makePinRecord('1234')), false);
  assert.equal(pinIsSet(DEFAULT_PARENTAL), false);
  assert.equal(pinIsSet(makePinRecord('1234')), true);
});

// ── the unlock session ──────────────────────────────────────────────────

test('a right PIN opens the seat for exactly UNLOCK_MINUTES', () => {
  const record = makePinRecord('2468');
  const now = new Date('2026-07-27T10:00:00');
  const { ok, lock } = attemptUnlock(freshLock(), record, '2468', now);
  assert.equal(ok, true);
  assert.equal(isUnlocked(lock, now), true);
  assert.equal(isUnlocked(lock, new Date(now.getTime() + UNLOCK_MINUTES * 60000 - 1000)), true);
  assert.equal(isUnlocked(lock, new Date(now.getTime() + UNLOCK_MINUTES * 60000 + 1000)), false);
});

test('wrong PINs throttle: MAX_FAILURES misses buys a one-minute lockout', () => {
  const record = makePinRecord('2468');
  const now = new Date('2026-07-27T10:00:00');
  let lock = freshLock();
  for (let i = 0; i < MAX_FAILURES; i += 1) {
    const outcome = attemptUnlock(lock, record, '0000', now);
    assert.equal(outcome.ok, false);
    lock = outcome.lock;
  }
  assert.equal(isLockedOut(lock, now), true);
  // Even the RIGHT PIN is ignored during the lockout — that is the point.
  const during = attemptUnlock(lock, record, '2468', new Date(now.getTime() + 30000));
  assert.equal(during.ok, false);
  assert.equal(during.lockedOut, true);
  // After the lockout expires, the right PIN works again.
  const after = attemptUnlock(during.lock, record, '2468', new Date(now.getTime() + 61000));
  assert.equal(after.ok, true);
});

test('a success resets the failure count, and relock closes the seat without touching it', () => {
  const record = makePinRecord('2468');
  const now = new Date('2026-07-27T10:00:00');
  let lock = attemptUnlock(freshLock(), record, '0000', now).lock;
  lock = attemptUnlock(lock, record, '2468', now).lock;
  assert.equal(lock.failures, 0);
  const locked = relock(lock);
  assert.equal(isUnlocked(locked, now), false);
  assert.equal(isLockedOut(locked, now), false);
});

// ── parental settings hygiene ───────────────────────────────────────────

test('sanitizeParentalPatch: knobs clamp, PIN fields never ride this path', () => {
  const clean = sanitizeParentalPatch({
    dailyLimitMinutes: 99999,
    quietStart: -5,
    quietEnd: 99,
    quietEnabled: 'yes',
    cloudAllowed: true,
    pinHash: 'evil',
    pinSalt: 'evil',
    somethingElse: 1
  });
  assert.equal(clean.dailyLimitMinutes, 720);
  assert.equal(clean.quietStart, 0);
  assert.equal(clean.quietEnd, 23);
  assert.equal(clean.quietEnabled, false); // 'yes' is not true
  assert.equal(clean.cloudAllowed, true);
  assert.ok(!('pinHash' in clean));
  assert.ok(!('pinSalt' in clean));
  assert.ok(!('somethingElse' in clean));
});

test('publicParentalView never leaks hash material', () => {
  const view = publicParentalView(makePinRecord('1234'));
  assert.equal(view.pinSet, true);
  assert.ok(!('pinHash' in view));
  assert.ok(!('pinSalt' in view));
});

// ── screen time ─────────────────────────────────────────────────────────

const quiet = { quietEnabled: true, quietStart: 21, quietEnd: 7 };

test('quiet hours wrap midnight', () => {
  assert.equal(inQuietHours(quiet, new Date('2026-07-27T22:00:00')), true);
  assert.equal(inQuietHours(quiet, new Date('2026-07-27T03:00:00')), true);
  assert.equal(inQuietHours(quiet, new Date('2026-07-27T07:00:00')), false);
  assert.equal(inQuietHours(quiet, new Date('2026-07-27T15:00:00')), false);
});

test('quiet hours only bite when enabled, and a degenerate window never matches', () => {
  assert.equal(inQuietHours({ ...quiet, quietEnabled: false }, new Date('2026-07-27T22:00:00')), false);
  assert.equal(inQuietHours({ quietEnabled: true, quietStart: 8, quietEnd: 8 }, new Date('2026-07-27T08:30:00')), false);
});

test('playtimeGate: bedtime outranks the minute budget, and its reply is kind', () => {
  const gate = playtimeGate({ ...quiet, dailyLimitMinutes: 60 }, 0, new Date('2026-07-27T22:00:00'));
  assert.equal(gate.reason, 'bedtime');
  assert.match(gate.reply, /quiet time/i);
});

test('playtimeGate: the daily limit bites at the limit, and 0 means no limit', () => {
  const daytime = new Date('2026-07-27T15:00:00');
  assert.equal(playtimeGate({ dailyLimitMinutes: 60 }, 59, daytime), null);
  assert.equal(playtimeGate({ dailyLimitMinutes: 60 }, 60, daytime).reason, 'limit');
  assert.equal(playtimeGate({ dailyLimitMinutes: 0 }, 10000, daytime), null);
  assert.equal(playtimeGate(DEFAULT_PARENTAL, 10000, daytime), null);
});

// ── the usage meter ─────────────────────────────────────────────────────

test('UsageStore counts a minute once, rolls at midnight, and survives a reload', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-kids-usage-'));
  try {
    const store = new UsageStore(dir);
    const t0 = new Date('2026-07-27T15:00:10');
    store.recordUse(t0);
    store.recordUse(new Date('2026-07-27T15:00:50')); // same minute — no double count
    assert.equal(store.minutesUsedToday(t0), 1);
    store.recordUse(new Date('2026-07-27T15:01:05'));
    assert.equal(store.minutesUsedToday(t0), 2);
    // A fresh instance reads the same meter — the limit survives a restart.
    const reloaded = new UsageStore(dir);
    assert.equal(reloaded.minutesUsedToday(t0), 2);
    // Tomorrow is a new allowance.
    assert.equal(reloaded.minutesUsedToday(new Date('2026-07-28T09:00:00')), 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('UsageStore shrugs off a corrupt file instead of crashing the assistant', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-kids-usage-'));
  try {
    fs.writeFileSync(path.join(dir, 'kids-usage.json'), 'not json at all', 'utf8');
    const store = new UsageStore(dir);
    assert.equal(store.minutesUsedToday(new Date('2026-07-27T15:00:00')), 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
