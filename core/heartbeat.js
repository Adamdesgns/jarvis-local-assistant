'use strict';

const { isWithinWindow } = require('./autonomy-rules');

// The heartbeat: JARVIS quietly checks a short list every interval and only
// speaks when something genuinely needs attention. Silent when all is well,
// card-only during quiet hours, and a finding is announced once — not nagged
// about every half hour. Zoey-wave idea, JARVIS discipline.
class HeartbeatService {
  constructor({ config, checks = [], emit, log, now = () => new Date(), setTimer = setTimeout, clearTimer = clearTimeout }) {
    this.config = config;
    this.checks = checks;
    this.emit = emit || (() => {});
    this.log = log || { write: () => {} };
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.timer = null;
    this.lastTickMs = this.now().getTime();
    this.lastAnnounced = '';
  }

  #settings() {
    try { return this.config.getSettings(); } catch { return {}; }
  }

  #intervalMs() {
    const minutes = Number(this.#settings().heartbeatMinutes);
    return (Number.isFinite(minutes) && minutes >= 1 ? minutes : 30) * 60 * 1000;
  }

  start() {
    this.stop();
    this.timer = this.setTimer(() => this.#tick(), this.#intervalMs());
  }

  stop() {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  async #tick() {
    const sinceMs = this.lastTickMs;
    this.lastTickMs = this.now().getTime();
    try {
      const settings = this.#settings();
      if (settings.heartbeatEnabled === true) {
        const findings = [];
        for (const check of this.checks) {
          try {
            const finding = await check.run(sinceMs);
            if (finding && finding.message) findings.push(finding.message);
          } catch {
            // One broken check must not stop the rest — or the heartbeat.
          }
        }
        if (findings.length) {
          const body = findings.join(' ');
          if (body !== this.lastAnnounced) {
            this.lastAnnounced = body;
            const nightStart = Number(settings.autonomyNightStart);
            const nightEnd = Number(settings.autonomyNightEnd);
            const quiet = Number.isFinite(nightStart) && Number.isFinite(nightEnd) && nightStart !== nightEnd
              && isWithinWindow(this.now(), nightStart, nightEnd);
            this.emit('autonomy:event', {
              ...(quiet ? {} : { speak: body }),
              card: { title: 'HEARTBEAT', body }
            });
            this.log.write({ actor: 'heartbeat', type: 'heartbeat', command: 'check-in', response: body, source: 'heartbeat' });
          }
        } else {
          this.lastAnnounced = '';
        }
      }
    } finally {
      // The heartbeat must never die — re-arm no matter what happened above.
      this.start();
    }
  }
}

// The v1 checklist. Each check gets sinceMs (the previous tick) and returns
// null when there is nothing worth saying.
function buildDefaultChecks({ tasks, crashLog, nightShift, now = () => new Date() }) {
  return [
    {
      name: 'overdue-tasks',
      run: async () => {
        const overdue = (tasks.list() || []).filter((task) => task.status === 'open'
          && task.dueAt && new Date(task.dueAt).getTime() < now().getTime());
        if (!overdue.length) return null;
        const names = overdue.slice(0, 3).map((task) => task.title).join(', ');
        return { message: `${overdue.length} task${overdue.length > 1 ? 's are' : ' is'} overdue: ${names}.` };
      }
    },
    {
      name: 'crash-entries',
      run: async (sinceMs) => {
        const fresh = (crashLog.tail(10) || []).filter((entry) => Date.parse(entry.timestamp) > sinceMs);
        if (!fresh.length) return null;
        return { message: `I logged ${fresh.length} unexpected error${fresh.length > 1 ? 's' : ''} since my last check — see crash.log.` };
      }
    },
    {
      name: 'night-shift-failures',
      run: async (sinceMs) => {
        const failed = (nightShift.entriesSince(sinceMs) || []).filter((entry) => entry.ok === false);
        if (!failed.length) return null;
        const names = failed.slice(0, 3).map((entry) => entry.name).join(', ');
        return { message: `The night shift hit trouble with: ${names}.` };
      }
    }
  ];
}

module.exports = { HeartbeatService, buildDefaultChecks };
