'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ParentControls } = require('../core/parent-controls');

// A ConfigStore double exposing exactly the two methods ParentControls may
// use. Anything else it touches throws — the storage contract, as a trap.
function fakeConfig() {
  const secrets = {};
  return new Proxy({
    setSecret: (name, value) => { if (!value) delete secrets[name]; else secrets[name] = String(value); },
    getSecret: (name) => secrets[name] || '',
    _dump: () => ({ ...secrets })
  }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      throw new Error(`ParentControls touched config.${String(prop)}`);
    }
  });
}

test('not set up until PIN and birthdate are both stored', () => {
  const pc = new ParentControls(fakeConfig());
  assert.equal(pc.isSetUp(), false);
});

test('completeSetup validates, stores one secret, and flips isSetUp', () => {
  const config = fakeConfig();
  const pc = new ParentControls(config);
  assert.equal(pc.completeSetup({ pin: '12', birthdate: '2015-03-09', controls: {} }).ok, false); // pin too short
  assert.equal(pc.completeSetup({ pin: '2468', birthdate: 'March', controls: {} }).ok, false);    // not a date
  const done = pc.completeSetup({ pin: '2468', birthdate: '2015-03-09', controls: { documents: true, files: true } });
  assert.equal(done.ok, true);
  assert.equal(pc.isSetUp(), true);
  assert.deepEqual(Object.keys(config._dump()), ['jrParent']); // one secret, nothing else
  assert.equal(pc.getControls().documents, true);
  assert.equal(pc.getControls().browser, false);
});

test('verifyPin: right pin ok; five wrong guesses lock', () => {
  const pc = new ParentControls(fakeConfig());
  pc.completeSetup({ pin: '2468', birthdate: '2015-03-09', controls: {} });
  assert.equal(pc.verifyPin('2468').ok, true);
  for (let i = 0; i < 5; i++) assert.equal(pc.verifyPin('0000').ok, false);
  const locked = pc.verifyPin('2468'); // even the RIGHT pin is refused while locked
  assert.equal(locked.ok, false);
  assert.equal(locked.locked, true);
  assert.ok(locked.retryInSeconds > 0);
});

test('setControls merges through the normalizer — junk cannot smuggle a key', () => {
  const pc = new ParentControls(fakeConfig());
  pc.completeSetup({ pin: '2468', birthdate: '2015-03-09', controls: {} });
  const out = pc.setControls({ browser: 1, cameraConfig: true, nightShift: true });
  assert.equal(out.browser, true);
  assert.equal('cameraConfig' in out, false);
  assert.equal('nightShift' in out, false);
});

test('age: whole years from birthdate, clamped 3..17', () => {
  const pc = new ParentControls(fakeConfig());
  pc.completeSetup({ pin: '2468', birthdate: '2015-03-09', controls: {} });
  assert.equal(pc.age(new Date('2026-07-28')), 11);
  assert.equal(pc.age(new Date('2026-03-08')), 10);  // day before the birthday
  assert.equal(pc.age(new Date('2060-01-01')), 17);  // clamp: JR never ages past the lock
  assert.equal(pc.age(new Date('2016-01-01')), 3);   // clamp floor
});

test('birthdate must be a real past date for a child', () => {
  const pc = new ParentControls(fakeConfig());
  assert.equal(pc.completeSetup({ pin: '2468', birthdate: '2031-01-01', controls: {} }).ok, false); // future
  assert.equal(pc.completeSetup({ pin: '2468', birthdate: '1980-01-01', controls: {} }).ok, false); // an adult is not a JR kid
});

test('calendar-invalid birthdates are rejected, not rolled over', () => {
  const pc = new ParentControls(fakeConfig());
  assert.equal(pc.completeSetup({ pin: '2468', birthdate: '2015-02-30', controls: {} }).ok, false);
  assert.equal(pc.completeSetup({ pin: '2468', birthdate: '2015-04-31', controls: {} }).ok, false);
  assert.equal(pc.completeSetup({ pin: '2468', birthdate: '2016-02-29', controls: {} }).ok, true); // real leap day
});

