'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { GameScores } = require('../core/game-scores');

function fresh() { return new GameScores(fs.mkdtempSync(path.join(os.tmpdir(), 'jr-scores-'))); }

test('tallies and the kid streak', () => {
  const scores = fresh();
  scores.record('ttt', 'kid');
  scores.record('ttt', 'kid');
  scores.record('ttt', 'jarvis');
  scores.record('ttt', 'kid');
  const t = scores.get().ttt;
  assert.deepEqual([t.wins, t.losses, t.draws, t.streak, t.bestStreak], [3, 1, 0, 1, 2]);
});

test('draw breaks the streak but is not a loss', () => {
  const scores = fresh();
  scores.record('rps', 'kid');
  scores.record('rps', 'draw');
  const r = scores.get().rps;
  assert.deepEqual([r.wins, r.draws, r.streak, r.bestStreak], [1, 1, 0, 1]);
});

test('scores survive a reload from disk; corrupt file resets to zeros', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jr-scores-'));
  new GameScores(dir).record('ttt', 'kid');
  assert.equal(new GameScores(dir).get().ttt.wins, 1);
  fs.writeFileSync(path.join(dir, 'games.json'), '{nope');
  assert.equal(new GameScores(dir).get().ttt.wins, 0);
});

test('unknown game or outcome throws', () => {
  const scores = fresh();
  assert.throws(() => scores.record('chess', 'kid'));
  assert.throws(() => scores.record('ttt', 'meteor'));
});
