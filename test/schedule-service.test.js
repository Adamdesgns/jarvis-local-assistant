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

test('speak action emits autonomy:event with both speak and a card (non-quiet run)', async () => {
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
  assert.equal(speakEvents[0].payload.speak, 'Time to stretch, sir.');
  assert.ok(speakEvents[0].payload.card, 'expected a card even on a non-quiet run');
  assert.equal(speakEvents[0].payload.card.body, 'Time to stretch, sir.');
  assert.equal(speakEvents[0].payload.card.title, `SCHEDULE — ${it.name}`);
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
  assert.equal(speakEvents[0].payload.speak, 'You have three open tasks.');
  assert.ok(speakEvents[0].payload.card, 'expected a card even on a non-quiet run');
  assert.equal(speakEvents[0].payload.card.body, 'You have three open tasks.');
});

test('quiet hours: no speak emitted, but a card still reaches the screen and the log is written', async () => {
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

  // CRITICAL: quiet hours must suppress audio only — a card still has to reach
  // the screen, or overnight results are invisible until the user asks.
  const events = emit.calls.filter((c) => c.channel === 'autonomy:event');
  assert.equal(events.length, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(events[0].payload, 'speak'), false);
  assert.ok(events[0].payload.card, 'expected a card during quiet hours');
  assert.equal(events[0].payload.card.body, 'Overnight reminder.');
  assert.equal(log.writes.length, 1);
  assert.equal(log.writes[0].type, 'schedule');
  assert.equal(log.writes[0].command, it.name);
});

