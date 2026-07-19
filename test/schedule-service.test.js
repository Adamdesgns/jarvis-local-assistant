const test = require('node:test');
const assert = require('node:assert/strict');
const { ScheduleService } = require('../core/schedule-service');

function at(y, m, d, h, min) {
  return new Date(y, m - 1, d, h, min, 0, 0);
}

function item(over = {}) {
  return {
    id: 'a',
    name: 'Morning briefing',
    enabled: true,
    lastRunAt: null,
    lastResult: null,
    when: { time: '07:00', repeat: 'daily', weekday: null },
    action: { kind: 'speak', text: 'Good morning, sir.' },
    ...over
  };
}

function fakeStore(items) {
  const list = items;
  const runs = [];
  return {
    _runs: runs,
    list: () => list.map((it) => ({ ...it, when: { ...it.when }, action: { ...it.action } })),
    markRun: (id, payload) => {
      runs.push({ id, ...payload });
      const found = list.find((it) => it.id === id);
      if (found) {
        found.lastRunAt = payload.at;
        found.lastResult = { at: payload.at, ok: payload.ok, text: payload.text };
      }
      return found || null;
    }
  };
}

function fakeConfig(settings) {
  return { getSettings: () => settings };
}

function fakeRouter(impl) {
  const calls = [];
  return {
    calls,
    handle: async (prompt, project, opts) => {
      calls.push({ prompt, project, opts });
      if (impl) return impl(prompt, project, opts);
      return { response: 'Router reply.' };
    }
  };
}

function fakeEmit() {
  const calls = [];
  const emit = (channel, payload) => calls.push({ channel, payload });
  emit.calls = calls;
  return emit;
}

function fakeLog() {
  const writes = [];
  return { writes, write: (entry) => writes.push(entry) };
}

function fakeTimer() {
  const created = []; // { fn, delay }
  const setTimer = (fn, delay) => {
    const handle = { fn, delay };
    created.push(handle);
    return handle;
  };
  const cleared = [];
  const clearTimer = (handle) => cleared.push(handle);
  return { created, cleared, setTimer, clearTimer };
}

function baseSettings(over = {}) {
  return {
    schedulesEnabled: true,
    autonomyNightStart: 21,
    autonomyNightEnd: 7,
    ...over
  };
}

test('start() with the master switch off sets no timer and emits nothing', async () => {
  const store = fakeStore([item()]);
  const timer = fakeTimer();
  const emit = fakeEmit();
  const log = fakeLog();
  const svc = new ScheduleService({
    store,
    config: fakeConfig(baseSettings({ schedulesEnabled: false })),
    router: fakeRouter(),
    emit,
    log,
    now: () => at(2026, 7, 19, 6, 0),
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer
  });

  await svc.start();

  assert.equal(timer.created.length, 0);
  assert.equal(emit.calls.length, 0);
});

test('start() with one daily item sets exactly one timer with the correct delay', async () => {
  const store = fakeStore([item()]);
  const timer = fakeTimer();
  const now = at(2026, 7, 19, 6, 0);
  const svc = new ScheduleService({
    store,
    config: fakeConfig(baseSettings()),
    router: fakeRouter(),
    emit: fakeEmit(),
    log: fakeLog(),
    now: () => now,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer
  });

  await svc.start();

  assert.equal(timer.created.length, 1);
  const expectedAt = at(2026, 7, 19, 7, 0);
  assert.equal(timer.created[0].delay, expectedAt.getTime() - now.getTime());
});

test('invoking the captured timer callback runs the action, calls markRun, and arms exactly one new timer', async () => {
  const it = item();
  const store = fakeStore([it]);
  const timer = fakeTimer();
  let current = at(2026, 7, 19, 6, 0);
  const svc = new ScheduleService({
    store,
    config: fakeConfig(baseSettings()),
    router: fakeRouter(),
    emit: fakeEmit(),
    log: fakeLog(),
    now: () => current,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer
  });

  await svc.start();
  assert.equal(timer.created.length, 1);

  // Move "now" to the fire time and invoke the captured callback.
  current = at(2026, 7, 19, 7, 0);
  const fired = timer.created[0];
  await fired.fn();

  assert.equal(store._runs.length, 1);
  assert.equal(store._runs[0].id, 'a');
  assert.equal(store._runs[0].ok, true);
  // Exactly one new timer armed after the fire — the no-polling guarantee.
  assert.equal(timer.created.length, 2);
  // And the fired timer's own handle was actually cancelled, not just
  // superseded — proves arm() cancels rather than merely replacing.
  assert.ok(timer.cleared.includes(fired));
});

