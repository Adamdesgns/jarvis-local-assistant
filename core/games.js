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

const RPS = Object.freeze(['rock', 'paper', 'scissors']);
const BEATS = Object.freeze({ rock: 'scissors', paper: 'rock', scissors: 'paper' });   // key beats value
const LOSES_TO = Object.freeze({ rock: 'paper', paper: 'scissors', scissors: 'rock' }); // key loses to value

function rpsJudge(kid, jarvis) {
  if (kid === jarvis) return 'tie';
  return BEATS[kid] === jarvis ? 'kid' : 'jarvis';
}

function mostFrequent(history, rng) {
  const recent = history.slice(-5);
  if (!recent.length) return null;
  const counts = {};
  for (const item of recent) counts[item] = (counts[item] || 0) + 1;
  const top = Math.max(...Object.values(counts));
  const leaders = RPS.filter((shape) => counts[shape] === top);
  return leaders[Math.floor(rng() * leaders.length)];
}

// JARVIS's throw. `history` is the kid's PREVIOUS throws only — the current
// throw is not a parameter, so this function CANNOT cheat against the kid,
// and a test pins that. Kids repeat themselves constantly, which is why
// "hard" wins more than a third against real children. "easy" cheats the
// other way, deliberately and in writing: half the time it throws the hand
// the kid's favourite move beats.
function rpsThrow(difficulty, history = [], rng = Math.random) {
  const uniform = () => RPS[Math.floor(rng() * 3)];
  const favourite = mostFrequent(history, rng);
  if (!favourite) return uniform();
  if (difficulty === 'hard') return LOSES_TO[favourite];
  if (difficulty === 'easy') return rng() < 0.5 ? BEATS[favourite] : uniform();
  return uniform();
}

// Anchored on both ends, deliberately — an ordinary sentence that merely
// mentions the game ("we played rock paper scissors at school") must keep
// falling through to the model as small talk (see the router's games
// branch). The original patterns were SO strict they were the bug Adam
// reported as "I could never get rock paper scissors to work": "play rock
// paper scissors with me", "can we play rock paper scissors", and even a
// trailing "!" all failed to match, and the miss is silent by design. The
// fix widens the lead-in and tail to the phrasings kids actually say while
// keeping both anchors, so mid-sentence mentions still never open a board.
// Built from real transcripts, not imagination: the first live night missed
// "Let's play rock-paper-scissors" (Whisper hyphenates compound names — the
// TTT name allowed hyphens, the RPS name did not) and "We'll play
// Tic-Tac-Toe" ("we'll" was not a lead-in). Both are in the tests now,
// verbatim from that activity log.
const GAME_LEAD = "(?:(?:hey )?jarvis[,\\s]+)?(?:please[,\\s]+)?(?:(?:can|could|will|would|shall) (?:we|i|you)[,\\s]+)?(?:(?:i|we|you|do you)[,\\s]+)?(?:(?:want|wanna|would like)(?:[,\\s]+to)?[,\\s]+)?(?:let'?s[,\\s]+|we'?ll[,\\s]+)?";
const GAME_TAIL = "(?:[,\\s]+(?:with me|with you|together|again|now|please))*[\\s.!?]*";
function gameTriggers(name) {
  return Object.freeze([
    new RegExp(`^${GAME_LEAD}play (?:a (?:game|round) of )?${name}${GAME_TAIL}$`, 'i'),
    new RegExp(`^(?:how about|what about) (?:a (?:game|round) of )?${name}${GAME_TAIL}$`, 'i'),
    new RegExp(`^${name}${GAME_TAIL}$`, 'i')
  ]);
}
const RPS_NAME = 'rock[-,\\s]*paper[-,\\s]*scissors?';
const TTT_PATTERNS = gameTriggers('tic[- ]?tac[- ]?toe');
const RPS_PATTERNS = gameTriggers(RPS_NAME);

// ---- the voice round (2026-07-30 redesign: the orb plays, no overlay) ----
// These are only ever consulted while a live RPS session exists in the
// router, so a bare "shoot" or "rock" in ordinary conversation never reaches
// them. All tolerate a leading wake word (transcripts keep it — see
// GAME_LEAD's note) and Whisper's hyphens/commas/punctuation.

// "Jarvis rock, paper, scissors, shoot" — the kid runs the countdown, the
// word "shoot" is the moment. The chant part is optional: a kid who just
// says "shoot" (or whose transcript only caught the tail) still throws.
const SHOOT_PATTERN = new RegExp(
  `^(?:(?:hey )?jarvis[,\\s]+)?(?:${RPS_NAME}[-,\\s]+)?shoot[\\s.!?]*$`, 'i'
);

// Honor mode (no camera): "what did you throw?" → "rock" / "I threw paper".
const THROW_ANSWER_PATTERN = /^(?:(?:hey )?jarvis[,\s]+)?(?:i\s+(?:threw|did|picked|chose|got|had)\s+)?(?:a\s+)?(rock|paper|scissors?)[\s.!?]*$/i;

// Ending the game, in the ways kids actually end things.
const STOP_PATTERN = /^(?:(?:hey )?jarvis[,\s]+)?(?:stop(?:\s+(?:playing|the game))?|we(?:'|’)?re done|i(?:'|’)?m done|that(?:'|’)?s enough|end (?:the )?game|quit(?:\s+the game)?|no more|game over)[\s.!?]*$/i;

// Difficulty without tabs: "easy mode" / "make it hard" — in-session only.
const DIFFICULTY_PATTERN = /^(?:(?:hey )?jarvis[,\s]+)?(?:(?:set|make) (?:it|the game) )?(easy|normal|hard)(?:\s+mode)?(?:\s+please)?[\s.!?]*$/i;

function detectShoot(text) {
  return SHOOT_PATTERN.test(String(text || '').trim());
}

function detectThrowAnswer(text) {
  const match = String(text || '').trim().match(THROW_ANSWER_PATTERN);
  if (!match) return null;
  const shape = match[1].toLowerCase();
  return shape === 'scissor' ? 'scissors' : shape;
}

function detectStop(text) {
  return STOP_PATTERN.test(String(text || '').trim());
}

function detectDifficulty(text) {
  const match = String(text || '').trim().match(DIFFICULTY_PATTERN);
  return match ? match[1].toLowerCase() : null;
}

// The spoken outcome opens by naming the shapes — showmanship AND clarity,
// since the kid can't see a chip UI any more: "Paper beats rock." then the
// table's trash talk takes over.
function rpsRevealPrefix(kidShape, jarvisShape) {
  if (kidShape === jarvisShape) return `Both ${kidShape}.`;
  const kidWins = BEATS[kidShape] === jarvisShape;
  const winner = kidWins ? kidShape : jarvisShape;
  const loser = kidWins ? jarvisShape : kidShape;
  return `${winner.charAt(0).toUpperCase()}${winner.slice(1)} beats ${loser}.`;
}

function detectGame(text) {
  const trimmed = String(text || '').trim();
  if (TTT_PATTERNS.some((pattern) => pattern.test(trimmed))) return { game: 'ttt' };
  if (RPS_PATTERNS.some((pattern) => pattern.test(trimmed))) return { game: 'rps' };
  return null;
}

module.exports = {
  DIFFICULTIES, TTT_LINES, tttWinner, tttBestMove, tttMove, RPS, rpsJudge, rpsThrow, detectGame,
  detectShoot, detectThrowAnswer, detectStop, detectDifficulty, rpsRevealPrefix
};
