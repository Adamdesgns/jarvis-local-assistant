'use strict';

// Parental controls for JARVIS Jr. — the parent PIN, the unlock session,
// screen-time rules, and the little per-day usage meter. Pure policy plus
// one tiny store, in the license-gate mold: main.js consults these at its
// seams; nothing here touches Electron.
//
// The PIN protects SETTINGS, not secrets: it is stored as a salted scrypt
// hash in settings.json (never the PIN itself), and the honest threat model
// is "a clever kid with the mouse", not a forensic adversary — same stance
// as the license gate. A parent who forgets the PIN can delete the kids
// settings.json and set up again; nothing of the kid's work lives in it.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PIN_MIN = 4;
const PIN_MAX = 8;

// How long one successful PIN entry keeps the parent seat unlocked. Long
// enough to walk the settings, short enough that a parent who wandered off
// doesn't leave the keys in the door.
const UNLOCK_MINUTES = 5;

// Wrong-PIN throttle: after this many misses in a row, the lock ignores
// attempts for LOCKOUT_SECONDS. Stops a kid brute-forcing 0000-9999 while
// staying forgiving to a parent who fat-fingers twice.
const MAX_FAILURES = 5;
const LOCKOUT_SECONDS = 60;

const DEFAULT_PARENTAL = Object.freeze({
  pinHash: '',
  pinSalt: '',
  pinSetAt: '',
  // 0 = no daily limit. Minutes of ACTIVE use (talking to the assistant),
  // not wall-clock minutes with the window open — see UsageStore.
  dailyLimitMinutes: 0,
  quietEnabled: false,
  quietStart: 21,
  quietEnd: 7,
  // Cloud brains stay off for kids unless a parent turns them on — the
  // kid's questions never leave the machine on any default path.
  cloudAllowed: false
});

// ── the PIN ─────────────────────────────────────────────────────────────

// Digits only, 4-8 of them. Returns '' for anything else so callers have
// one falsy shape to refuse on.
function normalizePin(pin) {
  const cleaned = String(pin ?? '').trim();
  return new RegExp(`^\\d{${PIN_MIN},${PIN_MAX}}$`).test(cleaned) ? cleaned : '';
}

function makePinRecord(pin, now = new Date()) {
  const normalized = normalizePin(pin);
  if (!normalized) return null;
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(normalized, salt, 32).toString('hex');
  return { pinHash: hash, pinSalt: salt, pinSetAt: now.toISOString() };
}

function verifyPin(pin, parental) {
  const normalized = normalizePin(pin);
  if (!normalized || !parental?.pinHash || !parental?.pinSalt) return false;
  try {
    const candidate = crypto.scryptSync(normalized, parental.pinSalt, 32);
    const stored = Buffer.from(parental.pinHash, 'hex');
    return stored.length === candidate.length && crypto.timingSafeEqual(candidate, stored);
  } catch {
    return false;
  }
}

function pinIsSet(parental) {
  return Boolean(parental?.pinHash && parental?.pinSalt);
}

// ── the unlock session (kept in main-process memory, never persisted) ───

function freshLock() {
  return { until: 0, failures: 0, lockedOutUntil: 0 };
}

function isUnlocked(lock, now = new Date()) {
  return Boolean(lock) && now.getTime() < Number(lock.until || 0);
}

function isLockedOut(lock, now = new Date()) {
  return Boolean(lock) && now.getTime() < Number(lock.lockedOutUntil || 0);
}

// One attempt against the lock. Returns the outcome plus the next lock
// state — callers replace theirs with the returned one (no mutation, so
// tests can table-drive it).
function attemptUnlock(lock, parental, pin, now = new Date()) {
  const state = { ...(lock || freshLock()) };
  if (isLockedOut(state, now)) {
    return { ok: false, lockedOut: true, lock: state };
  }
  if (!verifyPin(pin, parental)) {
    state.failures = Number(state.failures || 0) + 1;
    if (state.failures >= MAX_FAILURES) {
      state.lockedOutUntil = now.getTime() + LOCKOUT_SECONDS * 1000;
      state.failures = 0;
    }
    return { ok: false, lockedOut: isLockedOut(state, now), lock: state };
  }
  state.failures = 0;
  state.lockedOutUntil = 0;
  state.until = now.getTime() + UNLOCK_MINUTES * 60 * 1000;
  return { ok: true, lockedOut: false, lock: state };
}

function relock(lock) {
  return { ...(lock || freshLock()), until: 0 };
}

// ── parental settings hygiene ───────────────────────────────────────────

