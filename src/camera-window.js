// A single camera in its own window (spec: 2026-08-04-camera-windows-design).
//
// Deliberately thin. Which camera it shows arrives in the query string, the live
// view runs through the same live-player.js the grid uses, and the main process
// owns the window's position and the pop-in bookkeeping. Nothing about camera
// accounts or streams is duplicated here.
(function () {
  const params = new URLSearchParams(window.location.search);
  const camera = {
    key: params.get('key') || '',
    name: params.get('name') || 'Camera',
    brand: params.get('brand') || ''
  };

  const video = document.querySelector('video');
  const status = document.getElementById('status');
  const dot = document.getElementById('dot');
  const retry = document.getElementById('retry');

  document.title = `${camera.name} · JARVIS`;
  document.getElementById('name').textContent = camera.name;

  let handle = null;

  function show(message, isError = false) {
    status.hidden = false;
    status.textContent = message;
    status.classList.toggle('error', isError);
    retry.hidden = !isError;
    dot.dataset.live = 'off';
  }

  function live() {
    status.hidden = true;
    retry.hidden = true;
    dot.dataset.live = 'on';
  }

  async function stop() {
    if (handle) {
      const current = handle;
      handle = null;
      try { current.stop(); } catch { /* already gone */ }
    }
    // Release the camera itself, not just the player — a Blink view left open
    // keeps a battery camera awake.
    try { await window.jarvis.cameras.liveStop(camera.key); } catch { /* closing anyway */ }
  }

  async function start() {
    if (!camera.key) { show('This window was opened without a camera.', true); return; }
    await stop();
    show('Connecting…');
    const started = await window.jarvis.cameras.liveStart(camera.key);
    if (!started.ok) { show(started.message || 'Live view is not available.', true); return; }
    try {
      handle = await window.LivePlayer.play({
        video,
        camera,
        live: started,
        onError: (detail) => { handle = null; show(`Live view stopped: ${detail}`, true); }
      });
      live();
    } catch (error) {
      await stop();
      show(`Live view failed: ${error.message}`, true);
    }
  }

  retry.addEventListener('click', () => { start(); });
  document.getElementById('close').addEventListener('click', async () => {
    await stop();
    window.jarvis.cameras.popIn(camera.key);
  });

  // Closing via the OS (Alt+F4, taskbar) has to release the stream too, and the
  // main process needs to hear about it so the grid can take the camera back.
  window.addEventListener('beforeunload', () => {
    if (handle) { try { handle.stop(); } catch { /* already gone */ } }
    try { window.jarvis.cameras.liveStop(camera.key); } catch { /* closing */ }
  });

  start();
})();