test('setPin requires the old pin', () => {
  const pc = new ParentControls(fakeConfig());
  pc.completeSetup({ pin: '2468', birthdate: '2015-03-09', controls: {} });
  assert.equal(pc.setPin('0000', '13579').ok, false);
  assert.equal(pc.setPin('2468', '13579').ok, true);
  assert.equal(pc.verifyPin('13579').ok, true);
});

// FIX 1 (Critical, task-6 review): setup re-entry. Once isSetUp() is true,
// completeSetup must refuse a redo unless the payload proves it is the same
// parent — a verified currentPin, checked through the SAME verifyPin/PinGate
// used everywhere else, so brute-forcing a re-setup counts toward the normal
// lockout rather than opening a second, uncounted PIN-guessing surface.
test('completeSetup refuses re-entry with no currentPin once already set up', () => {
  const pc = new ParentControls(fakeConfig());
  const first = pc.completeSetup({ pin: '2468', birthdate: '2015-03-09', controls: { documents: true } });
  assert.equal(first.ok, true);
  const redo = pc.completeSetup({ pin: '1357', birthdate: '2016-06-01', controls: { browser: true } });
  assert.equal(redo.ok, false);
  assert.match(redo.reason, /already set up/i);
  // nothing changed
  assert.equal(pc.getBirthdate(), '2015-03-09');
  assert.equal(pc.verifyPin('2468').ok, true);
});

test('completeSetup refuses re-entry with a wrong currentPin, and it counts toward lockout', () => {
  const pc = new ParentControls(fakeConfig());
  pc.completeSetup({ pin: '2468', birthdate: '2015-03-09', controls: {} });
  for (let i = 0; i < 4; i++) {
    const redo = pc.completeSetup({ pin: '1357', birthdate: '2016-06-01', controls: {}, currentPin: '0000' });
    assert.equal(redo.ok, false);
    assert.match(redo.reason, /already set up/i);
  }
  // the 5th wrong currentPin trips the same lockout verifyPin uses
  const fifth = pc.completeSetup({ pin: '1357', birthdate: '2016-06-01', controls: {}, currentPin: '0000' });
  assert.equal(fifth.ok, false);
  // even the RIGHT pin is now refused, through the ordinary parent-panel gate
  const locked = pc.verifyPin('2468');
  assert.equal(locked.ok, false);
  assert.equal(locked.locked, true);
  // nothing was ever changed by any of the failed attempts
  assert.equal(pc.getBirthdate(), '2015-03-09');
});

test('completeSetup with the right currentPin performs a full redo', () => {
  const pc = new ParentControls(fakeConfig());
  pc.completeSetup({ pin: '2468', birthdate: '2015-03-09', controls: { documents: true }, kidName: 'Old' });
  const redo = pc.completeSetup({
    pin: '1357', birthdate: '2016-06-01', controls: { browser: true }, kidName: 'New', currentPin: '2468'
  });
  assert.equal(redo.ok, true);
  assert.equal(pc.getBirthdate(), '2016-06-01');
  assert.equal(pc.getKidName(), 'New');
  assert.equal(pc.verifyPin('1357').ok, true);
  assert.equal(pc.getControls().browser, true);
  assert.equal(pc.getControls().documents, false); // a full redo replaces, it does not merge
});

test('completeSetup stores an optional kidName, trimmed and capped at 24 chars', () => {
  const pc = new ParentControls(fakeConfig());
  pc.completeSetup({ pin: '2468', birthdate: '2015-03-09', controls: {}, kidName: '  Sam  ' });
  assert.equal(pc.getKidName(), 'Sam');

  const pc2 = new ParentControls(fakeConfig());
  const longName = 'A'.repeat(40);
  pc2.completeSetup({ pin: '2468', birthdate: '2015-03-09', controls: {}, kidName: longName });
  assert.equal(pc2.getKidName().length, 24);

  const pc3 = new ParentControls(fakeConfig());
  pc3.completeSetup({ pin: '2468', birthdate: '2015-03-09', controls: {} });
  assert.equal(pc3.getKidName(), '');
});
