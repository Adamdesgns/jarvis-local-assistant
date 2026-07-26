'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// The activity log is JARVIS's receipt book. Two things make it worth trusting:
//
//   actor — WHO did the thing. 'jarvis' means he acted with you at the desk;
//     'night-shift', 'schedule', 'autonomy', 'heartbeat' and 'cameras' mean he
//     acted with nobody watching. That distinction is the whole point: the
//     morning report is only worth reading if it can say who was driving.
//
//   the seal — each line carries the fingerprint of the line before it, so the
//     file is a chain rather than a stack of loose notes. Edit a line or pull
//     one out of the middle and the chain no longer joins up, and verify()
//     says exactly where. A sidecar (activity.head.json) records the last
//     seal, which also catches lines lopped off the end.
//
// This is tamper-EVIDENT, not tamper-proof. Anything with write access to the
// folder could rewrite the whole file and re-seal it. What it stops is the
// quiet single-line edit, and what it gives you is a straight answer to "is
// this record still what JARVIS wrote?".
//
// Logging must never take the assistant down: every path here swallows its
// own errors, and verify() reports rather than throws.

// The actors that exist today. THE CREW (see docs/ROADMAP.md) will add named
// crew members, so any short slug is allowed through — this list is for
// readers, not a gate.
const KNOWN_ACTORS = Object.freeze([
  'user',        // the human, directly
  'jarvis',      // JARVIS answering you, at the desk
  'agent',       // the brain running steps unattended
  'night-shift', // overnight brain jobs
  'schedule',    // a scheduled task firing
  'autonomy',    // the autonomy rules acting on an event
  'cameras',     // the camera pipeline
  'heartbeat',   // the check-in timer
  'system'       // boot, settings, plumbing
]);

const ACTOR_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const GENESIS = '0'.repeat(64);
const RESERVED = ['seq', 'actor', 'prevHash', 'hash'];

function normalizeActor(actor) {
  if (typeof actor !== 'string') return 'system';
  const clean = actor.trim().toLowerCase();
  return ACTOR_PATTERN.test(clean) ? clean : 'system';
}

