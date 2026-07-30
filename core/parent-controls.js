'use strict';

// The parent's half of JARVIS JR: birthdate, the feature checklist, the kid's
// display name, and the PIN — stored as ONE JSON secret ('jrParent') through
// ConfigStore's secrets store, so it rides DPAPI when available and NEVER
// appears in the renderer-reachable settings block. A kid who can edit
// settings.json can neither switch on his own features nor age himself past
// the content lock.

const { normalizeControls } = require('./variant');
const lock = require('./parent-lock');

const SECRET_NAME = 'jrParent';
const AGE_MIN = 3;
const AGE_MAX = 17;
const KID_NAME_MAX = 24;

function parseBirthdate(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [, yStr, mStr, dStr] = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  const d = parseInt(dStr, 10);
  const date = new Date(`${text}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  // Reject dates that rolled over (e.g., Feb 30 → Mar 2)
  if (date.getFullYear() !== y || date.getMonth() + 1 !== m || date.getDate() !== d) return null;
  return { text, date };
}

function wholeYears(from, to) {
  let years = to.getFullYear() - from.getFullYear();
  const beforeBirthday =
    to.getMonth() < from.getMonth() ||
    (to.getMonth() === from.getMonth() && to.getDate() < from.getDate());
  if (beforeBirthday) years -= 1;
  return years;
}

function normalizeKidName(value) {
  return String(value == null ? '' : value).trim().slice(0, KID_NAME_MAX);
}

class ParentControls {
  constructor(config) {
    this.config = config;
    // Lockout state is in-memory on purpose: a restart resets the timer but
    // never the PIN, and persisting attempt counts would put a tamper target
    // on disk for no security this PIN (a settings-panel latch) needs.
    this.gate = new lock.PinGate();
  }

  #read() {
    try {
      const raw = this.config.getSecret(SECRET_NAME);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  #write(data) {
    this.config.setSecret(SECRET_NAME, JSON.stringify(data));
  }

  isSetUp() {
    const data = this.#read();
    return Boolean(data.pinHash && data.birthdate);
  }

  completeSetup({ pin, birthdate, controls, kidName, currentPin } = {}) {
    // Re-entry guard: once a parent has already completed setup, a second
    // completeSetup call is a full redo — new PIN, new birthdate, the works —
    // so it demands proof this is the same parent, not just a page reload a
    // kid found. That proof is a currentPin that verifies against the stored
    // hash, routed through the SAME verifyPin()/PinGate the parent panel
    // uses: a currentPin present but wrong still counts as a failed attempt
    // toward the ordinary lockout, so this can't be used as a second,
    // uncounted PIN-guessing surface next to jr:parent:verify.
    if (this.isSetUp()) {
      const hasCurrentPin = currentPin !== undefined && currentPin !== null && String(currentPin).trim() !== '';
      const verified = hasCurrentPin && this.verifyPin(currentPin).ok;
      if (!verified) {
        return { ok: false, reason: 'JARVIS JR is already set up. Use the parent panel.' };
      }
    }
    const pinCheck = lock.validatePin(pin);
    if (!pinCheck.ok) return { ok: false, reason: pinCheck.message };
    const parsed = parseBirthdate(birthdate);
    if (!parsed) return { ok: false, reason: 'Birthdate must be a real date, YYYY-MM-DD.' };
    const age = wholeYears(parsed.date, new Date());
    if (age < AGE_MIN || age > AGE_MAX) {
      return { ok: false, reason: `JARVIS JR is for kids aged ${AGE_MIN} to ${AGE_MAX}.` };
    }
    this.#write({
      pinHash: lock.hashPin(String(pin)),
      birthdate: parsed.text,
      controls: normalizeControls(controls),
      kidName: normalizeKidName(kidName)
    });
    return { ok: true };
  }

  verifyPin(pin) {
    const state = this.gate.status();
    if (state.locked) {
      return { ok: false, locked: true, retryInSeconds: Math.ceil(state.msRemaining / 1000) };
    }
    const data = this.#read();
    const after = this.gate.attempt(() => Boolean(data.pinHash) && lock.verifyPin(String(pin || ''), data.pinHash));
    if (after.ok) return { ok: true };
    return {
      ok: false,
      locked: after.locked,
      retryInSeconds: Math.ceil(after.msRemaining / 1000)
    };
  }

  getControls() {
    return normalizeControls(this.#read().controls);
  }

  setControls(patch) {
    const data = this.#read();
    data.controls = normalizeControls({ ...normalizeControls(data.controls), ...(patch || {}) });
    this.#write(data);
    return { ...data.controls };
  }

  // Kid name and birthdate, editable from the JARVIS JR settings tab. NOT a
  // route to the PIN or the checklist: it reads the secret, changes at most
  // those two fields, and writes it back. A rejected birthdate leaves the
  // stored one untouched rather than half-applying.
  setProfile({ kidName, birthdate } = {}) {
    const data = this.#read();
    if (birthdate !== undefined) {
      const parsed = parseBirthdate(birthdate);
      if (!parsed) return { ok: false, reason: 'Birthdate must be a real date, YYYY-MM-DD.' };
      const age = wholeYears(parsed.date, new Date());
      if (age < AGE_MIN || age > AGE_MAX) {
        return { ok: false, reason: `JARVIS JR is for kids aged ${AGE_MIN} to ${AGE_MAX}.` };
      }
      data.birthdate = parsed.text;
    }
    if (kidName !== undefined) data.kidName = normalizeKidName(kidName);
    this.#write(data);
    return { ok: true, kidName: data.kidName || '', birthdate: data.birthdate || '' };
  }

  getBirthdate() {
    return this.#read().birthdate || '';
  }

  getKidName() {
    return this.#read().kidName || '';
  }

  age(now = new Date()) {
    const parsed = parseBirthdate(this.getBirthdate());
    if (!parsed) return AGE_MIN;
    return Math.min(AGE_MAX, Math.max(AGE_MIN, wholeYears(parsed.date, now)));
  }

  setPin(oldPin, newPin) {
    // Route the old-PIN check through the SAME gated verifyPin() that
    // completeSetup's re-entry guard and the parent panel use — never call
    // lock.verifyPin directly here, or setPin becomes an unthrottled PIN
    // oracle sitting right next to the throttled one.
    const verified = this.verifyPin(oldPin);
    if (!verified.ok) return verified;
    const pinCheck = lock.validatePin(newPin);
    if (!pinCheck.ok) return { ok: false, reason: pinCheck.message };
    const data = this.#read();
    data.pinHash = lock.hashPin(String(newPin));
    this.#write(data);
    return { ok: true };
  }
}

module.exports = { ParentControls, SECRET_NAME, AGE_MIN, AGE_MAX, KID_NAME_MAX };
