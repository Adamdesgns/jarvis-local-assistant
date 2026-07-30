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
    busy: false,          // true while a move/round is in flight — taps ignored
    cameraArmed: false,   // rps camera mode live (parent's gameCamera key + working webcam)
    cameraVetoed: false   // kid tapped a chip: buttons for this session, even if the arm is still in flight
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

  // A fixed line (camera-round mechanics, not table flavor — same precedent
  // as showConfused above): straight to the strip, spoken unless told not to.
  function sayLine(text, speakIt) {
    var el = $('jr-game-line');
    if (el) el.textContent = text;
    if (text && speakIt !== false && window.JrSpeak) {
      try { window.JrSpeak(text); } catch (error) { /* voice hiccups never block the game */ }
    }
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
  // The shared back half of every RPS round, button or camera: reveal
  // JARVIS's throw, judge, score, talk, and clean up. `jarvisShape` was
  // locked BEFORE this is called — see the wire-honesty note on both
  // callers. Resolves after cleanup; never rejects.
  function revealAndScore(kidShape, jarvisShape, gen) {
    return morph('orb', jarvisShape)
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
      })
      .catch(function () { if (gen === generation) showConfused(); })
      .then(function () {
        if (gen !== generation) return;
        state.busy = false;
        drawIdleOrb();
      });
  }

  // Wire honesty: request JARVIS's throw BEFORE telling main what the kid
  // threw (history only carries throws already resolved) — mirrors
  // core/games.js's own rpsThrow, which cannot see the kid's current move.
  function runRpsRound(kidShape) {
    if (state.busy) return;
    // Tapping a chip is the kid choosing buttons: camera mode stands down
    // for the session, predictably, rather than the two input styles
    // fighting over the same round. The veto also covers an arm still in
    // flight — getUserMedia + worker init take a couple of seconds, and a
    // chip tapped inside that window must win (live-caught race: the camera
    // armed mid-round and sat idle with the preview on and no loop running).
    state.cameraVetoed = true;
    if (state.cameraArmed) disarmCamera();
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
        return bounceOrb(3, 1200).then(function () {
          if (gen === generation) return revealAndScore(kidShape, jarvisShape, gen);
        });
      })
      .catch(function () {
        if (gen !== generation) return;
        showConfused();
        state.busy = false;
        drawIdleOrb();
      });
  }

  // ---- the camera round (parent's gameCamera key) ----
  // The kid shows a hand instead of tapping. Honesty is structural, same as
  // the buttons: JARVIS's throw is locked via gameMove BEFORE the countdown
  // starts — before a single capture frame exists — so nothing seen through
  // the lens can inform it. The camera result is only ever compared against
  // an already-decided shape. core/games.js's rpsThrow cannot take the
  // current throw at all (test-pinned), and this flow preserves exactly that
  // property one layer up.
  var CAMERA_BEATS_MS = 2800;     // "Rock. Paper. Scissors. Shoot." — 4 beats
  var CAPTURE_OPEN_MS = 2000;     // sampling opens just before "shoot"
  var CAPTURE_WINDOW_MS = 2400;   // and stays open long enough for slow hands

  // Pump frames through the stability gate until a confident read, the
  // timeout, or the round dying (generation bump). Resolves shape or null.
  function waitForStableShape(need, timeoutMs, gen) {
    return new Promise(function (resolve) {
      if (!window.JrHandShapes || !window.JrHandCamera) return resolve(null);
      var gate = window.JrHandShapes.createStableRead({ need: need });
      var done = false;
      function finish(shape) {
        if (done) return;
        done = true;
        window.JrHandCamera.stopSampling();
        resolve(shape);
      }
      var timer = setTimeout(function () { finish(null); }, timeoutMs);
      window.JrHandCamera.startSampling(function (shape) {
        if (done) return;
        if (gen !== generation) { clearTimeout(timer); finish(null); return; }
        var stable = gate.push(shape);
        if (stable) { clearTimeout(timer); finish(stable); }
      });
    });
  }

  function armCamera() {
    var gen = generation;
    var wrap = $('jr-cam-wrap');
    var video = $('jr-cam-video');
    if (!wrap || !video || !window.JrHandCamera) return;
    wrap.hidden = false;
    window.JrHandCamera.start(video).then(function () {
      if (gen !== generation || state.game !== 'rps' || state.cameraVetoed) {
        window.JrHandCamera.stop();
        wrap.hidden = true;
        return;
      }
      state.cameraArmed = true;
      runCameraRpsRound();
    }).catch(function () {
      wrap.hidden = true;
      if (gen === generation) sayLine('The camera is not playing along today. The buttons work.', false);
    });
  }

  function disarmCamera() {
    state.cameraArmed = false;
    if (window.JrHandCamera) window.JrHandCamera.stop();
    var wrap = $('jr-cam-wrap');
    if (wrap) wrap.hidden = true;
  }

  function runCameraRpsRound() {
    if (!state.cameraArmed || state.busy) return;
    var gen = generation;
    sayLine('Show me your hand.');
    // Readiness: any confident shape means a hand is in frame. These frames
    // are pre-throw by definition — the throw happens at "shoot", and
    // JARVIS's own move is locked before the countdown even begins.
    waitForStableShape(2, 25000, gen).then(function (seen) {
      if (gen !== generation || !state.cameraArmed || state.busy) return;
      if (!seen) {
        sayLine('I did not see a hand. The buttons work too.', false);
        return;
      }
      state.busy = true;
      var historySnapshot = state.history.slice();
      window.jarvis.gameMove({ game: 'rps', history: historySnapshot, difficulty: state.difficulty })
        .then(function (result) {
          if (gen !== generation) return;
          var jarvisShape = result && result.shape;
          if (['rock', 'paper', 'scissors'].indexOf(jarvisShape) === -1) throw new Error('bad shape');
          // Throw is LOCKED. Only now does the countdown - and any frame
          // that could show the kid's actual throw - begin.
          sayLine('Rock. Paper. Scissors. Shoot.');
          var beats = bounceOrb(4, CAMERA_BEATS_MS);
          var capture = delay(CAPTURE_OPEN_MS).then(function () {
            return waitForStableShape(2, CAPTURE_WINDOW_MS, gen);
          });
          return Promise.all([beats, capture]).then(function (results) {
            if (gen !== generation) return;
            var kidShape = results[1];
            if (!kidShape) {
              sayLine('I did not catch your hand that time. Use the buttons for this one.');
              state.busy = false;
              drawIdleOrb();
              return;
            }
            return revealAndScore(kidShape, jarvisShape, gen).then(function () {
              // Next round, hands-free, until the overlay closes or the kid
              // switches to buttons.
              if (gen !== generation || !state.cameraArmed) return;
              return delay(1800).then(function () {
                if (gen === generation && state.cameraArmed && !state.busy) runCameraRpsRound();
              });
            });
          });
        })
        .catch(function () {
          if (gen !== generation) return;
          showConfused();
          state.busy = false;
          drawIdleOrb();
        });
    });
  }

  // ---- overlay lifecycle ----
  function renderDifficultyActive() {
    var buttons = document.querySelectorAll('.jr-game-diff-btn');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle('active', buttons[i].dataset.difficulty === state.difficulty);
    }
  }

  function open(game, options) {
    if (game !== 'ttt' && game !== 'rps') return;
    generation += 1; // invalidate any move/round still in flight from before
    if (state.cameraArmed) disarmCamera(); // reopening always starts clean
    state.game = game;
    state.board = game === 'ttt' ? new Array(9).fill(null) : null;
    state.history = [];
    state.busy = false;
    state.cameraVetoed = false; // a fresh open is a fresh choice
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
    // Camera mode only when the PARENT's checklist says so (the flag rides
    // in from renderer.js off the live jr profile) and the machine can
    // actually do it. The buttons stay on screen either way — the camera is
    // an addition, never a wall.
    if (game === 'rps' && options && options.gameCamera === true &&
        window.JrHandCamera && window.JrHandCamera.available()) {
      armCamera();
    }
  }

  function close() {
    generation += 1; // invalidate any move/round still in flight
    disarmCamera(); // stream and OS camera light die with the overlay
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
