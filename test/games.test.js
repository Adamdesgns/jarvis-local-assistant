'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { TTT_LINES, tttWinner, tttBestMove, tttMove, DIFFICULTIES } = require('../core/games');

const E = null;

test('all eight win lines detected for both marks', () => {
  assert.equal(TTT_LINES.length, 8);
  for (const line of TTT_LINES) {
    for (const mark of ['X', 'O']) {
      const board = Array(9).fill(E);
      for (const i of line) board[i] = mark;
      assert.equal(tttWinner(board), mark, `${mark} wins on ${line}`);
    }
  }
});

test('full board with no line is a draw; open board is null', () => {
  assert.equal(tttWinner(['X','O','X','X','O','O','O','X','X']), 'draw');
  assert.equal(tttWinner(Array(9).fill(E)), null);
});

test('minimax blocks an immediate loss and takes an immediate win', () => {
  // O to move; X threatens 0-1-2 at index 2 -> O must block index 2.
  assert.equal(tttBestMove(['X','X',E, 'O',E,E, E,E,E], 'O'), 2);
  // O to move; O wins at index 5 (3-4-5) even though X also threatens.
  assert.equal(tttBestMove(['X','X',E, 'O','O',E, E,E,E], 'O'), 5);
});

// The headline claim from the spec, as a test: HARD NEVER LOSES.
// 500 games vs a seeded random opponent, JARVIS as O (second player).
function seededRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
function playGame(difficulty, rng) {
  const board = Array(9).fill(E);
  let turn = 'X'; // the "kid" is X and random
  while (!tttWinner(board)) {
    const legal = board.map((v, i) => (v === E ? i : -1)).filter((i) => i >= 0);
    const move = turn === 'X'
      ? legal[Math.floor(rng() * legal.length)]
      : tttMove(board, 'O', difficulty, rng);
    board[move] = turn;
    turn = turn === 'X' ? 'O' : 'X';
  }
  return tttWinner(board);
}

test('hard never loses across 500 randomized games', () => {
  const rng = seededRng(20260728);
  for (let i = 0; i < 500; i++) {
    assert.notEqual(playGame('hard', rng), 'X', `hard lost game ${i}`);
  }
});

test('easy is genuinely beatable: the random kid wins sometimes', () => {
  const rng = seededRng(42);
  let kidWins = 0;
  for (let i = 0; i < 300; i++) if (playGame('easy', rng) === 'X') kidWins += 1;
  assert.ok(kidWins >= 30, `easy must be losable (kid won ${kidWins}/300)`);
});

test('tttMove only ever returns a legal move, at every difficulty', () => {
  const rng = seededRng(7);
  for (const difficulty of DIFFICULTIES) {
    const board = ['X',E,'O', E,'X',E, 'O',E,E];
    for (let i = 0; i < 50; i++) {
      const move = tttMove(board, 'O', difficulty, rng);
      assert.equal(board[move], E, `${difficulty} played an occupied square`);
    }
  }
});