test('autonomyNightStart === autonomyNightEnd does not mean quiet — the run still speaks', async () => {
  // autonomy-rules.isWithinWindow treats start === end as "always" (a
  // deliberate choice for camera alerts). The scheduler must not borrow that
  // meaning verbatim, or every schedule item goes silent forever whenever a
  // user picks equal start/end hours in Settings.
  const it = item({ action: { kind: 'speak', text: 'Equal window test.' }, when: { time: '02:00', repeat: 'daily', weekday: null } });
  const store = fakeStore([it]);
  const timer = fakeTimer();
  let current = at(2026, 7, 19, 1, 0);
  const emit = fakeEmit();
  const svc = new ScheduleService({
    store,
    config: fakeConfig(baseSettings({ autonomyNightStart: 5, autonomyNightEnd: 5 })),
    router: fakeRouter(),
    emit,
    log: fakeLog(),
    now: () => current,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer
  });

  await svc.start();
  current = at(2026, 7, 19, 2, 0);
  await timer.created[0].fn();

  const events = emit.calls.filter((c) => c.channel === 'autonomy:event');
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.speak, 'Equal window test.');
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

test('an emit that throws still leaves the run persisted via markRun', async () => {
  const it = item();
  const store = fakeStore([it]);
  const timer = fakeTimer();
  let current = at(2026, 7, 19, 6, 0);
  const throwingEmit = () => { throw new Error('renderer window destroyed'); };
  const svc = new ScheduleService({
    store,
    config: fakeConfig(baseSettings()),
    router: fakeRouter(),
    emit: throwingEmit,
    log: fakeLog(),
    now: () => current,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer
  });

  await svc.start();
  current = at(2026, 7, 19, 7, 0);
  await assert.doesNotReject(async () => { await timer.created[0].fn(); });

  // markRun must still have been called even though emit blew up first.
  assert.equal(store._runs.length, 1);
  assert.equal(store._runs[0].id, 'a');
  assert.equal(store._runs[0].ok, false);
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

test('catch-up: a never-run item created before a passed due time catches up exactly once on start()', async () => {
  const it = item({
    when: { time: '07:00', repeat: 'daily', weekday: null },
    lastRunAt: null,
    createdAt: at(2026, 7, 18, 20, 0).toISOString() // created last night, well before today's 07:00
  });
  const store = fakeStore([it]);
  const timer = fakeTimer();
  const current = at(2026, 7, 19, 8, 0); // opened this morning, after the 07:00 due time
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
  assert.ok(store._runs[0].text.startsWith('This was due at'));
  // A timer for the *next* occurrence should still be armed after catch-up.
  assert.equal(timer.created.length, 1);
});

test('catch-up: an item created AFTER its due time today does not catch up', async () => {
  const it = item({
    when: { time: '07:00', repeat: 'daily', weekday: null },
    lastRunAt: null,
    createdAt: at(2026, 7, 19, 7, 30).toISOString() // created after 07:00 already passed
  });
  const store = fakeStore([it]);
  const timer = fakeTimer();
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

  assert.equal(store._runs.length, 0);
});

test('a store whose list() throws while running the scheduled action does not produce an unhandled rejection and the scheduler stays armed', async () => {
  const it = item();
  const store = fakeStore([it]);
  const originalList = store.list;
  let listCalls = 0;
  store.list = () => {
    listCalls += 1;
    // Call #3 is the one runNow() makes when the timer fires — simulate a
    // transient disk error there. The calls before/after (start()'s
    // catch-up, and the re-arm afterward) must keep working.
    if (listCalls === 3) throw new Error('disk read error');
    return originalList();
  };
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

  // A dead scheduler is worse than one late run: it must still be armed even
  // though runNow blew up before its own try/catch could even start.
  assert.equal(timer.created.length, 2);
  assert.notEqual(svc.timer, null);
});

test('a timer that fires ~1ms early does not re-arm for the same occurrence (no double-run)', async () => {
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

  const targetAt = at(2026, 7, 19, 7, 0);
  // Simulate libuv firing the timer ~1ms early: when the callback runs, the
  // injected clock still reads 1ms short of the armed occurrence.
  current = new Date(targetAt.getTime() - 1);
  await timer.created[0].fn();

  assert.equal(store._runs.length, 1); // the occurrence ran exactly once so far

  const secondTimer = timer.created[1];
  assert.ok(secondTimer, 'expected a re-arm after the early fire');
  // A buggy re-arm recomputes from the still-1ms-early clock, which is still
  // "before" today's 07:00 occurrence, so it gets re-selected — producing a
  // near-zero delay that fires again immediately (a duplicate run).
  assert.ok(secondTimer.delay > 1000, `expected the next arm to skip today's occurrence, got a ${secondTimer.delay}ms delay`);

  // Firing the re-armed timer must run a *new* occurrence (tomorrow), not
  // repeat today's.
  current = new Date(current.getTime() + secondTimer.delay);
  await secondTimer.fn();
  assert.equal(store._runs.length, 2);
});

test('#catchUp: a store.list() that throws does not reject start(), and start() still arms afterward', async () => {
  const it = item();
  const store = fakeStore([it]);
  const originalList = store.list;
  let listCalls = 0;
  store.list = () => {
    listCalls += 1;
    // First call is catch-up's read; simulate a transient disk error there.
    // The second call (arm()'s own store.list()) must still work.
    if (listCalls === 1) throw new Error('disk read error');
    return originalList();
  };
  const timer = fakeTimer();
  const log = fakeLog();
  const now = at(2026, 7, 19, 6, 0);
  const svc = new ScheduleService({
    store,
    config: fakeConfig(baseSettings()),
    router: fakeRouter(),
    emit: fakeEmit(),
    log,
    now: () => now,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer
  });

  await assert.doesNotReject(async () => { await svc.start(); });

  // Catch-up's failure must not prevent the eventual arm().
  assert.equal(timer.created.length, 1);
  // And the failure must be logged, not silently swallowed.
  assert.ok(log.writes.some((w) => w.type === 'schedule-error'));
});

test('two schedules set to the same time both fire, and only one re-arm happens', async () => {
  const briefing = item({ id: 'briefing', name: 'Morning briefing', when: { time: '07:00', repeat: 'daily', weekday: null }, action: { kind: 'speak', text: 'Good morning, sir.' } });
  const meds = item({ id: 'meds', name: 'Take meds', when: { time: '07:00', repeat: 'daily', weekday: null }, action: { kind: 'speak', text: 'Time for your meds, sir.' } });
  const store = fakeStore([briefing, meds]);
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
  assert.equal(timer.created.length, 1);

  current = at(2026, 7, 19, 7, 0);
  await timer.created[0].fn();

  // Both items due at the same instant must have run.
  assert.equal(store._runs.length, 2);
  assert.deepEqual(store._runs.map((r) => r.id).sort(), ['briefing', 'meds']);
  const speakEvents = emit.calls.filter((c) => c.channel === 'autonomy:event');
  assert.equal(speakEvents.length, 2);

  // Exactly one re-arm for the tied fire, not one per item.
  assert.equal(timer.created.length, 2);
});

test('a failure in the first same-time item does not stop the second from running', async () => {
  const failing = item({ id: 'failing', name: 'Broken ask', when: { time: '07:00', repeat: 'daily', weekday: null }, action: { kind: 'ask', prompt: 'Summarize my inbox.' } });
  const ok = item({ id: 'ok', name: 'Take meds', when: { time: '07:00', repeat: 'daily', weekday: null }, action: { kind: 'speak', text: 'Time for your meds, sir.' } });
  const store = fakeStore([failing, ok]);
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

  assert.equal(store._runs.length, 2);
  const byId = Object.fromEntries(store._runs.map((r) => [r.id, r]));
  assert.equal(byId.failing.ok, false);
  assert.match(byId.failing.text, /Network unavailable/);
  assert.equal(byId.ok.ok, true);

  // Still exactly one re-arm despite the first item's failure.
  assert.equal(timer.created.length, 2);
});
