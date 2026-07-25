// DEFENSE MODE — the renderer side of the posture. The service in the main
// process decides WHEN (Pro gate, wave-off window, triggers); this file only
// ever changes what is on screen, and undoes it exactly on exit.
//
// The camera module genuinely becomes the defense view: the real #camera-grid
// node is moved into the wall on entry and moved home on exit. One node, one
// set of WebRTC streams, nothing duplicated.
(() => {
  const board = document.getElementById('defense-board');
  const bannerLabel = document.getElementById('defense-banner-label');
  const wall = document.getElementById('defense-wall');
  const alertText = document.getElementById('defense-alert');
  const alertInstruction = document.getElementById('defense-alert-instruction');
  const headlineList = document.getElementById('defense-headlines');
  const pendingCard = document.getElementById('defense-pending');
  const pendingReason = document.getElementById('defense-pending-reason');
  const pendingCount = document.getElementById('defense-pending-count');

  const grid = document.getElementById('camera-grid');
  const gridHome = grid.parentElement; // .cameras-content — where it goes back
  let active = false;
  let startedLiveKeys = [];
  let countdownTimer = null;
  let lastCoreState = 'ready';
  let mainOrbWasPaused = false;

  // The red sentinel: a second engine instance wearing the user's chosen
  // soul, created on entry and destroyed on exit (widget.js mold — a canvas
  // only ever holds one context type, so every create gets a fresh node).
  // The red comes from CSS on #defense-orb, never from the skins.
  const orbHost = {
    canvas: document.getElementById('defense-orb'),
    instance: null,
    create() {
      const engine = window.OrbEngine;
      if (!engine || !this.canvas || this.instance) return;
      const main = window.jarvisHologram; // live skin/color, incl. unsaved preview
      const resolved = engine.resolveExact(main && main.skinName) || engine.resolve('original');
      if (!resolved) return;
      const fresh = this.canvas.cloneNode(false);
      this.canvas.replaceWith(fresh);
      this.canvas = fresh;
      this.instance = resolved.create(fresh);
      if (this.instance.setPalette) this.instance.setPalette(engine.normalizePalette(main && main.palette));
      this.instance.setState(lastCoreState);
    },
    destroy() {
      if (!this.instance) return;
      if (this.instance.destroy) this.instance.destroy();
      this.instance = null;
      const fresh = this.canvas.cloneNode(false); // drop the retired skin's last frame
      this.canvas.replaceWith(fresh);
      this.canvas = fresh;
    },
    setState(state) {
      lastCoreState = state || 'ready';
      if (this.instance) this.instance.setState(lastCoreState);
    },
    setAudioLevel(level) {
      if (this.instance && this.instance.setAudioLevel) this.instance.setAudioLevel(level);
    }
  };

  function renderRail(alert, headlines) {
    const properties = alert && alert.properties;
    alertText.textContent = properties
      ? (properties.headline || properties.event || 'Active alert')
      : 'No active weather alert.';
    alertInstruction.hidden = !properties || !properties.instruction;
    alertInstruction.textContent = (properties && properties.instruction) || '';
    headlineList.replaceChildren();
    if (!headlines || !headlines.length) {
      const none = document.createElement('li');
      none.className = 'defense-none';
      none.textContent = 'No headlines. Add RSS feeds in Settings → CAMERAS.';
      headlineList.append(none);
      return;
    }
    for (const item of headlines) {
      const row = document.createElement('li');
      row.textContent = item.title;
      if (item.date) {
        const when = document.createElement('time');
        when.textContent = item.date;
        row.append(when);
      }
      headlineList.append(row);
    }
  }

  function goLiveEverywhere() {
    startedLiveKeys = [];
    for (const tile of grid.querySelectorAll('.camera-tile')) {
      if (tile.dataset.live !== 'on' && tile.dataset.live !== 'connecting') {
        const button = tile.querySelector('.camera-live');
        if (button) { startedLiveKeys.push(tile.dataset.key); button.click(); }
      }
    }
  }

  function stopWhatWeStarted() {
    for (const key of startedLiveKeys) {
      const tile = grid.querySelector(`.camera-tile[data-key="${CSS.escape(key)}"]`);
      // Only stop streams THIS mode started; the user's own live views stay.
      if (tile && (tile.dataset.live === 'on' || tile.dataset.live === 'connecting')) {
        const button = tile.querySelector('.camera-live');
        if (button) button.click();
      }
    }
    startedLiveKeys = [];
  }

  function enter(payload) {
    if (active) { renderRail(payload.alert, payload.headlines); return; }
    active = true;
    bannerLabel.textContent = payload.banner || 'DEFENSE MODE';
    renderRail(payload.alert, payload.headlines);
    wall.append(grid);
    document.body.classList.add('defense');
    board.hidden = false;
    // The stage is hidden while defense is up — pause the main orb (restore
    // its PRIOR value on exit: the Command Center skin keeps it paused on
    // purpose). The sentinel is created after unhide so it measures real px.
    mainOrbWasPaused = Boolean(window.jarvisHologram && window.jarvisHologram.paused);
    window.jarvisHologram?.setPaused?.(true);
    orbHost.create();
    hidePending();
    goLiveEverywhere();
    if (payload.read && typeof speak === 'function') speak(payload.read);
  }

  function exit() {
    if (!active) return;
    active = false;
    stopWhatWeStarted();
    orbHost.destroy();
    window.jarvisHologram?.setPaused?.(mainOrbWasPaused); // restore, never blanket-false
    gridHome.append(grid);
    board.hidden = true;
    document.body.classList.remove('defense');
  }

  function showPending(payload) {
    pendingReason.textContent = payload.reason && payload.reason.kind === 'camera'
      ? `MOTION AT ${String(payload.reason.cameraName || 'CAMERA').toUpperCase()} — ENTERING DEFENSE MODE`
      : `${String((payload.reason && payload.reason.event) || 'ALERT').toUpperCase()} — ENTERING DEFENSE MODE`;
    let remaining = payload.seconds || 15;
    pendingCount.textContent = String(remaining);
    pendingCard.hidden = false;
    clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
      remaining -= 1;
      pendingCount.textContent = String(Math.max(remaining, 0));
      if (remaining <= 0) clearInterval(countdownTimer);
    }, 1000);
    if (payload.spoken && typeof speak === 'function') speak(payload.spoken);
  }

  function hidePending() {
    clearInterval(countdownTimer);
    countdownTimer = null;
    pendingCard.hidden = true;
  }

  // Exit is always one key away — and the service is told, so every surface
  // (voice "stand down", the banner button, Esc) converges on defense:exit.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!pendingCard.hidden) { window.jarvis.defense.waveOff(); return; }
    if (active) window.jarvis.defense.exit();
  });
  document.getElementById('defense-exit').addEventListener('click', () => window.jarvis.defense.exit());
  document.getElementById('defense-wave-off').addEventListener('click', () => window.jarvis.defense.waveOff());
  document.getElementById('defense-button').addEventListener('click', async () => {
    const result = await window.jarvis.defense.enter();
    if (!result.ok && typeof showToast === 'function') showToast(result.message, 6000);
  });

  window.jarvis.onDefenseEnter((payload) => enter(payload || {}));
  window.jarvis.onDefenseExit(() => exit());
  window.jarvis.onDefensePending((payload) => showPending(payload || {}));
  window.jarvis.onDefensePendingCancelled(() => hidePending());
  window.jarvis.onDefenseUpdate((payload) => { if (active) renderRail(payload.alert, payload.headlines); });

  window.JarvisDefense = {
    enter,
    exit,
    isActive: () => active,
    setOrbState: (state) => orbHost.setState(state),
    setOrbAudioLevel: (level) => orbHost.setAudioLevel(level)
  };
})();
