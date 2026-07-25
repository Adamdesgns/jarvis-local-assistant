'use strict';

// The star chart: jobs a parent sets, stars a child earns.
//
// Its own JSON file next to tasks.json, because a child's chore list and an
// adult's work queue are not the same thing and should never share a store.
// The date maths is pure and exported, so the streak rules are testable
// without touching disk or waiting for midnight.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MAX_STARS = 5;

// Words that appear in half the job names on any chart and so prove nothing
// about which job a child means.
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'out', 'all', 'have', 'has', 'did', 'done', 'doing',
  'was', 'been', 'get', 'got', 'put', 'today', 'just', 'been', 'off', 'from',
  'with', 'that', 'this', 'them', 'you', 'your', 'i\'ve', 'ive'
]);

// Local calendar day, not UTC: a job done at 9pm belongs to that evening.
function dayKey(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date, delta) {
  const next = new Date(date instanceof Date ? date.getTime() : new Date(date).getTime());
  next.setDate(next.getDate() + delta);
  return next;
}

function normalizeDays(days) {
  if (!Array.isArray(days)) return [];
  const clean = days
    .map((day) => String(day || '').slice(0, 3).toLowerCase())
    .filter((day) => DAY_NAMES.includes(day));
  // Every day and "all seven days named" are the same thing; store the
  // simpler one so isDueOn has a single fast path.
  return clean.length === 7 ? [] : [...new Set(clean)];
}

// An empty days list means every day.
function isDueOn(chore, date = new Date()) {
  const days = normalizeDays(chore && chore.days);
  if (!days.length) return true;
  return days.includes(DAY_NAMES[(date instanceof Date ? date : new Date(date)).getDay()]);
}

