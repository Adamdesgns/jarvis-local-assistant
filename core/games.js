'use strict';

// The games JARVIS plays. Pure — no disk, no network, no model, no Electron.
// Randomness is INJECTED (rng parameter) so every difficulty behaviour is
// deterministic under test. The renderer owns the board on screen; the
// router only parses "play tic tac toe"; these functions decide moves.

const DIFFICULTIES = Object.freeze(['easy', 'normal', 'hard']);

const TTT_LINES = Object.freeze([
  [0, 1, 2], [3, 4, 5], [6, 7, 8],   // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8],   // columns
  [0, 4, 8], [2, 4, 6]               // diagonals
]);

function tttWinner(board) {
  for (const [a, b, c] of TTT_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return board.every(Boolean) ? 'draw' : null;
}

function legalMoves(board) {
  const moves = [];
  for (let i = 0; i < 9; i++) if (!board[i]) moves.push(i);
  return moves;
}

// Plain minimax with depth preference: win as soon as possible, lose as
// late as possible. Nine squares — the whole tree is tiny; no pruning needed.
function score(board, mark, other, depth) {
  const winner = tttWinner(board);
  if (winner === mark) return 10 - depth;
  if (winner === other) return depth - 10;
  if (winner === 'draw') return 0;
  return null;
}

function minimax(board, turn, mark, other, depth) {
  const settled = score(board, mark, other, depth);
  if (settled !== null) return { value: settled };
  let best = null;
  for (const move of legalMoves(board)) {
    board[move] = turn;
    const { value } = minimax(board, turn === 'X' ? 'O' : 'X', mark, other, depth + 1);
    board[move] = null;
    const better = best === null
      || (turn === mark ? value > best.value : value < best.value);
    if (better) best = { value, move };
  }
  return best;
}

function tttBestMove(board, mark) {
  return minimax([...board], mark, mark, mark === 'X' ? 'O' : 'X', 0).move;
}

// The whole difficulty system is this one dial: how often JARVIS actually
// tries. One algorithm, three feels — and "easy" is honest about being a
// thrown game, which is the point: a kid who can never win quits.
const TRY_RATE = { easy: 0.25, normal: 0.7, hard: 1.0 };

function tttMove(board, mark, difficulty, rng = Math.random) {
  const rate = TRY_RATE[difficulty] ?? TRY_RATE.normal;
  if (rng() < rate) return tttBestMove(board, mark);
  const moves = legalMoves(board);
  return moves[Math.floor(rng() * moves.length)];
}

module.exports = { DIFFICULTIES, TTT_LINES, tttWinner, tttBestMove, tttMove };