// Key order must not change the fingerprint — callers spread arbitrary objects
// into an entry, and JSON.stringify would otherwise hash the same facts two
// different ways. Sorting the keys makes the serialization canonical.
function canonical(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value === undefined ? null : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function sealOf(entry) {
  const unsealed = { ...entry };
  delete unsealed.hash;
  return crypto.createHash('sha256').update(canonical(unsealed)).digest('hex');
}

// A one-line, plain-English reading of a verify() result — or null when the
// log is intact and there is nothing worth saying.
function describeIntegrity(result) {
  if (!result || result.ok) return null;
  const where = Number.isFinite(result.brokenAt) ? ` (entry ${result.brokenAt})` : '';
  return `Heads up: the activity log has been altered${where}. ${result.reason}`;
}

class ActivityLog {
  #tail = null;

  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, 'activity.jsonl');
    this.headPath = path.join(userDataPath, 'activity.head.json');
  }

  // Where the chain currently ends. Cached after the first read so a growing
  // log doesn't cost a rescan on every write. The steady-state case parses one
  // line — the last one already carries both the seq and the hash we need.
  #readTail() {
    if (this.#tail) return this.#tail;
    const lines = this.#lines();
    const last = lines.length ? this.#parse(lines[lines.length - 1]) : null;
    if (last && typeof last.hash === 'string' && Number.isFinite(last.seq)) {
      this.#tail = { seq: last.seq, hash: last.hash };
      return this.#tail;
    }
    // An unsealed or unreadable last line means a log from before sealing (or
    // a truncated write). Count it out once so numbering carries on past the
    // legacy entries and the chain starts at genesis.
    let seq = 0;
    let hash = GENESIS;
    for (const line of lines) {
      const entry = this.#parse(line);
      if (entry && typeof entry.hash === 'string') hash = entry.hash;
      seq = entry && Number.isFinite(entry.seq) ? entry.seq : seq + 1;
    }
    this.#tail = { seq, hash };
    return this.#tail;
  }

  #lines() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8').trim();
      return raw ? raw.split('\n').filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  #parse(line) {
    try { return JSON.parse(line); } catch { return null; }
  }

  #readHead() {
    try {
      const head = JSON.parse(fs.readFileSync(this.headPath, 'utf8'));
      return head && Number.isFinite(head.seq) ? head : null;
    } catch {
      return null;
    }
  }

  write(event) {
    try {
      const tail = this.#readTail();
      const rest = { ...event };
      for (const key of RESERVED) delete rest[key];
      const record = {
        seq: tail.seq + 1,
        timestamp: new Date().toISOString(),
        actor: normalizeActor(event && event.actor),
        ...rest,
        prevHash: tail.hash
      };
      record.hash = sealOf(record);

      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, 'utf8');
      this.#tail = { seq: record.seq, hash: record.hash };
      try {
        fs.writeFileSync(this.headPath, JSON.stringify(this.#tail), 'utf8');
      } catch {
        // A missing sidecar only weakens the end-of-file check; the chain stands.
      }
    } catch {
      // Logging must never prevent the assistant from responding.
    }
  }

  // Walks backwards from the newest so only `limit` lines are ever parsed —
  // this runs on the boot path and the log is never rotated. Corrupt lines are
  // skipped rather than consuming a slot, so asking for 12 entries gets 12
  // real ones rather than 12 slots with holes in them.
  recent(limit = 20) {
    const lines = this.#lines();
    const entries = [];
    for (let i = lines.length - 1; i >= 0 && entries.length < limit; i -= 1) {
      const entry = this.#parse(lines[i]);
      if (entry) entries.push(entry);
    }
    return entries;
  }

  // Walk the chain and report whether the file is still what JARVIS wrote.
  // Entries written before this version have no seal; they are counted as
  // `legacy` and skipped rather than reported as tampering, so upgrading an
  // existing install doesn't cry wolf on day one.
  verify() {
    const lines = this.#lines();
    const tally = { checked: 0, legacy: 0, total: lines.length };
    const broken = (brokenAt, reason) => ({ ok: false, ...tally, brokenAt, reason });

    let prevHash = GENESIS;
    let lastHash = GENESIS;
    let lastSeq = 0;
    let started = false;

    for (let i = 0; i < lines.length; i += 1) {
      const position = i + 1;
      let entry = null;
      try { entry = JSON.parse(lines[i]); } catch { entry = null; }

      if (!entry || typeof entry.hash !== 'string') {
        if (started) {
          return broken(position, entry
            ? 'An entry with no seal was added after sealing began.'
            : 'An entry is no longer readable.');
        }
        tally.legacy += 1;
        continue;
      }

      started = true;
      if (entry.prevHash !== prevHash) {
        return broken(position, 'An entry does not follow the one before it — something was removed or reordered.');
      }
      if (sealOf(entry) !== entry.hash) {
        return broken(position, 'An entry was changed after it was written.');
      }

      prevHash = entry.hash;
      lastHash = entry.hash;
      lastSeq = Number.isFinite(entry.seq) ? entry.seq : lastSeq + 1;
      tally.checked += 1;
    }

    // Lopping lines off the end leaves a valid chain behind, so the sidecar is
    // what catches it. A sidecar BEHIND the file just means a write landed
    // before its sidecar update — not tampering.
    const head = this.#readHead();
    if (head && head.seq > lastSeq) {
      const missing = head.seq - lastSeq;
      return broken(lastSeq + 1, `The last ${missing} entr${missing === 1 ? 'y is' : 'ies are'} missing from the end of the log.`);
    }
    if (head && head.seq === lastSeq && typeof head.hash === 'string' && head.hash !== lastHash) {
      return broken(lastSeq, 'The final entry does not match its record.');
    }

    return { ok: true, ...tally };
  }
}

module.exports = { ActivityLog, describeIntegrity, KNOWN_ACTORS, normalizeActor };
