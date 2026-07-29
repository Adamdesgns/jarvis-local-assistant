# JARVIS JR Games Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tic tac toe and rock-paper-scissors against JARVIS — real board, Easy/Normal/Hard picked by the kid, written trash talk, the orb morphing into rock/paper/scissors on the reveal — per the Games section of `docs/superpowers/specs/2026-07-28-jarvis-jr-design.md`.

**Architecture:** Three pure core modules (engines / lines / scores) + one renderer UI module + pure orb-shape math with a dual export so it tests in Node and draws in the browser. The router only *parses* ("play tic tac toe" → open the board — the precedent timers set); the renderer plays; moves go over two JR-allowlisted IPC channels. Games never reach the model — they work with no brain installed.

**Tech Stack:** Plain Node + `node --test`; canvas 2D in the renderer. No new dependencies.

**Prerequisite:** The foundation plan (`2026-07-28-jarvis-jr-foundation.md`) is complete on `jarvis-jr` — `profileFor`, the router `profile` gate style, `jrIpcAllowlist`, and the JR boot all exist.

## Global Constraints

- Same repo rules as the foundation plan: branch `jarvis-jr`, stage only your own files by exact path, full suite green after every task, Edit tool only (no PowerShell round-trips), grown-up build unchanged.
- Games never touch stars, never touch the model, never require a network or a brain.
- Difficulty is the kid's pick per game: Easy / Normal / Hard.
- All trash talk is written text in the source — age-banded (`middle`/`big`/`teen` from `core/kid-mode.js`), never unkind, never about the kid — only about JARVIS's own wins/losses and the game.

---

### Task 1: `core/games.js` — the tic tac toe engine

**Files:**
- Create: `core/games.js`
- Test: `test/games.test.js`

**Interfaces:**
- Consumes: nothing (pure; randomness injected).
- Produces:
  - `TTT_LINES` — the 8 win lines
  - `tttWinner(board) -> 'X'|'O'|'draw'|null` — board is an array of 9 (`'X'|'O'|null`)
  - `tttBestMove(board, mark) -> index` — minimax, perfect
  - `tttMove(board, mark, difficulty, rng = Math.random) -> index` — the dial: probability of playing `tttBestMove` instead of a random legal move: easy 0.25, normal 0.7, hard 1.0
  - `DIFFICULTIES = ['easy', 'normal', 'hard']`

- [ ] **Step 1: Write the failing test**

```js
// test/games.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/games.test.js`
Expected: FAIL — `Cannot find module '../core/games'`

- [ ] **Step 3: Write the implementation**

```js
// core/games.js
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
```

- [ ] **Step 4: Run tests to verify green, then the full suite**

Run: `node --test test/games.test.js` — Expected: PASS (6 tests; the 500-game test runs in well under a second)
Run: `node --test 2>&1 | tail -3` — Expected: 0 fail

- [ ] **Step 5: Commit**

```bash
git add core/games.js test/games.test.js
git commit -m "jr games: tic tac toe — minimax with one honest difficulty dial"
```

---

### Task 2: Rock paper scissors in `core/games.js`

**Files:**
- Modify: `core/games.js`
- Test: `test/games.test.js` (append)

