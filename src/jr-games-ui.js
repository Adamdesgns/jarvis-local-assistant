'use strict';

// JARVIS JR — the games overlay: tic tac toe and rock paper scissors.
// Plain script, no modules, same style as jr-parent-ui.js: window.JrGamesUI
// is the only thing this file adds to global scope. open(game) is called
// from src/renderer.js's command-result hook the moment a router result
// carries a truthy `.game` ('ttt'|'rps', source 'jr-game') — see core/games.js
// (detectGame) and core/router.js. On the standard build this file loads but
// open() is never called (the router branch that sets `.game` never fires
// there), so everything below stays inert.
//
// This overlay owns ONE canvas (#jr-game-canvas) for the reveal morph and
// three small 64px canvases (the RPS chips) — all separate from the real orb
// soul canvas underneath. No seam into the souls' render loops: cheaper, and
// zero risk to the eight souls.

(function () {
  function $(id) { return document.getElementById(id); }

  var TTT_LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];
  var RPS_BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' }; // key beats value

  // Fallback decision from the games spec (Step 4's eyeball) — VERDICT: ON.
  // Verified live on the real canvas (CDP screenshot, jarvis-jr-build Task 6
  // manual pass): the polar scissors shape reads as a soft rounded cloud/
  // blob, not blades — see .superpowers/sdd/screens/t6-06-rps-reveal-mid2.png.
  // The RPS CHIPS keep the real polar formula either way (it is test-pinned
  // in src/orbs/shapes.js) — only the big reveal canvas switches to a small
  // core + drawn blade glyph when this is on.
  var SCISSORS_GLYPH_FALLBACK = true;

  var state = {
    game: null,          // 'ttt' | 'rps' | null (closed)
    difficulty: 'normal', // remembered per session, re-pickable per game
    board: null,          // ttt: array(9) of null | 'X' | 'O'
    history: [],          // rps: the kid's PREVIOUS throws this session, oldest first
    busy: false           // true while a move/round is in flight — taps ignored
  };

  // Bumped by every open()/close(). A move/round in flight (gameMove/gameScore
  // round-trips, the RPS animation chain) captures the generation it started
  // under; every async continuation checks it's still current before
  // touching state or the DOM. Without this, closing mid-move (ESC/CLOSE) or
  // reopening a fresh game while an old IPC round-trip is still pending lets
  // that stale callback null-deref state.board, or paint a "confused" line /
  // a stray move over whatever round is now actually on screen — found live
  // during this task's manual pass (ESC during a kid's move, then a fresh
  // game opened before the abandoned move's gameMove response arrived).
  var generation = 0;

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // ---- tiny pure helpers (mirror core/games.js's tttWinner/rpsJudge — the
  // renderer owns the board on screen, so it needs its own game-over read;
  // see the comment atop core/games.js) ----
  function tttWinner(board) {
    for (var i = 0; i < TTT_LINES.length; i++) {
      var line = TTT_LINES[i];
      var a = board[line[0]], b = board[line[1]], c = board[line[2]];
      if (a && a === b && a === c) return a;
    }
    for (var j = 0; j < 9; j++) if (!board[j]) return null;
    return 'draw';
  }

  function rpsJudge(kid, jarvis) {
    if (kid === jarvis) return 'tie';
    return RPS_BEATS[kid] === jarvis ? 'kid' : 'jarvis';
  }

  // ---- lines + TTS. Mirrors src/renderer.js's speak() path (window.JrSpeak,
  // exported there for exactly this reuse) so game lines sound the same as
  // every other command reply — same voice, same settings gate. A voice
  // hiccup or a game:line miss never blocks the game: both are swallowed. ----
  function showLine(occasion, speakIt) {
    return window.jarvis.gameLine(occasion).catch(function () { return { line: '' }; }).then(function (result) {
      var line = (result && result.line) || '';
      var el = $('jr-game-line');
      if (el) el.textContent = line;
      if (line && speakIt !== false && window.JrSpeak) {
        try { window.JrSpeak(line); } catch (error) { /* never let a voice hiccup break the game */ }
      }
      return line;
    });
  }

  function showConfused() {
    var el = $('jr-game-line');
    if (el) el.textContent = "Hmm, that move confused me — let's try that again.";
  }

  // ---- canvas drawing: polar loop per the games spec, theta 0..2π step
  // 0.06, tinted by OrbShapes.SHAPE_TINTS. ----
  function accentColor() {
    var v = getComputedStyle(document.documentElement).getPropertyValue('--accent-bright');
    return (v && v.trim()) || '#e8c880';
  }

  function traceShape(ctx, cx, cy, radiusFn) {
    ctx.beginPath();
    var first = true;
    for (var theta = 0; theta < Math.PI * 2; theta += 0.06) {
      var r = radiusFn(theta);
      var x = cx + Math.cos(theta) * r;
      var y = cy + Math.sin(theta) * r;
      if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  // A static chip (64px canvas) for an RPS button — always the real,
  // test-pinned polar shape, glyph fallback or not.
  function drawChip(canvas, shape) {
    if (!canvas || !window.OrbShapes) return;
    var ctx = canvas.getContext('2d');
    var size = canvas.width;
    var cx = size / 2, cy = size / 2, radius = size * 0.36;
    ctx.clearRect(0, 0, size, size);
    traceShape(ctx, cx, cy, function (theta) { return radius * window.OrbShapes.SHAPES[shape](theta, 0); });
    ctx.fillStyle = window.OrbShapes.SHAPE_TINTS[shape] || accentColor();
    ctx.fill();
  }

  function drawAllChips() {
    var buttons = document.querySelectorAll('#jr-rps .jr-rps-btn');
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      drawChip(btn.querySelector('canvas'), btn.dataset.shape);
    }
  }

  // Two open blade lines + a pivot dot, drawn OVER a small core circle —
  // the glyph fallback for a scissors reveal that reads as a blob on real
  // hardware. `alpha` fades the glyph in/out across the morph.
  function drawScissorsGlyph(ctx, cx, cy, size, alpha) {
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    var tint = (window.OrbShapes && window.OrbShapes.SHAPE_TINTS.scissors) || '#c0c8d8';
    ctx.strokeStyle = tint;
    ctx.lineWidth = Math.max(2, size * 0.1);
    ctx.lineCap = 'round';
    [2.62, 0.52].forEach(function (angle) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * size * 1.05, cy + Math.sin(angle) * size * 1.05);
      ctx.stroke();
    });
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(3, size * 0.14), 0, Math.PI * 2);
    ctx.fillStyle = tint;
    ctx.fill();
    ctx.restore();
  }

  // A quadratic in/out ease — a small, deliberate duplicate of shapes.js's
  // own `ease` (not exported) used ONLY for the glyph-fallback core blend
  // below; the pinned morph math (OrbShapes.morphRadius) is used everywhere
  // else untouched.
  function easeLocal(p) { return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; }

  function pickTint(from, to) {
    var tints = (window.OrbShapes && window.OrbShapes.SHAPE_TINTS) || {};
    return tints[to] || tints[from] || accentColor();
  }

  function drawRevealFrame(from, to, progress, t) {
    var canvas = $('jr-game-canvas');
    if (!canvas || !window.OrbShapes) return;
    var ctx = canvas.getContext('2d');
    var size = canvas.width;
    var cx = size / 2, cy = size / 2, radius = size * 0.32;
    ctx.clearRect(0, 0, size, size);
    var scissorsInvolved = SCISSORS_GLYPH_FALLBACK && (from === 'scissors' || to === 'scissors');
    if (scissorsInvolved) {
      var f = easeLocal(progress);
      var fromR = from === 'scissors' ? 0.5 : null;
      var toR = to === 'scissors' ? 0.5 : null;
      traceShape(ctx, cx, cy, function (theta) {
        var a = fromR !== null ? fromR : window.OrbShapes.SHAPES[from](theta, t);
        var b = toR !== null ? toR : window.OrbShapes.SHAPES[to](theta, t);
        return radius * (a * (1 - f) + b * f);
      });
    } else {
      traceShape(ctx, cx, cy, function (theta) { return radius * window.OrbShapes.morphRadius(from, to, progress, theta, t); });
    }
    ctx.fillStyle = pickTint(from, to);
    ctx.fill();
    if (scissorsInvolved) {
      var alpha = to === 'scissors' ? easeLocal(progress) : (from === 'scissors' ? 1 - easeLocal(progress) : 0);
      drawScissorsGlyph(ctx, cx, cy, radius, alpha);
    }
  }

  function drawOrbPulse(scale, t) {
    var canvas = $('jr-game-canvas');
    if (!canvas || !window.OrbShapes) return;
    var ctx = canvas.getContext('2d');
    var size = canvas.width;
    var cx = size / 2, cy = size / 2, radius = size * 0.32 * scale;
    ctx.clearRect(0, 0, size, size);
    traceShape(ctx, cx, cy, function (theta) { return radius * window.OrbShapes.SHAPES.orb(theta, t); });
    ctx.fillStyle = accentColor();
    ctx.fill();
  }

  function drawIdleOrb() { drawOrbPulse(1, 0); }

  // ---- animation: the countdown bounce (three scale pulses) and the morph
  // (350ms driven by rAF, 350ms back, with a 900ms hold on the thrown shape
  // in between — see runRpsRound). ----
  function bounceOrb(times, duration) {
    return new Promise(function (resolve) {
      var start = null;
      function tick(now) {
        if (start === null) start = now;
        var progress = Math.min(1, (now - start) / duration);
        drawOrbPulse(1 + 0.16 * Math.abs(Math.sin(progress * times * Math.PI)), now);
        if (progress < 1) requestAnimationFrame(tick); else resolve();
      }
      requestAnimationFrame(tick);
    });
  }

  function morph(from, to, duration) {
    duration = duration || 350;
    return new Promise(function (resolve) {
      var start = null;
      function tick(now) {
        if (start === null) start = now;
        var progress = Math.min(1, (now - start) / duration);
        drawRevealFrame(from, to, progress, now);
        if (progress < 1) requestAnimationFrame(tick); else resolve();
      }
      requestAnimationFrame(tick);
    });
  }

  // ---- scoreboard ----
  function updateScoreStrip(scores) {
    var el = $('jr-game-score');
    if (!el || !scores || !state.game) return;
    var tally = scores[state.game];
    if (!tally) return;
    el.textContent = tally.wins + 'W · ' + tally.losses + 'L · ' + tally.draws + 'D  —  best streak ' + tally.bestStreak;
  }

  function refreshScoreStrip() {
    window.jarvis.gameScore({}).then(updateScoreStrip).catch(function () {});
  }

  // ---- tic tac toe ----
  function renderBoard() {
    var container = $('jr-board');
    if (!container || !state.board) return;
    container.innerHTML = '';
    for (var i = 0; i < 9; i++) {
      var cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'jr-cell';
      cell.textContent = state.board[i] || '';
      cell.disabled = Boolean(state.board[i]) || state.busy;
      cell.dataset.mark = state.board[i] || '';
      cell.addEventListener('click', (function (index) { return function () { onKidTap(index); }; })(i));
      container.appendChild(cell);
    }
  }

  function onKidTap(i) {
    if (state.busy || !state.board || state.board[i]) return;
    var gen = generation;
    state.board[i] = 'X';
    var winner = tttWinner(state.board);
    if (winner) { renderBoard(); finishTtt(winner, gen); return; }
    state.busy = true;
    renderBoard();
    showLine('jarvisThinking');
    var boardSnapshot = state.board.slice();
    var difficulty = state.difficulty;
    delay(400 + Math.floor(Math.random() * 300))
      .then(function () { return window.jarvis.gameMove({ game: 'ttt', board: boardSnapshot, difficulty: difficulty }); })
      .then(function (result) {
        if (gen !== generation) return; // overlay closed/reopened while this was in flight
        var move = result && typeof result.move === 'number' ? result.move : -1;
        if (move >= 0 && move < 9 && !state.board[move]) state.board[move] = 'O';
        state.busy = false;
        renderBoard();
        var winner2 = tttWinner(state.board);
        if (winner2) { finishTtt(winner2, gen); return; }
        // Otherwise it's the kid's turn again — clear the "thinking" line so
        // it doesn't sit on screen looking like JARVIS is still deciding.
        var lineEl = $('jr-game-line'); if (lineEl) lineEl.textContent = '';
      })
      .catch(function () {
        if (gen !== generation) return;
        state.busy = false;
        showConfused();
        renderBoard();
      });
  }

  function finishTtt(winner, gen) {
    state.busy = true;
    var outcome = winner === 'draw' ? 'draw' : (winner === 'X' ? 'kid' : 'jarvis');
    var occasion = outcome === 'kid' ? 'kidWins' : outcome === 'jarvis' ? 'jarvisWins' : 'draw';
    window.jarvis.gameScore({ game: 'ttt', outcome: outcome })
      .then(function (scores) {
        if (gen !== generation) return;
        updateScoreStrip(scores);
        return showLine(occasion).then(function () {
          if (gen !== generation) return;
          if (outcome === 'kid' && scores.ttt && scores.ttt.streak >= 3) {
            return delay(1100).then(function () { if (gen === generation) return showLine('streak3'); });
          }
        });
      })
      .catch(function () { if (gen === generation) showConfused(); })
      .then(function () { return delay(1400); })
      .then(function () {
        if (gen !== generation) return;
        state.board = new Array(9).fill(null);
        state.busy = false;
        renderBoard();
      });
  }

  // ---- rock paper scissors ----
  // Wire honesty: request JARVIS's throw BEFORE telling main what the kid
  // threw (history only carries throws already resolved) — mirrors
  // core/games.js's own rpsThrow, which cannot see the kid's current move.
  function runRpsRound(kidShape) {
    if (state.busy) return;
    var gen = generation;
    state.busy = true;
    var difficulty = state.difficulty;
    var historySnapshot = state.history.slice();
    window.jarvis.gameMove({ game: 'rps', history: historySnapshot, difficulty: difficulty })
      .then(function (result) {
        if (gen !== generation) return;
        var jarvisShape = result && result.shape;
        if (['rock', 'paper', 'scissors'].indexOf(jarvisShape) === -1) throw new Error('bad shape');
        showLine('rpsCountdown');
        return bounceOrb(3, 1200)
          .then(function () { if (gen === generation) return morph('orb', jarvisShape); })
          .then(function () { return delay(900); })
          .then(function () { if (gen === generation) return morph(jarvisShape, 'orb'); })
          .then(function () {
            if (gen !== generation) return;
            var outcome = rpsJudge(kidShape, jarvisShape);
            state.history.push(kidShape);
            var scoreOutcome = outcome === 'tie' ? 'draw' : outcome;
            return window.jarvis.gameScore({ game: 'rps', outcome: scoreOutcome }).then(function (scores) {
              if (gen !== generation) return;
              updateScoreStrip(scores);
              var occasion = scoreOutcome === 'kid' ? 'kidWins' : scoreOutcome === 'jarvis' ? 'jarvisWins' : 'draw';
              return showLine(occasion).then(function () {
                if (gen !== generation) return;
                if (scoreOutcome === 'kid' && scores.rps && scores.rps.streak >= 3) {
                  return delay(1100).then(function () { if (gen === generation) return showLine('streak3'); });
                }
              });
            });
          });
      })
      .catch(function () { if (gen === generation) showConfused(); })
      .then(function () {
        if (gen !== generation) return;
        state.busy = false;
        drawIdleOrb();
      });
  }

  // ---- overlay lifecycle ----
  function renderDifficultyActive() {
    var buttons = document.querySelectorAll('.jr-game-diff-btn');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle('active', buttons[i].dataset.difficulty === state.difficulty);
    }
  }

  function open(game) {
    if (game !== 'ttt' && game !== 'rps') return;
    generation += 1; // invalidate any move/round still in flight from before
    state.game = game;
    state.board = game === 'ttt' ? new Array(9).fill(null) : null;
    state.history = [];
    state.busy = false;
    var overlay = $('jr-games');
    if (!overlay) return;
    overlay.hidden = false;
    var title = $('jr-games-title');
    if (title) title.textContent = game === 'ttt' ? 'TIC TAC TOE' : 'ROCK PAPER SCISSORS';
    renderDifficultyActive();
    var board = $('jr-board'); if (board) board.hidden = game !== 'ttt';
    var rps = $('jr-rps'); if (rps) rps.hidden = game !== 'rps';
    if (game === 'ttt') renderBoard();
    if (game === 'rps') drawAllChips();
    drawIdleOrb();
    // A start line for the overlay's own strip — text only, not spoken:
    // the router's own gameStart line (a separate random pick, same table)
    // is already spoken through the ordinary command-reply path in
    // src/renderer.js, and speaking both would overlap.
    showLine('gameStart', false);
    refreshScoreStrip();
  }

  function close() {
    generation += 1; // invalidate any move/round still in flight
    var overlay = $('jr-games');
    if (overlay) overlay.hidden = true; // ESC/CLOSE mid-game records nothing
    state.game = null;
    state.board = null;
    state.busy = false;
  }

  function bindEvents() {
    var diffButtons = document.querySelectorAll('.jr-game-diff-btn');
    for (var i = 0; i < diffButtons.length; i++) {
      diffButtons[i].addEventListener('click', (function (btn) {
        return function () { state.difficulty = btn.dataset.difficulty; renderDifficultyActive(); };
      })(diffButtons[i]));
    }
    var rpsButtons = document.querySelectorAll('#jr-rps .jr-rps-btn');
    for (var j = 0; j < rpsButtons.length; j++) {
      rpsButtons[j].addEventListener('click', (function (btn) {
        return function () { runRpsRound(btn.dataset.shape); };
      })(rpsButtons[j]));
    }
    var closeButton = $('jr-games-close');
    if (closeButton) closeButton.addEventListener('click', close);
    document.addEventListener('keydown', function (event) {
      var overlay = $('jr-games');
      if (event.key === 'Escape' && overlay && !overlay.hidden) close();
    });
  }

  bindEvents();
  window.JrGamesUI = { open: open, close: close };
})();
