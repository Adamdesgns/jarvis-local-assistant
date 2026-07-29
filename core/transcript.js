const fs = require('node:fs');
const path = require('node:path');

// A rolling, human-readable record of what was said — both sides — so a line
// can be copied back out a day or two after the fact (Adam, 2026-07-28: "I
// wouldn't mind a record of what he says daily saved for 24-48 hours in case
// we need to copy and paste anything").
//
// Deliberately NOT an archive, and that constraint is the design:
//   * one plain-text file per day, because the whole point is pasting it
//     somewhere — JSONL would make him unwrap it first;
//   * every file outside the window is deleted on the next append, so the
//     24-48 hours is enforced by construction rather than by a cleanup job
//     that can silently stop running;
//   * only files matching this class's own naming are ever deleted, so a
//     stray file in the folder is never collateral.
//
// This is separate from activity.jsonl on purpose. That log is structured
// events for diagnostics; this is prose for a human to read and copy.
const KEEP_DAYS = 2;
const FILE_PATTERN = /^(\d{4}-\d{2}-\d{2})\.txt$/;

const pad = (value) => String(value).padStart(2, '0');

// Local date, never UTC. "Today's transcript" has to mean HIS today — an
// ISO slice would roll the file over at 7pm Central and split an evening
// conversation across two files.
function dayKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function clockStamp(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

class Transcript {
  constructor(userDataPath, { keepDays = KEEP_DAYS } = {}) {
    this.dir = path.join(userDataPath, 'transcripts');
    this.keepDays = Math.max(1, Number(keepDays) || KEEP_DAYS);
  }

  fileFor(date = new Date()) {
    return path.join(this.dir, `${dayKey(date)}.txt`);
  }

  // True when a line was actually recorded. Never throws and never rethrows:
  // failing to journal a sentence must not cost the user their answer.
  append(speaker, text, now = new Date()) {
    const line = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (!line) return false;
    const who = speaker === 'jarvis' ? 'JARVIS' : 'YOU';
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.appendFileSync(this.fileFor(now), `[${clockStamp(now)}] ${who}: ${line}\n`, 'utf8');
      this.prune(now);
      return true;
    } catch {
      return false;
    }
  }

  // Everything still inside the window, oldest day first, ready to paste.
  read(now = new Date()) {
    return this.#liveKeys(now)
      .map((key) => {
        let body = '';
        try {
          body = fs.readFileSync(path.join(this.dir, `${key}.txt`), 'utf8');
        } catch {
          return '';
        }
        return body.trim() ? `--- ${key} ---\n${body.trim()}` : '';
      })
      .filter(Boolean)
      .join('\n\n');
  }

  // Returns how many files it removed, so a caller can log a real number.
  prune(now = new Date()) {
    const live = new Set(this.#liveKeys(now));
    let names = [];
    try {
      names = fs.readdirSync(this.dir);
    } catch {
      return 0;
    }
    let removed = 0;
    for (const name of names) {
      const match = FILE_PATTERN.exec(name);
      if (!match || live.has(match[1])) continue;
      try {
        fs.unlinkSync(path.join(this.dir, name));
        removed += 1;
      } catch {
        // A locked file just survives to the next append.
      }
    }
    return removed;
  }

  // Today and the days behind it that are still in the window, oldest first.
  // Walking back by calendar day rather than by 24h multiples keeps this
  // correct across a DST change, where a "day" is 23 or 25 hours long.
  #liveKeys(now) {
    const keys = [];
    for (let back = 0; back < this.keepDays; back += 1) {
      const day = new Date(now.getTime());
      day.setDate(day.getDate() - back);
      keys.push(dayKey(day));
    }
    return keys.reverse();
  }
}

module.exports = { Transcript, dayKey, KEEP_DAYS };
