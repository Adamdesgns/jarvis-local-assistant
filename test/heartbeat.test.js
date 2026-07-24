const test = require('node:test');
const assert = require('node:assert/strict');
const { HeartbeatService, buildDefaultChecks } = require('../core/heartbeat');

const DAY = new Date('2026-07-25T14:00:00');    // 2 PM — outside quiet hours
const NIGHT = new Date('2026-07-25T02:00:00');  // 2 AM — inside quiet hours (21-7)

function makeService({ now = () => DAY, settings = {}, checks = [] } = {}) {
  const timers = [];
  const events = [];
  const service = new HeartbeatService({
    config: {
      getSettings: () => ({
        heartbeatEnabled: true,
        heartbeatMinutes: 30,
        autonomyNightStart: 21,
        autonomyNightEnd: 7,
        ...settings
      })
    },
    checks,
    emit: (channel, payload) => events.push({ channel, payload }),
    log: { write: () => {} },
    now,
    setTimer: (fn, delay) => { timers.push({ fn, delay }); return timers.length; },
    clearTimer: () => {}
  });
  return { service, timers, events };
}

test('start arms a timer for the configured interval', () => {
  const { service, timers } = makeService();
  service.start();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 30 * 60 * 1000);
});

test('a tick with no findings stays silent and re-arms', async () => {
  const { service, timers, events } = makeService({ checks: [{ name: 'quiet', run: async () => null }] });
  service.start();
  await timers[0].fn();
  assert.equal(events.length, 0);
  assert.equal(timers.length, 2, 're-armed after the tick');
});

test('a tick with findings announces them out loud during the day', async () => {
  const { service, timers, events } = makeService({
    checks: [{ name: 'tasks', run: async () => ({ message: '2 tasks are overdue.' }) }]
  });
  service.start();
  await timers[0].fn();
  assert.equal(events.length, 1);
  assert.equal(events[0].channel, 'autonomy:event');
  assert.match(events[0].payload.speak, /overdue/);
  assert.match(events[0].payload.card.body, /overdue/);
});

test('during quiet hours findings become a silent card — no speech', async () => {
  const { service, timers, events } = makeService({
    now: () => NIGHT,
    checks: [{ name: 'tasks', run: async () => ({ message: 'Something needs attention.' }) }]
  });
  service.start();
  await timers[0].fn();
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.speak, undefined);
  assert.ok(events[0].payload.card);
});

test('the same finding is not re-announced on consecutive ticks', async () => {
  const { service, timers, events } = makeService({
    checks: [{ name: 'tasks', run: async () => ({ message: 'Same problem.' }) }]
  });
  service.start();
  await timers[0].fn();
  await timers[1].fn();
  assert.equal(events.length, 1, 'second identical finding suppressed');
});

test('heartbeat disabled means ticks do nothing but re-arm', async () => {
  const { service, timers, events } = makeService({
    settings: { heartbeatEnabled: false },
    checks: [{ name: 'tasks', run: async () => ({ message: 'Should not fire.' }) }]
  });
  service.start();
  await timers[0].fn();
  assert.equal(events.length, 0);
});

test('one throwing check cannot take down the others', async () => {
  const { service, timers, events } = makeService({
    checks: [
      { name: 'broken', run: async () => { throw new Error('boom'); } },
      { name: 'working', run: async () => ({ message: 'Still working.' }) }
    ]
  });
  service.start();
  await timers[0].fn();
  assert.equal(events.length, 1);
  assert.match(events[0].payload.card.body, /Still working/);
});

test('default checks: overdue tasks, fresh crash entries, night-shift failures', async () => {
  const now = () => DAY;
  const checks = buildDefaultChecks({
    tasks: { list: () => [
      { title: 'Order fittings', status: 'open', dueAt: '2026-07-25T08:00:00' },
      { title: 'Done thing', status: 'done', dueAt: '2026-07-25T08:00:00' },
      { title: 'Future thing', status: 'open', dueAt: '2026-07-30T08:00:00' }
    ] },
    crashLog: { tail: () => [{ timestamp: '2026-07-25T13:50:00', message: 'boom' }] },
    nightShift: { entriesSince: () => [{ ok: false, name: 'Daily social draft', text: 'failed' }] },
    now
  });
  assert.equal(checks.length, 3);
  const results = [];
  for (const check of checks) results.push(await check.run(new Date('2026-07-25T13:00:00').getTime()));
  assert.match(results[0].message, /1 task.*overdue|overdue/i);
  assert.match(results[0].message, /Order fittings/);
  assert.match(results[1].message, /error|crash/i);
  assert.match(results[2].message, /night shift|Daily social draft/i);
});

test('default checks return null when everything is fine', async () => {
  const checks = buildDefaultChecks({
    tasks: { list: () => [] },
    crashLog: { tail: () => [] },
    nightShift: { entriesSince: () => [] },
    now: () => DAY
  });
  for (const check of checks) {
    assert.equal(await check.run(Date.now()), null);
  }
});