// The renderer-facing patch: only the tuning knobs, never the PIN fields —
// PIN changes go through makePinRecord via their own IPC. Numbers clamped
// so a wild payload can't set a 9000-hour bedtime.
function sanitizeParentalPatch(patch) {
  const clean = {};
  if (patch == null || typeof patch !== 'object') return clean;
  if ('dailyLimitMinutes' in patch) {
    const minutes = Math.round(Number(patch.dailyLimitMinutes));
    clean.dailyLimitMinutes = Number.isFinite(minutes) ? Math.min(720, Math.max(0, minutes)) : 0;
  }
  if ('quietEnabled' in patch) clean.quietEnabled = patch.quietEnabled === true;
  for (const key of ['quietStart', 'quietEnd']) {
    if (key in patch) {
      const hour = Math.round(Number(patch[key]));
      clean[key] = Number.isFinite(hour) ? Math.min(23, Math.max(0, hour)) : DEFAULT_PARENTAL[key];
    }
  }
  if ('cloudAllowed' in patch) clean.cloudAllowed = patch.cloudAllowed === true;
  return clean;
}

// What the renderer may see: everything except the hash material.
function publicParentalView(parental) {
  const merged = { ...DEFAULT_PARENTAL, ...(parental || {}) };
  return {
    pinSet: pinIsSet(merged),
    dailyLimitMinutes: merged.dailyLimitMinutes,
    quietEnabled: merged.quietEnabled,
    quietStart: merged.quietStart,
    quietEnd: merged.quietEnd,
    cloudAllowed: merged.cloudAllowed
  };
}

// ── screen time ─────────────────────────────────────────────────────────

// Is `hour` inside the quiet window? A window that crosses midnight
// (21 → 7) wraps; start === end means the window is degenerate and never
// matches (a parent who wants "always" uses the daily limit instead).
function inQuietHours(parental, now = new Date()) {
  if (parental?.quietEnabled !== true) return false;
  const start = Number(parental.quietStart);
  const end = Number(parental.quietEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return false;
  const hour = now.getHours();
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

// The one answer the router needs: may the kid use the assistant right now?
// Null means yes. Bedtime outranks the minute budget — its message is the
// honest one at 9pm even when minutes remain.
function playtimeGate(parental, usedMinutes, now = new Date()) {
  if (inQuietHours(parental, now)) {
    return {
      reason: 'bedtime',
      reply: "It's quiet time on this computer right now — I'll be right here when screen time opens up again. Sleep well, and dream up something for us to build tomorrow."
    };
  }
  const limit = Number(parental?.dailyLimitMinutes || 0);
  if (limit > 0 && Number(usedMinutes || 0) >= limit) {
    return {
      reason: 'limit',
      reply: "We've used up today's screen time together — that went fast! Come back tomorrow and we'll pick up right where we left off. If you think you need more time, your grown-up can change the limit."
    };
  }
  return null;
}

// ── the usage meter ─────────────────────────────────────────────────────

// Counts ACTIVE minutes: a minute counts once when at least one command was
// handled during it. Fair in both directions — an hour idle at the desktop
// costs nothing, rapid-fire questions cost one minute per minute.
function dayKey(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function minuteKey(now = new Date()) {
  return `${dayKey(now)}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

class UsageStore {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, 'kids-usage.json');
    this.data = this.#load();
  }

  #load() {
    try {
      const saved = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      return {
        day: String(saved.day || ''),
        usedMinutes: Math.max(0, Number(saved.usedMinutes) || 0),
        lastMark: String(saved.lastMark || '')
      };
    } catch {
      return { day: '', usedMinutes: 0, lastMark: '' };
    }
  }

  #persist() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const temp = `${this.filePath}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(this.data), 'utf8');
      fs.renameSync(temp, this.filePath);
    } catch {
      // The meter must never crash the assistant; a lost write costs at
      // most one counted minute.
    }
  }

  #rollDay(now) {
    const today = dayKey(now);
    if (this.data.day !== today) {
      this.data = { day: today, usedMinutes: 0, lastMark: '' };
    }
  }

  recordUse(now = new Date()) {
    this.#rollDay(now);
    const mark = minuteKey(now);
    if (this.data.lastMark !== mark) {
      this.data.usedMinutes += 1;
      this.data.lastMark = mark;
      this.#persist();
    }
    return this.data.usedMinutes;
  }

  minutesUsedToday(now = new Date()) {
    this.#rollDay(now);
    return this.data.usedMinutes;
  }
}

module.exports = {
  PIN_MIN,
  PIN_MAX,
  UNLOCK_MINUTES,
  MAX_FAILURES,
  LOCKOUT_SECONDS,
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
  dayKey,
  minuteKey,
  UsageStore,
};