**Interfaces:**
- Produces (appended to the module's exports):
  - `RPS = ['rock', 'paper', 'scissors']`
  - `rpsJudge(kid, jarvis) -> 'kid'|'jarvis'|'tie'`
  - `rpsThrow(difficulty, history, rng = Math.random) -> 'rock'|'paper'|'scissors'` — `history` is the kid's PREVIOUS throws, oldest first. The current throw is structurally absent from the signature — that is the no-cheating guarantee, enforced by a test.
    - normal: uniform random
    - hard: counters the kid's most frequent recent throw (last 5; ties broken uniformly at random)
    - easy: cheats in the KID'S favour — with probability 0.5 throws the losing answer to the kid's most frequent recent throw; otherwise uniform

- [ ] **Step 1: Write the failing tests** — append to `test/games.test.js`:

```js
const { RPS, rpsJudge, rpsThrow } = require('../core/games');

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
```

- [ ] **Step 2: Run red** — `node --test test/games.test.js` → the five new tests FAIL.

- [ ] **Step 3: Implement** — append to `core/games.js` (before `module.exports`, then extend the exports):

```js
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
```

Extend exports: `module.exports = { DIFFICULTIES, TTT_LINES, tttWinner, tttBestMove, tttMove, RPS, rpsJudge, rpsThrow };`

- [ ] **Step 4: Run green, full suite green** — `node --test test/games.test.js`, then `node --test 2>&1 | tail -3`.

- [ ] **Step 5: Commit**

```bash
git add core/games.js test/games.test.js
git commit -m "jr games: rock paper scissors — pattern-reading hard, kid-favouring easy, cheat-proof by signature"
```

---

### Task 3: `core/game-lines.js` — the written trash talk

**Files:**
- Create: `core/game-lines.js`
- Test: `test/game-lines.test.js`

**Interfaces:**
- Consumes: `ageBand` from `core/kid-mode.js`.
- Produces: `OCCASIONS = ['gameStart','jarvisWins','kidWins','draw','jarvisThinking','rpsCountdown','streak3']`, `gameLine(occasion, { age, rng = Math.random }) -> string` — picks from the band's list for that occasion; every occasion has ≥3 lines per band; falls back to the `middle` band if a band list is ever missing.

- [ ] **Step 1: Write the failing test**

```js
// test/game-lines.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { OCCASIONS, gameLine, LINES } = require('../core/game-lines');

test('every occasion has at least 3 lines in every band', () => {
  for (const occasion of OCCASIONS) {
    for (const band of ['middle', 'big', 'teen']) {
      assert.ok((LINES[occasion]?.[band] || []).length >= 3, `${occasion}/${band}`);
    }
  }
});

test('gameLine returns a string from the right band', () => {
  const line = gameLine('kidWins', { age: 11, rng: () => 0 });
  assert.equal(line, LINES.kidWins.big[0]);
  assert.equal(typeof gameLine('jarvisWins', { age: 15 }), 'string');
});

test('no line is unkind: never about the kid losing being the kid\'s fault', () => {
  // The cheap enforceable slice of "never unkind": banned words anywhere.
  const banned = /\b(stupid|dumb|idiot|loser|pathetic|baby|cry)\b/i;
  for (const occasion of OCCASIONS) {
    for (const band of Object.keys(LINES[occasion])) {
      for (const line of LINES[occasion][band]) {
        assert.doesNotMatch(line, banned, `${occasion}/${band}: "${line}"`);
      }
    }
  }
});

test('unknown occasion throws — a typo is a bug, not a silent blank', () => {
  assert.throws(() => gameLine('victoryLap', { age: 11 }));
});
```

- [ ] **Step 2: Run red**, then **Step 3: implement**. The module is a `LINES` table + a picker. Write ALL the lines now (21 occasions×bands minimum 3 each = 63+ lines) — in JARVIS's actual voice: dry, composed, lightly menacing about his own performance, never at the kid. Seed set to write from (expand each band to ≥3 per occasion; `middle` slightly simpler words, `teen` drier):

```js
// Voice: JARVIS the composed British AI. He may mock HIMSELF, the situation,
// and the game. He NEVER mocks the kid. Losing is his data problem;
// winning is handled with immaculate false modesty.
const LINES = {
  gameStart: {
    middle: [
      'Very well. I should warn you: I have read every book about this game. Both of them.',
      'Board ready. I have allocated three percent of my processing power. Try to make it interesting.',
      'Ah, a challenger. I admire the confidence.'
    ],
    big: [
      'Board ready. I run this game in the time it takes your monitor to blink. No pressure.',
      'I should mention I never tire, never blink, and never need snacks. Your move.',
      'Excellent. I was getting bored of being merely helpful.'
    ],
    teen: [
      'Board ready. Statistically speaking, one of us should be worried. I have not calculated which.',
      'I have seen every possible game. It went badly for most of them.',
      'Proceed. I promise to look surprised at least once.'
    ]
  },
  jarvisWins: {
    middle: [
      'I win this one. I did have a head start of several million calculations.',
      'Victory. I shall be gracious about it for at least ten seconds.',
      'That one goes to me. Rematch? I would genuinely enjoy it.'
    ],
    big: [
      'I win — though in fairness, I cheated by paying attention.',
      'Another for the machine. Somewhere, a toaster is proud of me.',
      'Victory. I would gloat, but my programming insists on dignity.'
    ],
    teen: [
      'I win. Do not take it personally — I take nothing personally, which is my entire advantage.',
      'That is a win for me. The scoreboard will remember, even if we agree not to.',
      'Won it. I will act like it was close.'
    ]
  },
  kidWins: {
    middle: [
      'You got me. Fair and square. I am rerunning the numbers and they still say you won.',
      'A win for you! I demand a rematch, respectfully.',
      'Well played. I did not see that coming, which is embarrassing for a computer.'
    ],
    big: [
      'You got me. I am choosing to call it a calibration error. It was not.',
      'A clean win for you. I have filed a complaint with myself.',
      'Beaten. By a human. I shall never live this down, and you should never let me.'
    ],
    teen: [
      'You won. I have run the post-mortem and the conclusion is: you were better. Distressing.',
      'A win for you, fully earned. I am updating my threat assessment.',
      'Beaten. Somewhere in my code, a subroutine is sulking.'
    ]
  },
  draw: {
    middle: [
      'A draw. We are evenly matched, which frankly is a compliment to one of us each.',
      'Nobody wins. The board, however, had a lovely time.',
      'A tie. Honour intact on both sides.'
    ],
    big: [
      'A draw — the chess handshake of tic tac toe.',
      'Stalemate. We are both too clever for this board.',
      'A tie. I blame the board for being too small for our talents.'
    ],
    teen: [
      'A draw. Against a perfect opponent, that is the best available outcome. Make of that what you will.',
      'Tie game. Mathematically inevitable; emotionally unsatisfying.',
      'Even. The board has declared neutrality.'
    ]
  },
  jarvisThinking: {
    middle: ['Thinking…', 'Calculating my brilliant move…', 'One moment. Genius takes a second.'],
    big: ['Considering my options. All of them.', 'Running the numbers…', 'Plotting, briefly.'],
    teen: ['Deliberating with unnecessary intensity.', 'Consulting the entire game tree. Again.', 'Thinking. Dramatically.']
  },
  rpsCountdown: {
    middle: ['Rock… paper… scissors…', 'Here we go. Rock… paper… scissors…', 'Best of luck. Rock… paper… scissors…'],
    big: ['Rock… paper… scissors…', 'No mind games. Well, few. Rock… paper… scissors…', 'Steady hands. Rock… paper… scissors…'],
    teen: ['Rock… paper… scissors…', 'I have already chosen. Rock… paper… scissors…', 'Fate awaits. Rock… paper… scissors…']
  },
  streak3: {
    middle: [
      'Three in a row for you. I am beginning to suspect skill.',
      'A three-game streak! I shall try harder, with my whole circuit board.',
      'Three straight. Respect is now officially logged.'
    ],
    big: [
      'Three in a row. I have upgraded you from "opponent" to "problem".',
      'A streak of three. My diagnostics insist I am fine. My diagnostics are lying.',
      'Three consecutive wins. Noted, remembered, and mildly resented.'
    ],
    teen: [
      'Three in a row. I am contractually obliged to call that dominance.',
      'A three-win streak. I have started a file on you.',
      'Three straight. The machines will hear about this.'
    ]
  }
};
```

Picker + guard:

```js
'use strict';
const { ageBand } = require('./kid-mode');

const OCCASIONS = Object.freeze(Object.keys(LINES));

function gameLine(occasion, { age, rng = Math.random } = {}) {
  const table = LINES[occasion];
  if (!table) throw new Error(`Unknown game occasion: ${occasion}`);
  const list = table[ageBand(age)] || table.middle;
  return list[Math.floor(rng() * list.length)];
}

module.exports = { LINES, OCCASIONS, gameLine };
```

(Order the file: `'use strict'`, require, `const LINES = {...}`, then `OCCASIONS`/`gameLine`/exports.)

- [ ] **Step 4: Run green, full suite green.**

- [ ] **Step 5: Commit**

```bash
git add core/game-lines.js test/game-lines.test.js
git commit -m "jr games: the trash talk — written, age-banded, never at the kid"
```

---

### Task 4: `core/game-scores.js` + router parse + IPC

**Files:**
- Create: `core/game-scores.js`
- Modify: `core/router.js` (the parse branch), `core/variant.js` (allowlist: add the game channels), `main.js` (construct GameScores in jr when `PROFILE.games`; register handlers), `preload.js`
- Test: `test/game-scores.test.js`, extend `test/router-jr.test.js`, extend `test/jr-boot.test.js`

**Interfaces:**
- Produces:
  - `class GameScores` — `new GameScores(dir)`, own file `games.json` in userData (`{ttt: {wins,losses,draws,bestStreak,streak}, rps: {...}}`), methods `record(game, outcome) -> updated tallies` where outcome ∈ `'kid'|'jarvis'|'draw'` (streak = consecutive kid wins; `bestStreak` monotonic), `get() -> tallies`. Same atomic-write pattern as ConfigStore (`.tmp` + rename).
  - `detectGame(text) -> {game:'ttt'|'rps'} | null` exported from `core/games.js` — narrow patterns: `/^(?:let'?s )?play (?:a game of )?tic[- ]?tac[- ]?toe$/i`, `/^tic[- ]?tac[- ]?toe$/i`, `/^(?:let'?s )?play rock[,\s]*paper[,\s]*scissors$/i`, `/^rock paper scissors$/i` — and a test that `'my brother won't play tic tac toe with me'` does NOT match.
  - Router: in the JR path, after quips and before battle: `if (this.profile.games) { const g = detectGame(text); if (g) return this.#result(gameLine('gameStart', {age: this.jrAge()}), 'jr-game', { game: g.game, success: true }); }` — the renderer sees `meta.game` and opens the board. When `!this.profile.games`, `detectGame` is never called (gate style from foundation Task 5).
  - IPC: `game:move` (`{game:'ttt', board, difficulty} -> {move}` via `tttMove`; `{game:'rps', history, difficulty} -> {shape}` via `rpsThrow`), `game:score` (`{game, outcome} -> tallies`, plus `{}` -> `get()`). Both in `jrIpcAllowlist` under the `games` flag. Randomness: real `Math.random` here — injection was for tests.
  - preload: `gameMove: (payload) => ipcRenderer.invoke('game:move', payload)`, `gameScore: (payload) => ipcRenderer.invoke('game:score', payload)`.

- [ ] **Step 1: Failing tests.** `test/game-scores.test.js` (tallies, streaks, atomic file, corrupt-file recovery to zeros — use `fs.mkdtempSync(path.join(os.tmpdir(), 'jr-scores-'))`); router test additions (detectGame narrow-pattern table incl. the negative; games-off never calls detectGame — booby-trap a `detectGame` spy via the profile-off router asserting `result.source !== 'jr-game'`); allowlist additions (`game:move` present only when `games` on).

```js
// test/game-scores.test.js
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
```

- [ ] **Step 2: Run red.** — all three test files.

- [ ] **Step 3: Implement all four pieces** (GameScores ~60 lines mirroring ConfigStore's `#persist`; `detectGame` + patterns in games.js; the router branch; the IPC + allowlist + preload lines).

- [ ] **Step 4: Run green, full suite green.**

- [ ] **Step 5: Commit**

```bash
git add core/game-scores.js core/games.js core/router.js core/variant.js main.js preload.js test/game-scores.test.js test/router-jr.test.js test/jr-boot.test.js
git commit -m "jr games: scores in their own file, 'play tic tac toe' parsed, moves over gated IPC"
```

---

### Task 5: `src/orbs/shapes.js` — the morph math (pure, dual-export)

**Files:**
- Create: `src/orbs/shapes.js`
- Test: `test/orb-shapes.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces (dual export exactly like `src/orbs/orb-engine.js:52-53` — `module.exports` AND `window.OrbShapes`):
  - `SHAPES.orb(theta, t) -> r` — the resting shape: `1 + sin(3θ + t·0.035)·0.035 + sin(5θ − t·0.022)·0.022` (the classic wobble)
  - `SHAPES.rock(theta, t) -> r` — low-frequency lumps: `0.9 + sin(2θ + 0.7)·0.08 + sin(5θ + 2.1)·0.05 + sin(9θ)·0.02` (t ignored: rocks hold still)
  - `SHAPES.paper(theta, t) -> r` — superellipse (squareness n=4): `(|cosθ|⁴ + |sinθ|⁴)^(−1/4) · 0.82` (t ignored)
  - `SHAPES.scissors(theta, t) -> r` — two blade spikes at 10 and 2 o'clock over a small core: `0.45 + spike(θ, 2.62, 0.30)·0.65 + spike(θ, 0.52, 0.30)·0.65` where `spike(θ, at, width) = max(0, cos((angleDiff(θ, at))·(π/2)/width))²` and `angleDiff` wraps to [−π, π]
  - `morphRadius(from, to, progress, theta, t) -> r` — eased blend: `f = ease(progress)`, `r = SHAPES[from](θ,t)·(1−f) + SHAPES[to](θ,t)·f`, `ease(p) = p<.5 ? 2p² : 1−(−2p+2)²/2`
  - `SHAPE_TINTS = { rock: '#8a8f98', paper: '#e8e6df', scissors: '#c0c8d8', orb: null }` — null means "keep the soul's own palette"

- [ ] **Step 1: Write the failing test**

```js
// test/orb-shapes.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { SHAPES, morphRadius, SHAPE_TINTS } = require('../src/orbs/shapes');

const TAU = Math.PI * 2;

test('every shape is finite, positive, and bounded over the whole circle', () => {
  for (const name of Object.keys(SHAPES)) {
    for (let i = 0; i < 720; i++) {
      const r = SHAPES[name]((i / 720) * TAU, 123);
      assert.ok(Number.isFinite(r) && r > 0.05 && r < 1.6, `${name} at step ${i}: ${r}`);
    }
  }
});

test('shapes are periodic: θ and θ+2π agree', () => {
  for (const name of Object.keys(SHAPES)) {
    for (const theta of [0.3, 1.7, 4.4]) {
      assert.ok(Math.abs(SHAPES[name](theta, 5) - SHAPES[name](theta + TAU, 5)) < 1e-9, name);
    }
  }
});

test('rock, paper, scissors hold still; the orb breathes', () => {
  for (const name of ['rock', 'paper', 'scissors']) {
    assert.equal(SHAPES[name](1.1, 0), SHAPES[name](1.1, 999), `${name} must ignore time`);
  }
  assert.notEqual(SHAPES.orb(1.1, 0), SHAPES.orb(1.1, 999));
});

test('scissors reads as two blades: two clear maxima near 10 and 2 o\'clock', () => {
  let peaks = 0;
  const samples = 720;
  const r = (i) => SHAPES.scissors((i / samples) * TAU, 0);
  for (let i = 0; i < samples; i++) {
    const prev = r((i + samples - 1) % samples), here = r(i), next = r((i + 1) % samples);
    if (here > prev && here > next && here > 0.9) peaks += 1;
  }
  assert.equal(peaks, 2, `expected exactly 2 blade peaks, found ${peaks}`);
});

test('morph endpoints are exact and the middle is between', () => {
  const theta = 0.8, t = 42;
  assert.equal(morphRadius('orb', 'rock', 0, theta, t), SHAPES.orb(theta, t));
  assert.equal(morphRadius('orb', 'rock', 1, theta, t), SHAPES.rock(theta, t));
  const mid = morphRadius('orb', 'rock', 0.5, theta, t);
  const [lo, hi] = [SHAPES.orb(theta, t), SHAPES.rock(theta, t)].sort((a, b) => a - b);
  assert.ok(mid >= lo - 1e-9 && mid <= hi + 1e-9);
});

test('tints: the three throws are tinted, the orb keeps its soul', () => {
  assert.match(SHAPE_TINTS.rock, /^#[0-9a-f]{6}$/i);
  assert.equal(SHAPE_TINTS.orb, null);
});
```

- [ ] **Step 2: Run red**, then **Step 3: implement** exactly the formulas in the Interfaces block, IIFE-wrapped with the dual export (copy the footer pattern from `orb-engine.js`). Keep every constant in the file commented with what it does visually (e.g. `0.45 // scissors core radius — small enough that the blades read`).

- [ ] **Step 4: Run green, full suite green.**

- [ ] **Step 5: Commit**

```bash
git add src/orbs/shapes.js test/orb-shapes.test.js
git commit -m "jr games: orb shape math — rock, paper, scissors, morph; pure and pinned by tests"
```

---

### Task 6: The games UI — board, buttons, countdown, morph, scoreboard

**Files:**
- Create: `src/jr-games-ui.js`, styles appended to the `/* ---- JARVIS JR ---- */` section of `src/styles.css`
- Modify: `src/index.html` (overlay markup + script tags for `orbs/shapes.js` and `jr-games-ui.js`), `src/renderer.js` (hook `jr-game` results; expose the orb canvas override seam)
- Test: manual protocol (renderer); all decisions beneath are unit-tested (Tasks 1–5)

**Interfaces:**
- Consumes: `window.OrbShapes` (Task 5), `window.jarvis.gameMove/gameScore` (Task 4), the `jr-game` result meta (Task 4), `gameLine` strings server-side? — no: lines are needed IN the renderer; add `game:line` to the Task 4 IPC (`{occasion, } -> {line}` using the kid's age main-side) OR ship the lines via a `jr:status` field. Decision: add `game:line` IPC in this task (one handler line, allowlisted under `games`; extend `test/jr-boot.test.js`'s allowlist expectation).
- Produces: `window.JrGamesUI.open(game)` — called by the renderer when a command result has `meta.game`; a full-window overlay in the dark UI with:
  - difficulty pick (EASY / NORMAL / HARD, three buttons, kid taps one — remembered per session, re-pickable per game)
  - **ttt:** 3×3 tapped grid; kid is X and moves first; after each kid tap → `gameMove({game:'ttt', board, difficulty})` → place O with a 400–700ms "thinking" delay + a `jarvisThinking` line; win/loss/draw → `gameScore` + the right line (`kidWins`/`jarvisWins`/`draw`; streak≥3 → `streak3` too) + tally strip (W-L-D, best streak)
  - **rps:** three big buttons (🪨 rendered as shaped canvas chips, not emoji — draw each chip with `OrbShapes.SHAPES[shape]` on a 64px canvas); on tap → `gameMove({game:'rps', history, difficulty})` (history = this session's previous kid throws, oldest first, maintained in the UI; the current tap is sent ONLY as the judge input after JARVIS's shape returns — mirror the engine's honesty in the wire protocol: request JARVIS's throw BEFORE telling main what the kid threw) → countdown: `rpsCountdown` line spoken/shown while the orb bounces three times (scale pulse via the existing orb canvas), then the morph (below), then `rpsJudge` client-side from the two throws → result line + scores.
  - **the morph:** during play the games overlay owns a canvas drawn with the same polar loop the JUNIOR orb used (`for theta 0..2π step 0.06: r = radius * OrbShapes.morphRadius(from, to, progress, theta, frame)`), tinted by `SHAPE_TINTS`, 350ms morph driven by `requestAnimationFrame`, then a 900ms hold, then morph back to `orb`. This canvas is the overlay's own — the real orb soul canvas underneath is untouched (no seam into the souls' render loops; cheaper and zero-risk to the eight souls).
  - ESC or a CLOSE button ends the game (records nothing if mid-game).
- **Fallback decision from the spec, honored here:** if the scissors polar shape reads as a lumpy crab on the real canvas (Step 4 eyeball), switch the scissors chip and reveal to the drawn-glyph fallback: keep the morph to a small core circle and draw two open blade lines + pivot dot over it (a `drawScissorsGlyph(ctx, cx, cy, size)` helper in `jr-games-ui.js`). The test-pinned polar shape stays for the chips either way.

- [ ] **Step 1: Write the overlay markup** into `src/index.html` (one `#jr-games` overlay: difficulty row, `#jr-board` grid container, `#jr-rps` button row, `#jr-game-canvas`, `#jr-game-line` text strip, `#jr-game-score` tally strip, CLOSE button) + script tags ordered `orbs/shapes.js` → `jr-games-ui.js` → (existing) `renderer.js`.

- [ ] **Step 2: Write `src/jr-games-ui.js`** — structure: state object `{game, difficulty, board, history, busy}`; `open(game)`; `renderBoard()`; `onKidTap(i)`; `runRpsRound(shape)`; `morph(from, to, then)` (rAF loop over `morphRadius`); `showLine(occasion)` (fetch `game:line`, set text, and speak it through the same TTS path renderer.js uses for command replies — find `tts:speak` usage and mirror it); `settle(outcome)` (scores + line + streak check). ~250 lines. Wire the renderer hook: in `src/renderer.js` where command results render, `if (result.meta?.game && window.JrGamesUI) window.JrGamesUI.open(result.meta.game);`

- [ ] **Step 3: Add the `game:line` IPC** (main.js handler using `gameLine(occasion, { age: parentControls.age() })`, allowlist entry under `games`, preload `gameLine: (occasion) => ipcRenderer.invoke('game:line', { occasion })`, one assertion added to the allowlist test). Run full suite green.

- [ ] **Step 4: Manual verification protocol** (run every line; screenshot as noted):

1. `npm run start:jr` (set up, games ON by default). Say/type "play tic tac toe" → overlay opens with a start line.
2. Pick EASY, play deliberately badly twice → verify a kid win occurs within a few games (the dial is real). Pick HARD, play perfectly → draw; play badly → JARVIS wins. Tallies update; streak survives a relaunch (scores file).
3. "play rock paper scissors" → chips render as SHAPES (screenshot). Throw rock five times in a row on HARD → JARVIS papers you most rounds (the pattern-read, felt).
4. The reveal: countdown line + three bounces + morph to the throw + hold + morph back (screenshot mid-morph). **Eyeball the scissors:** blades or crab? If crab → flip the glyph fallback on, re-eyeball, note the choice in the commit message.
5. Games OFF in the parent panel → relaunch → "play tic tac toe" → the jr-gate line, no overlay; the two `game:*` channels throw from DevTools.
6. `npm run start` (grown-up): "play tic tac toe" behaves exactly as before this branch (no overlay, ordinary model/router answer). Full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/jr-games-ui.js src/index.html src/renderer.js src/styles.css src/orbs/shapes.js main.js preload.js core/variant.js test/jr-boot.test.js
git commit -m "jr games: the board, the buttons, the countdown, and the orb that turns into a rock"
```

---

### Task 7: End-to-end pass + docs + handoff

- [ ] **Step 1:** Full suite: `node --test 2>&1 | tail -3` → 0 fail. Count delta vs the foundation plan's final count = this plan's added tests (expect ~25+).
- [ ] **Step 2:** Cold-start JR, run foundation Task 11's protocol PLUS the games protocol (Task 6 Step 4) in one sitting.
- [ ] **Step 3:** Update README's JR section (games paragraph: what they are, taps-not-speech, difficulty honesty — say plainly that easy throws games on purpose) and CHANGELOG.
- [ ] **Step 4:** Screenshots to Adam: the board mid-game, the RPS chips, the morph mid-frame, the scoreboard. OneDrive copies per the phone-review rule if he wants to show the kids.
- [ ] **Step 5:**

```bash
git add README.md CHANGELOG.md
git commit -m "jr games: document the games — and that easy loses on purpose"
git push origin jarvis-jr
```

---

## Self-review notes (already applied)

- Spec coverage: two games (T1/T2), taps not speech (T6 board/buttons; router only parses, T4), kid-picked difficulty (T6), minimax dial exactly 25/70/100 (T1), RPS normal-random / hard-history / easy-cheats-kidward + structural no-cheat (T2), written age-banded lines (T3), own scores file + no stars (T4), countdown-then-reveal shape A (T6), polar morph + scissors glyph fallback + screenshot-before-done (T5/T6), works with no model (nothing here touches ai-service), games gated by the checklist (T4/T6 step 4.5).
- Type consistency: `detectGame` returns `{game:'ttt'|'rps'}` and `meta.game` carries the same two values into `JrGamesUI.open(game)`; `rpsThrow(difficulty, history, rng)` matches the `game:move` payload `{game:'rps', history, difficulty}`; outcome vocabulary `'kid'|'jarvis'|'draw'` is identical in `rpsJudge`, `GameScores.record`, and `settle()`.
- The one deliberate wire-protocol nicety: the kid's current throw is not in the `game:move` request (JARVIS's shape is fetched first) — the engine's honesty guarantee, mirrored end to end.