test('speak action emits autonomy:event with the text', async () => {
  const it = item({ action: { kind: 'speak', text: 'Time to stretch, sir.' } });
  const store = fakeStore([it]);
  const timer = fakeTimer();
  let current = at(2026, 7, 19, 6, 0);
  const emit = fakeEmit();
  const svc = new ScheduleService({
    store,
    config: fakeConfig(baseSettings()),
    router: fakeRouter(),
    emit,
    log: fakeLog(),
    now: () => current,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer
  });

  await svc.start();
  current = at(2026, 7, 19, 7, 0);
  await timer.created[0].fn();

  const speakEvents = emit.calls.filter((c) => c.channel === 'autonomy:event');
  assert.equal(speakEvents.length, 1);
  assert.deepEqual(speakEvents[0].payload, { speak: 'Time to stretch, sir.' });
});

test('ask action calls router.handle(prompt, "general", { unattended: true }) and speaks the response', async () => {
  const it = item({ action: { kind: 'ask', prompt: 'What is on my plate today?' } });
  const store = fakeStore([it]);
  const timer = fakeTimer();
  let current = at(2026, 7, 19, 6, 0);
  const emit = fakeEmit();
  const router = fakeRouter(async () => ({ response: 'You have three open tasks.' }));
  const svc = new ScheduleService({
    store,
    config: fakeConfig(baseSettings()),
    router,
    emit,
    log: fakeLog(),
    now: () => current,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer
  });

  await svc.start();
  current = at(2026, 7, 19, 7, 0);
  await timer.created[0].fn();

  assert.equal(router.calls.length, 1);
  assert.equal(router.calls[0].prompt, 'What is on my plate today?');
  assert.equal(router.calls[0].project, 'general');
  assert.deepEqual(router.calls[0].opts, { unattended: true });

  const speakEvents = emit.calls.filter((c) => c.channel === 'autonomy:event');
  assert.equal(speakEvents.length, 1);
  assert.deepEqual(speakEvents[0].payload, { speak: 'You have three open tasks.' });
});

test('quiet hours: no speak emitted, but the log is still written', async () => {
  const it = item({ action: { kind: 'speak', text: 'Overnight reminder.' }, when: { time: '02:00', repeat: 'daily', weekday: null } });
  const store = fakeStore([it]);
  const timer = fakeTimer();
  let current = at(2026, 7, 19, 1, 0);
  const emit = fakeEmit();
  const log = fakeLog();
  const svc = new ScheduleService({
    store,
    config: fakeConfig(baseSettings({ autonomyNightStart: 21, autonomyNightEnd: 7 })),
    router: fakeRouter(),
    emit,
    log,
    now: () => current,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer
  });

  await svc.start();
  current = at(2026, 7, 19, 2, 0);
  await timer.created[0].fn();

  const speakEvents = emit.calls.filter((c) => c.channel === 'autonomy:event');
  assert.equal(speakEvents.length, 0);
  assert.equal(log.writes.length, 1);
  assert.equal(log.writes[0].type, 'schedule');
  assert.equal(log.writes[0].command, it.name);
});

test('catch-up: an item whose time passed since lastRunAt runs on start() with text beginning "This was due at"', async () => {
  const it = item({
    when: { time: '07:00', repeat: 'daily', weekday: null },
    lastRunAt: at(2026, 7, 18, 7, 0).toISOString()
  });
  const store = fakeStore([it]);
  const timer = fakeTimer();
  // "Now" is 08:00 the next day — the 07:00 occurrence already passed since lastRunAt.
  const current = at(2026, 7, 19, 8, 0);
  const emit = fakeEmit();
  const log = fakeLog();
  const svc = new ScheduleService({
    store,
    config: fakeConfig(baseSettings()),
    router: fakeRouter(),
    emit,
    log,
    now: () => current,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer
  });

  await svc.start();

  assert.equal(store._runs.length, 1);
  assert.ok(store._runs[0].text.startsWith('This was due at'));
  const speakEvents = emit.calls.filter((c) => c.channel === 'autonomy:event');
  assert.equal(speakEvents.length, 1);
  assert.ok(speakEvents[0].payload.speak.startsWith('This was due at'));
  // A timer for the *next* occurrence should still be armed after catch-up.
  assert.equal(timer.created.length, 1);
});

test('calling arm() a second time clears the first timer handle instead of leaking it', async () => {
  const store = fakeStore([item()]);
  const timer = fakeTimer();
  const now = at(2026, 7, 19, 6, 0);
  const svc = new ScheduleService({
    store,
    config: fakeConfig(baseSettings()),
    router: fakeRouter(),
    emit: fakeEmit(),
    log: fakeLog(),
    now: () => now,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer
  });

  svc.arm();
  const firstHandle = timer.created[0];
  assert.equal(timer.cleared.length, 0);

  svc.arm();

  assert.equal(timer.created.length, 2);
  // Proves the old timer was actually cancelled, not just replaced —
  // created.length alone would look identical either way.
  assert.ok(timer.cleared.includes(firstHandle));
});

