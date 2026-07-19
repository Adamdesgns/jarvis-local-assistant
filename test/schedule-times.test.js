const test = require('node:test');
const assert = require('node:assert/strict');
const { nextRunAt, dueSince, pickNext } = require('../core/schedule-times');

const at = (y, m, d, h, min) => new Date(y, m - 1, d, h, min, 0, 0);
const item = (over = {}) => ({ id: 'a', name: 'x', enabled: true, lastRunAt: null, when: { time: '07:00', repeat: 'daily', weekday: null }, ...over });

test('daily: later today, else tomorrow — and advances by calendar day', () => {
  assert.deepEqual(nextRunAt(item(), at(2026, 7, 19, 6, 0)), at(2026, 7, 20 - 1, 7, 0));
  assert.deepEqual(nextRunAt(item(), at(2026, 7, 19, 8, 0)), at(2026, 7, 20, 7, 0));
  // exactly at the time counts as passed — strictly after `from`
  assert.deepEqual(nextRunAt(item(), at(2026, 7, 19, 7, 0)), at(2026, 7, 20, 7, 0));
});

test('weekdays: Friday evening rolls to Monday', () => {
  const fri = at(2026, 7, 17, 8, 0);           // 2026-07-17 is a Friday
  assert.equal(new Date(fri).getDay(), 5);
  assert.deepEqual(nextRunAt(item({ when: { time: '07:00', repeat: 'weekdays', weekday: null } }), fri), at(2026, 7, 20, 7, 0));
});

test('weekly: lands on the chosen weekday', () => {
  const wed = at(2026, 7, 15, 9, 0);           // Wednesday
  const out = nextRunAt(item({ when: { time: '07:00', repeat: 'weekly', weekday: 0 } }), wed);
  assert.equal(out.getDay(), 0);
  assert.deepEqual(out, at(2026, 7, 19, 7, 0));
});

test('once: fires once, then never; disabled never fires', () => {
  const once = item({ when: { time: '07:00', repeat: 'once', weekday: null } });
  assert.deepEqual(nextRunAt(once, at(2026, 7, 19, 6, 0)), at(2026, 7, 19, 7, 0));
  assert.equal(nextRunAt({ ...once, lastRunAt: at(2026, 7, 19, 7, 0).toISOString() }, at(2026, 7, 19, 8, 0)), null);
  assert.equal(nextRunAt(item({ enabled: false }), at(2026, 7, 19, 6, 0)), null);
});

test('dueSince: true only when an occurrence fell in the window', () => {
  const from = at(2026, 7, 19, 6, 0);
  assert.equal(dueSince(item(), from, at(2026, 7, 19, 7, 30)), true);   // 07:00 passed
  assert.equal(dueSince(item(), from, at(2026, 7, 19, 6, 30)), false);  // not yet
  assert.equal(dueSince(item({ enabled: false }), from, at(2026, 7, 19, 9, 0)), false);
});

test('nextRunAt: malformed input returns null instead of throwing', () => {
  const from = at(2026, 7, 19, 6, 0);

  // Missing "when"
  assert.equal(nextRunAt(item({ when: undefined }), from), null);
  assert.equal(nextRunAt(item({ when: null }), from), null);

  // Bad time string
  assert.equal(nextRunAt(item({ when: { time: 'not-a-time', repeat: 'daily', weekday: null } }), from), null);
  assert.equal(nextRunAt(item({ when: { time: '', repeat: 'daily', weekday: null } }), from), null);

  // Weekly with a null weekday never matches any day
  assert.equal(nextRunAt(item({ when: { time: '07:00', repeat: 'weekly', weekday: null } }), from), null);

  // Non-object item
  assert.equal(nextRunAt(null, from), null);
  assert.equal(nextRunAt(undefined, from), null);
  assert.equal(nextRunAt('not-an-item', from), null);
  assert.equal(nextRunAt(42, from), null);
});

test('pickNext: soonest enabled item(s), null when none', () => {
  const early = item({ id: 'early', when: { time: '07:00', repeat: 'daily', weekday: null } });
  const late = item({ id: 'late', when: { time: '09:00', repeat: 'daily', weekday: null } });
  const off = item({ id: 'off', enabled: false, when: { time: '06:00', repeat: 'daily', weekday: null } });
  const out = pickNext([late, early, off], at(2026, 7, 19, 5, 0));
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].id, 'early');
  assert.deepEqual(out.at, at(2026, 7, 19, 7, 0));
  assert.equal(pickNext([], at(2026, 7, 19, 5, 0)), null);
  assert.equal(pickNext([off], at(2026, 7, 19, 5, 0)), null);
});

test('pickNext: two items sharing the same earliest time both come back tied, in input order', () => {
  const briefing = item({ id: 'briefing', when: { time: '07:00', repeat: 'daily', weekday: null } });
  const meds = item({ id: 'meds', when: { time: '07:00', repeat: 'daily', weekday: null } });
  const later = item({ id: 'later', when: { time: '09:00', repeat: 'daily', weekday: null } });
  const out = pickNext([briefing, later, meds], at(2026, 7, 19, 5, 0));
  assert.equal(out.items.length, 2);
  assert.deepEqual(out.items.map((i) => i.id), ['briefing', 'meds']);
  assert.deepEqual(out.at, at(2026, 7, 19, 7, 0));
});
