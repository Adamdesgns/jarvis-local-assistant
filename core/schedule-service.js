'use strict';

const { nextRunAt, dueSince, pickNext } = require('./schedule-times');
const { isWithinWindow } = require('./autonomy-rules');

// Below the 32-bit setTimeout ceiling (~24.8 days). If the next occurrence is
// further out than this, we arm a timer for the cap and re-check on fire
// instead of scheduling a delay Node would silently truncate.
const MAX_DELAY_MS = 2_000_000_000;

const BRIEFING_PROMPT = 'Give me a daily briefing: my open tasks, anything overdue, and anything the cameras saw overnight.';

function formatClock(date) {
  return new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).format(date);
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
    if (!this.#enabled()) return;

    await this.runNow(id, { late: false });
    this.arm();
  }

  async #catchUp() {
    const now = this.now();
    const items = this.store.list();
    for (const item of items) {
      if (!item || !item.enabled || !item.lastRunAt) continue;
      const from = new Date(item.lastRunAt);
      const due = nextRunAt(item, from);
      if (due && dueSince(item, from, now)) {
        await this.runNow(item.id, { late: true, dueAt: due });
      }
    }
  }

  async runNow(id, { late = false, dueAt = null } = {}) {
    const items = this.store.list();
    const item = items.find((entry) => entry.id === id);
    if (!item) return { ok: false, text: 'That schedule no longer exists.' };

    const now = this.now();
    const settings = this.config.getSettings();
    let ok = true;
    let text = '';

    try {
      text = await this.#runAction(item);
    } catch (error) {
      ok = false;
      text = error && error.message ? error.message : String(error);
    }

    if (late) {
      const due = dueAt || nextRunAt(item, new Date(item.lastRunAt || now)) || now;
      text = `This was due at ${formatClock(due)}, sir. ${text}`;
    }

    const quiet = isWithinWindow(now, settings.autonomyNightStart, settings.autonomyNightEnd);
    if (!quiet) {
      this.emit('autonomy:event', { speak: text });
    }

    this.log.write({ type: 'schedule', command: item.name, response: text, source: 'schedule' });
    this.store.markRun(id, { at: now.toISOString(), ok, text });

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
