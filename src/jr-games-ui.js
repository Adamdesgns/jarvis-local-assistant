'use strict';

// JARVIS JR — the tic-tac-toe overlay. Plain script, no modules, same style
// as jr-parent-ui.js: window.JrGamesUI is the only global this file adds.
// open(game) is called from src/renderer.js's command-result hook when a
// router result carries `.game` — which, since the 2026-07-30 redesign, is
// ONLY ever 'ttt': rock paper scissors became the ORB's voice game on the
// main screen (core/router.js session + src/jr-rps-voice.js +
// src/orb-shape-layer.js) after Adam rejected the overlay outright — "That
// is not the orb. I never wanted to leave the main screen… I never said to
// have a selection tab." A board still needs touch, so tic tac toe keeps
// this sheet. On the standard build this file loads but open() never fires.

(function () {
  function $(id) { return document.getElementById(id); }

  var TTT_LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];

  var state = {
    game: null,           // 'ttt' | null (closed)
    difficulty: 'normal', // remembered per session, re-pickable per game
    board: null,          // array(9) of null | 'X' | 'O'
    busy: false           // true while a move is in flight — taps ignored
  };

  // Bumped by every open()/close(). A move in flight captures the generation
  // it started under; every async continuation checks it's still current
  // before touching state or the DOM — closing mid-move must strand the
  // stale callback, not let it paint over a fresh board (found live: ESC
  // during a move, then a fresh game before the abandoned reply arrived).
  var generation = 0;

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // Mirror of core/games.js's tttWinner — the renderer owns the board on
  // screen, so it needs its own game-over read.
  function tttWinner(board) {
    for (var i = 0; i < TTT_LINES.length; i++) {
      var line = TTT_LINES[i];
      var a = board[line[0]], b = board[line[1]], c = board[line[2]];
      if (a && a === b && a === c) return a;
    }
    for (var j = 0; j < 9; j++) if (!board[j]) return null;
    return 'draw';
  }

  // Lines + TTS via window.JrSpeak (renderer.js exports it for exactly this
  // reuse). A voice hiccup or a game:line miss never blocks the game.
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

  // ---- the idle orb on the overlay's small canvas ----
  function accentColor() {
    var v = getComputedStyle(document.documentElement).getPropertyValue('--accent-bright');
    return (v && v.trim()) || '#e8c880';
  }

  function drawIdleOrb() {
    var canvas = $('jr-game-canvas');
    if (!canvas || !window.OrbShapes) return;
    var ctx = canvas.getContext('2d');
    var size = canvas.width;
    var cx = size / 2, cy = size / 2, radius = size * 0.32;
    ctx.clearRect(0, 0, size, size);
    ctx.beginPath();
    var first = true;
    for (var theta = 0; theta < Math.PI * 2; theta += 0.06) {
      var r = radius * window.OrbShapes.SHAPES.orb(theta, 0);
      var x = cx + Math.cos(theta) * r;
      var y = cy + Math.sin(theta) * r;
      if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = accentColor();
    ctx.fill();
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

  // ---- overlay lifecycle ----
  function renderDifficultyActive() {
    var buttons = document.querySelectorAll('.jr-game-diff-btn');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle('active', buttons[i].dataset.difficulty === state.difficulty);
    }
  }

  function open(game) {
    if (game !== 'ttt') return; // rps lives on the main screen now
    generation += 1; // invalidate any move still in flight from before
    state.game = game;
    state.board = new Array(9).fill(null);
    state.busy = false;
    var overlay = $('jr-games');
    if (!overlay) return;
    overlay.hidden = false;
    renderDifficultyActive();
    var board = $('jr-board'); if (board) board.hidden = false;
    renderBoard();
    drawIdleOrb();
    // Text only, not spoken: the router's own gameStart line is already
    // spoken through the ordinary command-reply path, and both would overlap.
    showLine('gameStart', false);
    refreshScoreStrip();
  }

  function close() {
    generation += 1; // invalidate any move still in flight
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
