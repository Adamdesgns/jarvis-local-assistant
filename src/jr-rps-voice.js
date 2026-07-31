// The voice rock-paper-scissors round driver: the renderer half of the
// router's session (core/router.js #rpsTurn). No overlay, no buttons — the
// kid chants, the router locks JARVIS's throw, and this file makes the orb
// become it (src/orb-shape-layer.js) while the webcam reads the kid's hand
// (src/jr-hand-camera.js + the worker). Plain script; window.JrRpsVoice.
//
// Honesty note, one layer down from the router's: by the time any code in
// this file captures a frame, the router has ALREADY answered the shoot
// command — the throw in `rps.jarvisShape` was locked from history before
// this file even hears about the round.
(function () {
  var CAPTURE_MS = 2600;   // the kid holds the throw up a beat — natural
  var REARM_CAPTURE_MS = 4200; // wider window when the lens had to wake first
  var STABLE_NEED = 2;     // consecutive agreeing frames
  var HOLD_MS = 1500;      // how long the orb stays the shape after the call
  var IDLE_MS = 5 * 60 * 1000; // mirror of the router's RPS_IDLE_MS
  // Adam's rule: the webcam does not idle on. Twenty seconds with no round
  // activity and the tracks stop (OS camera light off, pill off) even though
  // the GAME session stays live — the next chant re-arms the lens itself and
  // simply holds the capture window open a little longer while it wakes.
  var CAMERA_NAP_MS = 20 * 1000;

  var cameraUp = false;
  var idleTimer = null;
  var napTimer = null;

  function pill(show) {
    var el = document.getElementById('rps-cam-pill');
    if (el) el.hidden = !show;
  }

  function say(line) {
    if (line && window.JrSpeak) {
      try { window.JrSpeak(line); } catch (error) { /* voice hiccups never break the game */ }
    }
  }

  function resetIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      // The kid wandered off: fold quietly, kill the camera, restore the orb.
      if (window.jarvis.gameRpsExpired) window.jarvis.gameRpsExpired().catch(function () {});
      teardown();
    }, IDLE_MS);
  }

  // The camera's nap: stop the TRACKS after quiet, keep the game alive.
  function napCamera() {
    if (napTimer) { clearTimeout(napTimer); napTimer = null; }
    if (cameraUp && window.JrHandCamera) window.JrHandCamera.stop();
    cameraUp = false;
    pill(false);
  }

  function armNap() {
    if (napTimer) clearTimeout(napTimer);
    if (!cameraUp) return;
    napTimer = setTimeout(napCamera, CAMERA_NAP_MS);
  }

  function clearNap() {
    if (napTimer) { clearTimeout(napTimer); napTimer = null; }
  }

  function teardown() {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    clearNap();
    if (cameraUp && window.JrHandCamera) window.JrHandCamera.stop();
    cameraUp = false;
    pill(false);
    if (window.OrbShapeLayer && window.OrbShapeLayer.active()) window.OrbShapeLayer.morphBack();
  }

  function startCamera() {
    var video = document.getElementById('rps-cam-video');
    if (!video || !window.JrHandCamera || !window.JrHandCamera.available()) {
      return Promise.reject(new Error('no camera'));
    }
    return window.JrHandCamera.start(video).then(function () {
      cameraUp = true;
      pill(true);
      armNap();
    });
  }

  // Sample frames through the stability gate until a confident shape, the
  // timeout, or teardown. Resolves shape|null; never rejects.
  function captureShape(timeoutMs) {
    return new Promise(function (resolve) {
      if (!cameraUp || !window.JrHandShapes) return resolve(null);
      var gate = window.JrHandShapes.createStableRead({ need: STABLE_NEED });
      var done = false;
      function finish(shape) {
        if (done) return;
        done = true;
        if (window.JrHandCamera) window.JrHandCamera.stopSampling();
        resolve(shape);
      }
      var timer = setTimeout(function () { finish(null); }, timeoutMs);
      window.JrHandCamera.startSampling(function (shape) {
        if (done) return;
        var stable = gate.push(shape);
        if (stable) { clearTimeout(timer); finish(stable); }
      });
    });
  }

  function runCameraRound(jarvisShape) {
    clearNap(); // a round is live — the lens stays up for all of it
    // If the camera napped between rounds, wake it now: the morph is the
    // theatre that covers the wake-up, and the capture window widens so the
    // kid's held throw is still there when the first frame arrives.
    var napped = !cameraUp;
    var ready = napped ? startCamera() : Promise.resolve();
    // Morph and read together: JARVIS shows his hand as he reads yours,
    // exactly like the playground version.
    var morph = window.OrbShapeLayer ? window.OrbShapeLayer.morphTo(jarvisShape) : Promise.resolve();
    var read = ready.then(function () {
      return captureShape(napped ? REARM_CAPTURE_MS : CAPTURE_MS);
    }).catch(function () {
      // The lens would not wake (device gone, permission pulled). Degrade
      // the SESSION to honor mode — the locked throw survives, so "shoot"
      // again stays honest — and say so plainly.
      if (window.jarvis.gameRpsCameraFailed) window.jarvis.gameRpsCameraFailed().catch(function () {});
      return null;
    });
    Promise.all([morph, read]).then(function (results) {
      var kidShape = results[1];
      if (!kidShape) {
        say(cameraUp
          ? 'I did not catch your hand. Hold it up and say shoot again.'
          : 'The camera is not playing along. Say shoot again and then tell me what you threw.');
        armNap();
        return window.OrbShapeLayer ? window.OrbShapeLayer.morphBack() : null;
      }
      return window.jarvis.gameRpsOutcome(kidShape).then(function (outcome) {
        if (!outcome || !outcome.ok) {
          // The session vanished under us (stop/expiry racing the read).
          armNap();
          return window.OrbShapeLayer ? window.OrbShapeLayer.morphBack() : null;
        }
        say(outcome.line);
        return new Promise(function (resolve) { setTimeout(resolve, HOLD_MS); }).then(function () {
          armNap(); // the between-rounds clock starts once the reveal is over
          if (window.OrbShapeLayer) return window.OrbShapeLayer.morphBack();
        });
      });
    }).catch(function () {
      armNap();
      if (window.OrbShapeLayer) window.OrbShapeLayer.morphBack();
    });
  }

  // Honor mode's reveal: the answer was spoken to the router, the router's
  // reply line is already being spoken by the ordinary result path — this
  // just makes the orb BE the throw while it talks.
  function runHonorReveal(jarvisShape) {
    if (!window.OrbShapeLayer) return;
    window.OrbShapeLayer.morphTo(jarvisShape).then(function () {
      setTimeout(function () { window.OrbShapeLayer.morphBack(); }, HOLD_MS + 600);
    });
  }

  // Entry point — renderer.js hands every result.rps here.
  function handle(rps) {
    if (!rps || !rps.phase) return;
    resetIdle();
    if (rps.phase === 'invite') {
      if (rps.camera) {
        startCamera().catch(function () {
          // No device / refused / worker died: tell the router so the round
          // degrades to honor mode instead of hanging on a dead lens.
          if (window.jarvis.gameRpsCameraFailed) window.jarvis.gameRpsCameraFailed().catch(function () {});
          pill(false);
        });
      }
      return;
    }
    if (rps.phase === 'shoot') { runCameraRound(rps.jarvisShape); return; }
    if (rps.phase === 'reveal') { runHonorReveal(rps.jarvisShape); return; }
    if (rps.phase === 'stop') { teardown(); return; }
    // 'ask' and 'difficulty' are spoken by the ordinary result path; nothing visual.
  }

  window.JrRpsVoice = { handle: handle, teardown: teardown };
})();
