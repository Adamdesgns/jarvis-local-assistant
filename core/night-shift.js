'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isWithinWindow } = require('./autonomy-rules');

// The night shift: scheduled brain jobs that run unattended and leave DRAFT
// files behind — never sends, never deletes. Rails are enforced here in code,
// not in prompts: night-window gating, a wall-clock cap, a per-night job cap,
// and cloud inference locked off unless Adam both asks per-job and raises the
// cloud budget above zero. Receipts go to night-shift.jsonl (same discipline
// as ActivityLog: logging must never take the service down).
class NightShiftService {
  constructor({ userDataPath, config, ai, documents, now = () => new Date() }) {
    this.filePath = path.join(userDataPath, 'night-shift.jsonl');
    this.config = config;
    this.ai = ai;
    this.documents = documents;
    this.now = now;
  }

  #settings() {
    const s = this.config.getSettings();
    return {
      enabled: s.nightShiftEnabled === true,
      start: Number.isFinite(Number(s.nightShiftStart)) ? Number(s.nightShiftStart) : 0,
      end: Number.isFinite(Number(s.nightShiftEnd)) ? Number(s.nightShiftEnd) : 6,
      maxJobs: Number(s.nightShiftMaxJobs) > 0 ? Number(s.nightShiftMaxJobs) : 10,
      maxMinutes: Number(s.nightShiftMaxMinutes) > 0 ? Number(s.nightShiftMaxMinutes) : 10,
      cloudBudget: Number(s.nightShiftCloudBudgetUsd) > 0 ? Number(s.nightShiftCloudBudgetUsd) : 0,
      folder: s.nightShiftFolder || ''
    };
  }

  #append(entry) {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch {
      // Receipts must never take the night shift down.
    }
  }

  #entries() {
    try {
      return fs.readFileSync(this.filePath, 'utf8')
        .trim().split('\n').filter(Boolean)
        .map((line) => { try { return JSON.parse(line); } catch { return null; } })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  doneCount() {
    return this.#entries().filter((entry) => entry.type === 'job' && entry.ok).length;
  }

  entriesSince(sinceMs) {
    return this.#entries().filter((entry) => entry.type === 'job' && Date.parse(entry.finishedAt) > sinceMs);
  }

  // Jobs finished since the last morning report was delivered.
  pendingReport() {
    let lastReport = 0;
    const jobs = [];
    for (const entry of this.#entries()) {
      if (entry.type === 'report') lastReport = Math.max(lastReport, Date.parse(entry.at));
      if (entry.type === 'job') jobs.push(entry);
    }
    return jobs.filter((entry) => Date.parse(entry.finishedAt) > lastReport);
  }

  markReported() {
    this.#append({ type: 'report', at: this.now().toISOString() });
  }

  // The current night began at the most recent occurrence of the start hour.
  #nightStartMs(now, startHour) {
    const start = new Date(now);
    start.setHours(startHour, 0, 0, 0);
    if (start.getTime() > now.getTime()) start.setDate(start.getDate() - 1);
    return start.getTime();
  }

  async runJob(item, { late = false } = {}) {
    const settings = this.#settings();
    const now = this.now();
    const startedAt = now.toISOString();
    const finish = (ok, text, extra = {}) => {
      this.#append({
        type: 'job', name: item.name, ok, text,
        startedAt, finishedAt: this.now().toISOString(), ...extra
      });
      return { ok, text };
    };

    if (!settings.enabled) {
      return finish(false, 'The night shift is switched off in Settings.');
    }

    // On-time fires only run inside the night window; late catch-up runs are
    // allowed any time — the PC was asleep when the job was due.
    const inWindow = settings.start !== settings.end && isWithinWindow(now, settings.start, settings.end);
    if (!late && !inWindow) {
      return finish(false, `This job only runs during night shift hours (${settings.start}:00–${settings.end}:00).`);
    }

    // Per-night cap counts jobs attempted since the night began.
    const attemptedTonight = this.#entries().filter((entry) => entry.type === 'job'
      && Date.parse(entry.startedAt) >= this.#nightStartMs(now, settings.start)).length;
    if (attemptedTonight >= settings.maxJobs) {
      return finish(false, `Night shift limit reached (${settings.maxJobs} jobs tonight).`);
    }

    // Cloud inference needs BOTH the job opting in and a budget above zero.
    const cloudAllowed = item.action.cloud === true && settings.cloudBudget > 0;
    const context = { unattended: true, project: item.action.project || 'general' };
    if (!cloudAllowed) context.forceMode = 'local';

    try {
      const capMs = settings.maxMinutes * 60 * 1000;
      let timeoutHandle;
      const answer = await Promise.race([
        this.ai.reply(item.action.prompt, context),
        new Promise((_resolve, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error(`The job took too long (over ${settings.maxMinutes} minutes) and was stopped.`)), capMs);
        })
      ]).finally(() => clearTimeout(timeoutHandle));

      const dateStamp = now.toISOString().slice(0, 10);
      const body = `# ${item.name} — ${dateStamp}\n\n${answer}\n\n---\n*Drafted by the JARVIS night shift. Nothing has been sent or posted.*\n`;
      const draft = await this.documents.createTextFileAt(settings.folder, `${dateStamp} ${item.name}`, body, '.md');
      return finish(true, `Draft saved: ${path.basename(draft.path)}`, { path: draft.path });
    } catch (error) {
      return finish(false, error && error.message ? error.message : String(error));
    }
  }
}

module.exports = { NightShiftService };
