'use strict';
const fs = require('node:fs');
const path = require('node:path');

// The kid's own scoreboard for JARVIS JR's games — a small file next to
// settings.json, never inside it (settings.json is the JR-writable surface;
// this is JARVIS's own record-keeping, same spirit as MemoryStore/TaskStore).
// Same atomic-write pattern as ConfigStore's #persist: a .tmp file, then
// rename, so a crash mid-write never leaves games.json half-written.

const GAMES = Object.freeze(['ttt', 'rps']);
const OUTCOMES = Object.freeze(['kid', 'jarvis', 'draw']);

function zeroTally() {
  return { wins: 0, losses: 0, draws: 0, bestStreak: 0, streak: 0 };
}

function defaultData() {
  return { ttt: zeroTally(), rps: zeroTally() };
}

class GameScores {
  constructor(dir) {
    this.directory = dir;
    this.filePath = path.join(dir, 'games.json');
    this.data = this.#load();
  }

  #load() {
    try {
      const saved = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      const data = defaultData();
      for (const game of GAMES) {
        data[game] = { ...zeroTally(), ...(saved && saved[game]) };
      }
      return data;
    } catch {
      // Missing file (first run) or a corrupt one (crash mid-write, a hand
      // edit) both reset to honest zeros rather than throwing — a kid's
      // scoreboard should never crash the app.
      return defaultData();
    }
  }

  #persist() {
    fs.mkdirSync(this.directory, { recursive: true });
    const temp = `${this.filePath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(temp, this.filePath);
  }

  // outcome is always from the KID's side of the table: 'kid' won, 'jarvis'
  // won, or 'draw'. streak counts consecutive kid wins only — a draw breaks
  // it without counting as a loss; bestStreak only ever climbs.
  record(game, outcome) {
    if (!GAMES.includes(game)) throw new Error(`Unknown game: ${game}`);
    if (!OUTCOMES.includes(outcome)) throw new Error(`Unknown outcome: ${outcome}`);
    const tally = this.data[game];
    if (outcome === 'kid') {
      tally.wins += 1;
      tally.streak += 1;
      tally.bestStreak = Math.max(tally.bestStreak, tally.streak);
    } else if (outcome === 'jarvis') {
      tally.losses += 1;
      tally.streak = 0;
    } else {
      tally.draws += 1;
      tally.streak = 0;
    }
    this.#persist();
    return this.get();
  }

  get() {
    return JSON.parse(JSON.stringify(this.data));
  }
}

module.exports = { GameScores };
