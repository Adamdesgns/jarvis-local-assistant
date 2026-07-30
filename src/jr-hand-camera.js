// Camera host for JR's rock-paper-scissors: owns the getUserMedia stream,
// the hand-reading worker (src/jr-hand-worker.js), and the frame pump.
// Plain script, same style as jr-games-ui.js — window.JrHandCamera is the
// only global it adds. Loaded on both builds, inert until start() is
// called, and only jr-games-ui calls it, only when the parent's gameCamera
// checklist key is on.
//
// Privacy posture, enforced here rather than promised: frames go straight
// from the <video> element into transferred ImageBitmaps consumed inside
// the worker, which closes each one after classifying it. Nothing is drawn
// to a canvas, written to disk, or sent over any network — there is no
// code path that could. stop() kills the tracks, so the OS camera light is
// tied to the overlay's lifetime.
(function () {
  var stream = null;
  var worker = null;
  var video = null;
  var sampleTimer = null;
  var awaitingRead = false;
  var readCallback = null;

  var SAMPLE_MS = 110; // ~9 reads/s — plenty for a 3-frame stability gate

  function available() {
    return Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && typeof Worker === 'function');
  }

  function active() { return stream !== null; }

  // Resolves once BOTH the camera is streaming into `videoEl` and the worker
  // has loaded the model. Rejects on either failing — callers treat any
  // rejection as "camera mode unavailable, use the buttons".
  function start(videoEl) {
    if (!available()) return Promise.reject(new Error('no camera support'));
    if (stream) return Promise.resolve();
    video = videoEl;
    var streamReady = navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: false
    }).then(function (mediaStream) {
      stream = mediaStream;
      videoEl.srcObject = mediaStream;
      return videoEl.play().catch(function () { /* autoplay policies do not apply to muted local streams, but never die on it */ });
    });
    var workerReady = new Promise(function (resolve, reject) {
      worker = new Worker('jr-hand-worker.js');
      worker.onmessage = function (event) {
        var msg = event.data || {};
        if (msg.type === 'ready') resolve();
        else if (msg.type === 'error') reject(new Error(msg.message || 'hand worker failed'));
        else if (msg.type === 'read') {
          awaitingRead = false;
          if (readCallback) readCallback(msg.shape || null);
        }
      };
      worker.onerror = function (event) { reject(new Error(event.message || 'hand worker crashed')); };
      worker.postMessage({ type: 'init' });
    });
    return Promise.all([streamReady, workerReady]).then(function () {}).catch(function (error) {
      stop();
      throw error;
    });
  }

  // Pump frames until stopSampling(). Backpressure by design: never more
  // than one frame in flight, so a slow classify degrades the sample rate
  // instead of queueing stale bitmaps.
  function startSampling(onRead) {
    readCallback = onRead;
    if (sampleTimer) return;
    sampleTimer = setInterval(function () {
      if (!stream || !worker || awaitingRead || !video || video.readyState < 2) return;
      awaitingRead = true;
      createImageBitmap(video).then(function (bitmap) {
        if (!worker) { bitmap.close(); awaitingRead = false; return; }
        worker.postMessage({ type: 'frame', bitmap: bitmap, ts: performance.now() }, [bitmap]);
      }).catch(function () { awaitingRead = false; });
    }, SAMPLE_MS);
  }

  function stopSampling() {
    if (sampleTimer) { clearInterval(sampleTimer); sampleTimer = null; }
    readCallback = null;
    awaitingRead = false;
  }

  function stop() {
    stopSampling();
    if (worker) { worker.terminate(); worker = null; }
    if (stream) {
      stream.getTracks().forEach(function (track) { try { track.stop(); } catch (error) { /* already dead */ } });
      stream = null;
    }
    if (video) { video.srcObject = null; video = null; }
  }

  window.JrHandCamera = {
    available: available,
    active: active,
    start: start,
    startSampling: startSampling,
    stopSampling: stopSampling,
    stop: stop
  };
})();