// A day counts when every job due that day was done. Today is allowed to be
// unfinished without breaking the run — the day is not over yet — so the walk
// starts at yesterday when today is still in progress.
function computeStreak(chores, log, today = new Date()) {
  const doneByDay = new Map();
  for (const entry of log || []) {
    if (!doneByDay.has(entry.day)) doneByDay.set(entry.day, new Set());
    doneByDay.get(entry.day).add(entry.choreId);
  }
  const dayComplete = (date) => {
    const due = (chores || []).filter((chore) => isDueOn(chore, date));
    if (!due.length) return null; // A day with no jobs neither builds nor breaks a run.
    const done = doneByDay.get(dayKey(date)) || new Set();
    return due.every((chore) => done.has(chore.id));
  };

  let streak = 0;
  let cursor = today instanceof Date ? today : new Date(today);
  if (dayComplete(cursor) !== true) cursor = addDays(cursor, -1);
  // A year is plenty; it also stops a corrupt log from spinning forever.
  for (let guard = 0; guard < 366; guard += 1) {
    const state = dayComplete(cursor);
    if (state === false) break;
    if (state === true) streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

// What a new chart starts with, so a child's first look is not an empty box.
// A parent edits or deletes every one of these.
const STARTER_CHORES = [
  { title: 'Brush my teeth', days: [], stars: 1 },
  { title: 'Make my bed', days: [], stars: 1 },
  { title: 'Tidy my room', days: ['sat'], stars: 3 },
  { title: 'Homework', days: ['mon', 'tue', 'wed', 'thu'], stars: 2 }
];

class StarChartStore {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, 'star-chart.json');
    this.data = this.#load();
  }

  #load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      return {
        chores: Array.isArray(parsed.chores) ? parsed.chores : [],
        log: Array.isArray(parsed.log) ? parsed.log : [],
        spent: Number(parsed.spent) || 0,
        rewards: Array.isArray(parsed.rewards) ? parsed.rewards : []
      };
    } catch {
      const fresh = { chores: [], log: [], spent: 0, rewards: [] };
      for (const chore of STARTER_CHORES) {
        fresh.chores.push({
          id: crypto.randomUUID(),
          title: chore.title,
          days: chore.days,
          stars: chore.stars,
          createdAt: new Date().toISOString()
        });
      }
      return fresh;
    }
  }

  #persist() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(temp, this.filePath);
  }

  // Every job, with today's state folded in — the shape both the junior UI
  // and the model's chore tool read.
  listChores(date = new Date()) {
    const key = dayKey(date);
    const doneToday = new Set(this.data.log.filter((entry) => entry.day === key).map((entry) => entry.choreId));
    return this.data.chores.map((chore) => ({
      ...chore,
      dueToday: isDueOn(chore, date),
      doneToday: doneToday.has(chore.id)
    }));
  }

  addChore(input = {}) {
    const title = String(input.title || '').trim().slice(0, 80);
    if (!title) throw new Error('A job needs a name.');
    const chore = {
      id: crypto.randomUUID(),
      title,
      days: normalizeDays(input.days),
      stars: Math.min(MAX_STARS, Math.max(1, Math.round(Number(input.stars)) || 1)),
      createdAt: new Date().toISOString()
    };
    this.data.chores.push(chore);
    this.#persist();
    return chore;
  }

  updateChore(id, patch = {}) {
    const chore = this.data.chores.find((item) => item.id === id);
    if (!chore) return null;
    if (Object.prototype.hasOwnProperty.call(patch, 'title')) {
      const title = String(patch.title || '').trim().slice(0, 80);
      if (title) chore.title = title;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'days')) chore.days = normalizeDays(patch.days);
    if (Object.prototype.hasOwnProperty.call(patch, 'stars')) {
      chore.stars = Math.min(MAX_STARS, Math.max(1, Math.round(Number(patch.stars)) || 1));
    }
    this.#persist();
    return chore;
  }

  removeChore(id) {
    const before = this.data.chores.length;
    this.data.chores = this.data.chores.filter((item) => item.id !== id);
    if (this.data.chores.length === before) return false;
    // The stars already earned stay earned; only the job goes away.
    this.#persist();
    return true;
  }

  // Match a spoken job by name — "I fed the cat" against "Feed the cat".
  findChore(query, date = new Date()) {
    // Filler words carry no evidence: without this, "washed the car" matches
    // "Feed the cat" on the word "the" and ticks off the wrong job.
    const terms = String(query || '').toLowerCase()
      .split(/[\s,]+/)
      .map((term) => term.replace(/[^a-z0-9']/g, ''))
      .filter((term) => term.length > 2 && !STOP_WORDS.has(term));
    if (!terms.length) return null;
    const scored = this.listChores(date)
      .map((chore) => {
        const title = chore.title.toLowerCase();
        const score = terms.reduce((total, term) => total + (title.includes(term) ? 1 : 0), 0);
        return { chore, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => (b.score - a.score) || (Number(a.chore.doneToday) - Number(b.chore.doneToday)));
    return scored[0] ? scored[0].chore : null;
  }

  // Idempotent per day: saying "I brushed my teeth" twice earns one star.
  markDone(choreId, date = new Date()) {
    const chore = this.data.chores.find((item) => item.id === choreId);
    if (!chore) return { ok: false, reason: 'not-found' };
    const key = dayKey(date);
    if (this.data.log.some((entry) => entry.day === key && entry.choreId === choreId)) {
      return { ok: true, already: true, chore, earned: 0, ...this.summary(date) };
    }
    this.data.log.push({ choreId, day: key, stars: chore.stars, at: new Date().toISOString() });
    this.#persist();
    return { ok: true, already: false, chore, earned: chore.stars, ...this.summary(date) };
  }

  undoDone(choreId, date = new Date()) {
    const key = dayKey(date);
    const before = this.data.log.length;
    this.data.log = this.data.log.filter((entry) => !(entry.day === key && entry.choreId === choreId));
    if (this.data.log.length === before) return { ok: false };
    this.#persist();
    return { ok: true, ...this.summary(date) };
  }

  // Stars a parent has traded in for a real-world reward.
  redeem({ stars, reward } = {}) {
    const amount = Math.max(1, Math.round(Number(stars)) || 1);
    const balance = this.summary().stars;
    if (amount > balance) return { ok: false, reason: 'not-enough', stars: balance };
    this.data.spent += amount;
    this.data.rewards.unshift({
      id: crypto.randomUUID(),
      stars: amount,
      reward: String(reward || 'A treat').trim().slice(0, 80),
      at: new Date().toISOString()
    });
    this.data.rewards = this.data.rewards.slice(0, 50);
    this.#persist();
    return { ok: true, ...this.summary() };
  }

  summary(date = new Date()) {
    const key = dayKey(date);
    const earned = this.data.log.reduce((total, entry) => total + (Number(entry.stars) || 0), 0);
    const weekStart = dayKey(addDays(date, -6));
    const today = this.listChores(date).filter((chore) => chore.dueToday);
    return {
      stars: Math.max(0, earned - (Number(this.data.spent) || 0)),
      earnedAllTime: earned,
      todayStars: this.data.log.filter((entry) => entry.day === key).reduce((total, entry) => total + (Number(entry.stars) || 0), 0),
      weekStars: this.data.log.filter((entry) => entry.day >= weekStart && entry.day <= key).reduce((total, entry) => total + (Number(entry.stars) || 0), 0),
      streak: computeStreak(this.data.chores, this.data.log, date),
      dueToday: today.length,
      doneToday: today.filter((chore) => chore.doneToday).length,
      allDone: today.length > 0 && today.every((chore) => chore.doneToday),
      rewards: this.data.rewards.slice(0, 10)
    };
  }
}

module.exports = {
  StarChartStore,
  STARTER_CHORES,
  DAY_NAMES,
  MAX_STARS,
  dayKey,
  addDays,
  normalizeDays,
  isDueOn,
  computeStreak
};
