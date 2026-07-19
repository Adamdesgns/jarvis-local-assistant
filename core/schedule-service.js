'use strict';

const { nextRunAt, dueSince, pickNext } = require('./schedule-times');
const { isWithinWindow } = require('./autonomy-rules');

const BRIEFING_PROMPT = 'Give me a daily briefing: my open tasks, anything overdue, and anything the cameras saw overnight.';

function formatClock(date) {
  return new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit', hour12: true }).format(date);
}

// Holds exactly one pending timer, aimed at the soonest enabled schedule
// item. Never polls: arm() clears any existing timer before setting a new
// one, and every fire path re-arms exactly once before returning.
class ScheduleService {
  constructor({
    store,
    config,
    router,
    emit,
    log,
    now = () => new Date(),
    setTimer = setTimeout,
    clearTimer = clearTimeout
  }) {
    this.store = store;
    this.config = config;
    this.router = router;
    this.emit = emit || (() => {});
    this.log = log || { write: () => {} };
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.timer = null;
    this.armedFor = null; // { id, at } — what the pending timer is waiting on
  }

  #enabled() {
    try { return this.config.getSettings().schedulesEnabled === true; }
    catch { return false; }
  }

  async start() {
    if (!this.#enabled()) {
      this.stop();
      return;
    }
    await this.#catchUp();
    this.arm();
  }

  stop() {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
    }
    this.timer = null;
    this.armedFor = null;
  }

  // `floor`, if given, is a minimum reference instant for picking the next
  // occurrence — it must be used instead of now() when now() is earlier.
  // This matters when re-arming right after a fire: if the OS timer fired a
  // moment early, this.now() can still read a hair before the occurrence
  // that just ran, and pickNext(items, now()) would re-select that exact
  // same occurrence, producing a ~0ms delay and a duplicate run. Flooring on
  // the occurrence's own `at` (which is always >= the real fire time)
  // guarantees the search starts strictly after it, without holding back
  // any other item that's genuinely due sooner.
  arm(floor) {
    this.stop();
    if (!this.#enabled()) return;

    const items = this.store.list();
    const now = this.now();
    const searchFrom = floor && floor.getTime() > now.getTime() ? floor : now;
    const picked = pickNext(items, searchFrom);
    if (!picked) return;

    const rawDelay = picked.at.getTime() - now.getTime();
    const delay = Math.max(0, rawDelay);

    this.armedFor = { id: picked.item.id, at: picked.at };
    this.timer = this.setTimer(() => this.#onFire(picked.item.id, picked.at), delay);
  }

  async #onFire(id, at) {
    if (!this.#enabled()) {
      // Master switch flipped off between arming and firing. This timer has
      // already fired, so clear the stale handle/armedFor instead of leaving
      // them pointing at a dead timer.
      this.stop();
      return;
    }

    // No matter what happens inside runNow — action failure, a throwing
    // emit/log/store, even a throw from store.list() before runNow's own
    // try/catch starts — the scheduler must re-arm. A dead scheduler is
    // worse than one late or duplicated run. An uncaught rejection here
    // would escape this setTimeout callback with no handler and, under
    // current Node defaults, kill the process.
    try {
      await this.runNow(id, { late: false });
    } catch (error) {
      this.log.write({
        type: 'schedule-error',
        command: 'scheduler-fire',
        response: error && error.message ? error.message : String(error),
        source: 'schedule'
      });
    } finally {
      this.arm(at);
    }
  }

  async #catchUp() {
    const now = this.now();
    const items = this.store.list();
    for (const item of items) {
      if (!item || !item.enabled) continue;
      const from = new Date(item.lastRunAt || item.createdAt);
      const due = nextRunAt(item, from);
      if (due && dueSince(item, from, now)) {
        try {
          await this.runNow(item.id, { late: true, dueAt: due });
        } catch {
          // One failing catch-up item must not abort the loop, and must not
          // abort start() — the rest of the items (and the eventual arm())
          // still need to run.
        }
      }
    }
  }

  async runNow(id, { late = false, dueAt = null } = {}) {
    const items = this.store.list();
    const item = items.find((entry) => entry.id === id);
    if (!item) return { ok: false, text: 'That schedule no longer exists.' };

    const now = this.now();
    let ok = true;
    let text = '';

    try {
      text = await this.#runAction(item);
    } catch (error) {
      ok = false;
      text = error && error.message ? error.message : String(error);
    }

    // Everything past this point is bookkeeping (settings lookup, speaking,
    // logging, persisting). None of it may escape runNow — a throw here
    // (e.g. a disk error from store.markRun) must degrade to ok: false
    // rather than propagating and killing the caller's re-arm logic.
    try {
      const settings = this.config.getSettings();

      if (late) {
        const due = dueAt || nextRunAt(item, new Date(item.lastRunAt || now)) || now;
        text = `This was due at ${formatClock(due)}, sir. ${text}`;
      }

      // Quiet hours suppress AUDIO ONLY — a card must still reach the
      // screen, or overnight results are invisible until asked for.
      //
      // isWithinWindow() treats non-finite or equal start/end as "always
      // allowed" — a deliberate meaning for camera alerts (autonomy-rules.js)
      // that is the OPPOSITE of what we need here. Borrowing it verbatim
      // would make every scheduled task permanently silent for anyone who
      // picks equal start/end hours in Settings, with no error. So quiet
      // hours must be computed explicitly instead of trusting a bare
      // isWithinWindow() result.
      const nightStart = Number(settings.autonomyNightStart);
      const nightEnd = Number(settings.autonomyNightEnd);
      const quiet = Number.isFinite(nightStart) && Number.isFinite(nightEnd) && nightStart !== nightEnd
        && isWithinWindow(now, nightStart, nightEnd);

      this.emit('autonomy:event', {
        ...(quiet ? {} : { speak: text }),
        card: { title: `SCHEDULE — ${item.name}`, body: text }
      });

      this.log.write({ type: 'schedule', command: item.name, response: text, source: 'schedule' });
    } catch (error) {
      ok = false;
      text = error && error.message ? error.message : String(error);
    }

    // Persisting the run is kept in its own try/catch, separate from the
    // settings/emit/log block above, so a throwing emit (e.g. a dead IPC
    // channel) cannot skip markRun — the run still gets recorded even if
    // announcing it failed.
    try {
      this.store.markRun(id, { at: now.toISOString(), ok, text });
    } catch (error) {
      ok = false;
      text = error && error.message ? error.message : String(error);
    }

    return { ok, text };
  }

  async #runAction(item) {
    const { action } = item;
    if (action.kind === 'speak') {
      return action.text;
    }
    if (action.kind === 'ask') {
      const result = await this.router.handle(action.prompt, 'general', { unattended: true });
      return result.response;
    }
    if (action.kind === 'briefing') {
      const result = await this.router.handle(BRIEFING_PROMPT, 'general', { unattended: true });
      return result.response;
    }
    throw new Error(`Unknown action kind: ${action.kind}`);
  }
}

module.exports = { ScheduleService, BRIEFING_PROMPT };
