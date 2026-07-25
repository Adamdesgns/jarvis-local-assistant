'use strict';

// The grown-up lock on the junior build.
//
// A PIN, not a password: it is guarding settings from a curious 9-year-old on
// the family PC, not from an attacker with the disk. It is still stored as a
// salted scrypt hash and compared in constant time, because storing a child's
// house PIN in plain text teaches the wrong lesson and costs nothing to avoid.
//
// Pure and fs-free. main.js keeps the hash in the encrypted secrets store, so
// it never appears in publicSettings() and settings:save cannot overwrite it.

const crypto = require('node:crypto');

const PIN_MIN = 4;
const PIN_MAX = 8;
const SCRYPT_KEYLEN = 32;
const MAX_ATTEMPTS = 5;
const BASE_LOCKOUT_MS = 30000;
const MAX_LOCKOUT_MS = 15 * 60 * 1000;

function normalizePin(value) {
  return String(value == null ? '' : value).replace(/\D/g, '');
}

function validatePin(value) {
  const pin = normalizePin(value);
  if (pin.length < PIN_MIN || pin.length > PIN_MAX) {
    return { ok: false, message: `The PIN needs to be ${PIN_MIN} to ${PIN_MAX} numbers.` };
  }
  // Not a strength meter — just the two a child guesses first.
  if (/^(\d)\1+$/.test(pin)) return { ok: false, message: 'Pick a PIN that is not the same number repeated.' };
  if ('0123456789'.includes(pin) || '9876543210'.includes(pin)) {
    return { ok: false, message: 'Pick a PIN that is not in counting order.' };
  }
  return { ok: true, pin };
}

function hashPin(value, salt = crypto.randomBytes(16).toString('hex')) {
  const pin = normalizePin(value);
  const hash = crypto.scryptSync(pin, salt, SCRYPT_KEYLEN).toString('hex');
  return { salt, hash, version: 1 };
}

function verifyPin(value, record) {
  if (!record || !record.salt || !record.hash) return false;
  const candidate = crypto.scryptSync(normalizePin(value), record.salt, SCRYPT_KEYLEN);
  let stored;
  try {
    stored = Buffer.from(record.hash, 'hex');
  } catch {
    return false;
  }
  if (stored.length !== candidate.length) return false;
  return crypto.timingSafeEqual(stored, candidate);
}

// Wrong guesses cost time, doubling each round past the allowance. In-memory
// only: a restart clears it, which is the right trade for a family PC where
// the real failure mode is a locked-out parent, not a determined attacker.
class PinGate {
  constructor({ maxAttempts = MAX_ATTEMPTS, now = () => Date.now() } = {}) {
    this.maxAttempts = maxAttempts;
    this.now = now;
    this.failures = 0;
    this.lockedUntil = 0;
  }

  status() {
    const remaining = Math.max(0, this.lockedUntil - this.now());
    return {
      locked: remaining > 0,
      msRemaining: remaining,
      attemptsLeft: Math.max(0, this.maxAttempts - this.failures)
    };
  }

  // Wraps a verify: returns { ok } or { ok: false, locked, msRemaining }.
  attempt(check) {
    const state = this.status();
    if (state.locked) return { ok: false, ...state };
    if (check === true || (typeof check === 'function' && check() === true)) {
      this.failures = 0;
      this.lockedUntil = 0;
      return { ok: true, locked: false, msRemaining: 0, attemptsLeft: this.maxAttempts };
    }
    this.failures += 1;
    if (this.failures >= this.maxAttempts) {
      const over = this.failures - this.maxAttempts;
      const wait = Math.min(MAX_LOCKOUT_MS, BASE_LOCKOUT_MS * (2 ** over));
      this.lockedUntil = this.now() + wait;
    }
    return { ok: false, ...this.status() };
  }

  reset() {
    this.failures = 0;
    this.lockedUntil = 0;
  }
}

module.exports = {
  PIN_MIN,
  PIN_MAX,
  MAX_ATTEMPTS,
  BASE_LOCKOUT_MS,
  MAX_LOCKOUT_MS,
  normalizePin,
  validatePin,
  hashPin,
  verifyPin,
  PinGate
};