test('stop() clears the pending timer and nulls timer/armedFor state', async () => {
  const store = fakeStore([item()]);
  const timer = fakeTimer();
  const now = at(2026, 7, 19, 6, 0);
  const svc = new ScheduleService({
    store,
    config: fakeConfig(baseSettings()),
    router: fakeRouter(),
    emit: fakeEmit(),
    log: fakeLog(),
    now: () => now,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer
  });

  svc.arm();
  const firstHandle = timer.created[0];

  svc.stop();

  assert.ok(timer.cleared.includes(firstHandle));
  assert.equal(svc.timer, null);
  assert.equal(svc.armedFor, null);
});

test('#onFire clears stale timer/armedFor state when schedulesEnabled flips off before firing', async () => {
  const store = fakeStore([item()]);
  const timer = fakeTimer();
  let current = at(2026, 7, 19, 6, 0);
  const settings = baseSettings();
  const svc = new ScheduleService({
    store,
    config: fakeConfig(settings),
    router: fakeRouter(),
    emit: fakeEmit(),
    log: fakeLog(),
    now: () => current,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer
  });

  await svc.start();
  assert.equal(timer.created.length, 1);
  assert.notEqual(svc.timer, null);

  // Flip the master switch off between arming and the timer firing.
  settings.schedulesEnabled = false;
  current = at(2026, 7, 19, 7, 0);
  await timer.created[0].fn();

  assert.equal(svc.timer, null);
  assert.equal(svc.armedFor, null);
  // Disabled — nothing should have been (re-)armed.
  assert.equal(timer.created.length, 1);
});

test('formatClock renders a 12-hour AM/PM time regardless of host locale defaults', async () => {
  const it = item({
    when: { time: '07:00', repeat: 'daily', weekday: null },
    lastRunAt: at(2026, 7, 18, 7, 0).toISOString()
  });
  const store = fakeStore([it]);
  const timer = fakeTimer();
  // "Now" is 08:00 the next day — the 07:00 occurrence already passed since lastRunAt.
  const current = at(2026, 7, 19, 8, 0);
  const svc = new ScheduleService({
    store,
    config: fakeConfig(baseSettings()),
    router: fakeRouter(),
    emit: fakeEmit(),
    log: fakeLog(),
    now: () => current,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer
  });

  await svc.start();

  assert.equal(store._runs.length, 1);
  assert.match(store._runs[0].text, /^This was due at 7:00 AM, sir\./);
});

test('a store whose markRun throws still leaves the scheduler armed', async () => {
  const it = item();
  const store = fakeStore([it]);
  store.markRun = () => { throw new Error('disk full'); };
  const timer = fakeTimer();
  let current = at(2026, 7, 19, 6, 0);
  const svc = new ScheduleService({
    store,
    config: fakeConfig(baseSettings()),
    router: fakeRouter(),
    emit: fakeEmit(),
    log: fakeLog(),
    now: () => current,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer
  });

  await svc.start();
  assert.equal(timer.created.length, 1);

  current = at(2026, 7, 19, 7, 0);
  await assert.doesNotReject(async () => { await timer.created[0].fn(); });

  // The scheduler must still be armed even though persisting the run failed.
  assert.equal(timer.created.length, 2);
  assert.notEqual(svc.timer, null);
});

test('a router that rejects records ok: false, does not throw, and the timer is still armed', async () => {
  const it = item({ action: { kind: 'ask', prompt: 'Summarize my inbox.' } });
  const store = fakeStore([it]);
  const timer = fakeTimer();
  let current = at(2026, 7, 19, 6, 0);
  const router = fakeRouter(async () => { throw new Error('Network unavailable'); });
  const svc = new ScheduleService({
    store,
    config: fakeConfig(baseSettings()),
    router,
    emit: fakeEmit(),
    log: fakeLog(),
    now: () => current,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer
  });

  await svc.start();
  current = at(2026, 7, 19, 7, 0);
  await assert.doesNotReject(async () => { await timer.created[0].fn(); });

  assert.equal(store._runs.length, 1);
  assert.equal(store._runs[0].ok, false);
  assert.match(store._runs[0].text, /Network unavailable/);
  // Exactly one new timer armed after the fire, despite the failure.
  assert.equal(timer.created.length, 2);
});
