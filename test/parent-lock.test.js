const test = require('node:test');
const assert = require('node:assert');
const { normalizePin, validatePin, hashPin, verifyPin, PinGate, MAX_ATTEMPTS, BASE_LOCKOUT_MS } = require('../core/parent-lock');

test('a PIN is digits, however it arrives', () => {
  assert.equal(normalizePin('1 2 3 4'), '1234');
  assert.equal(normalizePin('12-34'), '1234');
  assert.equal(normalizePin(1234), '1234');
  assert.equal(normalizePin(null), '');
  assert.equal(normalizePin(undefined), '');
});

test('length and the two PINs a child guesses first are refused', () => {
  assert.equal(validatePin('4821').ok, true);
  assert.equal(validatePin('928413').ok, true);
  assert.equal(validatePin('123').ok, false);
  assert.equal(validatePin('123456789').ok, false);
  assert.equal(validatePin('1111').ok, false);
  assert.equal(validatePin('1234').ok, false);
  assert.equal(validatePin('4321').ok, false);
  assert.match(validatePin('123').message, /4 to 8 numbers/);
});

test('the PIN is stored as a salted hash, never as the PIN', () => {
  const record = hashPin('4821');
  assert.ok(record.salt && record.hash);
  assert.equal(record.hash.includes('4821'), false);
  assert.notEqual(record.hash, hashPin('4821').hash, 'a fresh salt each time');
  assert.equal(verifyPin('4821', record), true);
  assert.equal(verifyPin('4822', record), false);
});

test('formatting differences still unlock; a wrong or missing record does not', () => {
  const record = hashPin('90210');
  assert.equal(verifyPin('9 0 2 1 0', record), true);
  assert.equal(verifyPin('90210', null), false);
  assert.equal(verifyPin('90210', {}), false);
  assert.equal(verifyPin('90210', { salt: record.salt, hash: 'nonsense' }), false);
  assert.equal(verifyPin('', record), false);
});

test('wrong guesses lock the gate for a while, and the wait doubles', () => {
  let now = 0;
  const gate = new PinGate({ now: () => now });
  for (let attempt = 0; attempt < MAX_ATTEMPTS - 1; attempt += 1) {
    assert.equal(gate.attempt(false).locked, false, 'early wrong guesses only cost an attempt');
  }
  const locked = gate.attempt(false);
  assert.equal(locked.locked, true);
  assert.equal(locked.msRemaining, BASE_LOCKOUT_MS);

  // Still locked, and a correct PIN during the lockout does not open it.
  assert.equal(gate.attempt(true).ok, false);

  now += BASE_LOCKOUT_MS;
  assert.equal(gate.status().locked, false);
  assert.equal(gate.attempt(false).msRemaining, BASE_LOCKOUT_MS * 2, 'the next lockout is longer');
});

test('the right PIN clears the record of failures', () => {
  let now = 0;
  const gate = new PinGate({ now: () => now });
  gate.attempt(false);
  gate.attempt(false);
  const ok = gate.attempt(true);
  assert.equal(ok.ok, true);
  assert.equal(gate.status().attemptsLeft, MAX_ATTEMPTS);
  assert.equal(gate.status().locked, false);
});

test('the gate accepts a check function so the hash is only computed when it can help', () => {
  const gate = new PinGate();
  let calls = 0;
  const check = () => { calls += 1; return true; };
  assert.equal(gate.attempt(check).ok, true);
  assert.equal(calls, 1);
});
