'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { TTT_LINES, tttWinner, tttBestMove, tttMove, DIFFICULTIES, RPS, rpsJudge, rpsThrow, detectGame } = require('../core/games');

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

test('rps judging table, complete, both directions', () => {
  const beats = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
  for (const a of RPS) for (const b of RPS) {
    const expected = a === b ? 'tie' : beats[a] === b ? 'kid' : 'jarvis';
    assert.equal(rpsJudge(a, b), expected, `${a} vs ${b}`);
  }
});

test('rpsThrow cannot see the current throw: the signature has no such parameter', () => {
  assert.equal(rpsThrow.length <= 3, true);
  // And behaviourally: same history + same rng seed => same throw, whatever the kid picks now.
  const rngA = seededRng(9); const rngB = seededRng(9);
  assert.equal(rpsThrow('hard', ['rock', 'rock'], rngA), rpsThrow('hard', ['rock', 'rock'], rngB));
});

test('hard reads the pattern: a kid who always throws rock gets papered', () => {
  const rng = seededRng(11);
  let paper = 0;
  for (let i = 0; i < 200; i++) if (rpsThrow('hard', ['rock','rock','rock','rock','rock'], rng) === 'paper') paper += 1;
  assert.ok(paper >= 190, `hard must counter the pattern (paper ${paper}/200)`);
});

test('easy leans the kid\'s way against their pattern', () => {
  const rng = seededRng(13);
  let scissors = 0; // scissors LOSES to rock — the throw a rock-kid beats
  for (let i = 0; i < 600; i++) if (rpsThrow('easy', ['rock','rock','rock'], rng) === 'scissors') scissors += 1;
  assert.ok(scissors >= 240, `easy must lean losing (scissors ${scissors}/600, uniform would be ~200)`);
});

test('normal with no history is roughly uniform', () => {
  const rng = seededRng(17);
  const counts = { rock: 0, paper: 0, scissors: 0 };
  for (let i = 0; i < 900; i++) counts[rpsThrow('normal', [], rng)] += 1;
  for (const shape of RPS) assert.ok(counts[shape] > 200, `${shape}: ${counts[shape]}/900`);
});

// ---- triggers (2026-07-30). The old patterns were so strict that "play
// rock paper scissors with me" silently opened nothing — the router lets an
// unmatched phrase fall through to small talk by design, so the game just
// never started and JARVIS chatted back instead. That was Adam's "I could
// never get rock paper scissors to work". Every phrasing here is one a kid
// actually said or plausibly says. ----

test('the phrasings kids actually use open rock paper scissors', () => {
  for (const phrase of [
    'play rock paper scissors',
    'play rock paper scissors with me',
    'play rock, paper, scissors!',
    'can we play rock paper scissors',
    'can you play rock paper scissors with me?',
    'wanna play rock paper scissors',
    'do you want to play rock paper scissors',
    "let's play rock paper scissors!",
    'jarvis, play rock paper scissors',
    'hey jarvis play rock paper scissors please',
    'play a round of rock paper scissors',
    'play rock paper scissors again',
    'rock paper scissors',
    'rock paper scissors!',
    'Rock, paper, scissors.'
  ]) {
    assert.deepEqual(detectGame(phrase), { game: 'rps' }, phrase);
  }
});

test('the phrasings kids actually use open tic tac toe', () => {
  for (const phrase of [
    'play tic tac toe',
    'play tic-tac-toe with me',
    'can we play tic tac toe?',
    "let's play a game of tic tac toe",
    'wanna play tic tac toe',
    'tic tac toe'
  ]) {
    assert.deepEqual(detectGame(phrase), { game: 'ttt' }, phrase);
  }
});

test('ordinary sentences that merely mention a game still fall through to the model', () => {
  for (const phrase of [
    'i hate rock paper scissors',
    'we played rock paper scissors at school today',
    'what is rock paper scissors',
    'rock paper scissors is a game people play',
    'who invented rock paper scissors?',
    "my brother won't play tic tac toe with me",
    'tell me about tic tac toe strategy',
    'i want to play outside',
    ''
  ]) {
    assert.equal(detectGame(phrase), null, phrase || '(empty)');
  }
});
