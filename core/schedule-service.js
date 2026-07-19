'use strict';

const { nextRunAt, dueSince, pickNext } = require('./schedule-times');
const { isWithinWindow } = require('./autonomy-rules');

// Below the 32-bit setTimeout ceiling (~24.8 days). If the next occurrence is
// further out than this, we arm a timer for the cap and re-check on fire
// instead of scheduling a delay Node would silently truncate.
const MAX_DELAY_MS = 2_000_000_000;

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
    this.armedFor = null; // { id, capped } — what the pending timer is waiting on
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

  arm() {
    this.stop();
    if (!this.#enabled()) return;

    const items = this.store.list();
    const picked = pickNext(items, this.now());
    if (!picked) return;

    const rawDelay = picked.at.getTime() - this.now().getTime();
    const delay = Math.max(0, rawDelay);
    const capped = delay > MAX_DELAY_MS;
    const useDelay = capped ? MAX_DELAY_MS : delay;

    this.armedFor = { id: picked.item.id, capped };
    this.timer = this.setTimer(() => this.#onFire(picked.item.id, capped), useDelay);
  }

  async #onFire(id, capped) {
    if (capped) {
      // The real due time is still further out than we could schedule in one
      // hop — re-arm rather than running early.
      this.arm();
      return;
    }
    if (!this.#enabled()) {
      // Master switch flipped off between arming and firing. This timer has
      // already fired, so clear the stale handle/armedFor instead of leaving
      // them pointing at a dead timer.
      this.stop();
      return;
    }

    // No matter what happens inside runNow — action failure, a throwing
    // emit/log/store, anything — the scheduler must re-arm. A dead scheduler
    // is worse than one late or duplicated run.
    try {
      await this.runNow(id, { late: false });
    } finally {
      this.arm();
    }
  }

  async #catchUp() {
    const now = this.now();
    const items = this.store.list();
    for (const item of items) {
      if (!item || !item.enabled || !item.lastRunAt) continue;
      const from = new Date(item.lastRunAt);
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

      const quiet = isWithinWindow(now, settings.autonomyNightStart, settings.autonomyNightEnd);
      if (!quiet) {
        this.emit('autonomy:event', { speak: text });
      }

      this.log.write({ type: 'schedule', command: item.name, response: text, source: 'schedule' });

      // Known, accepted tradeoff: lastRunAt is stamped only after the action
      // above completes. If the process crashes between the action finishing
      // and this write landing, the occurrence reruns once on restart (the
      // catch-up path will label it late rather than silently dropping it).
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
