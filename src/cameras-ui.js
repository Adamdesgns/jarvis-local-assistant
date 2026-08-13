// Cameras module: tile grid, snapshots, WHEP live view via the local go2rtc helper.
(() => {
  const grid = document.getElementById('camera-grid');
  const addForm = document.getElementById('camera-add-form');
  const addToggle = document.getElementById('camera-add-toggle');
  if (!grid || !addForm || !addToggle || !window.jarvis?.cameras) return;

  const nameInput = document.getElementById('camera-add-name');
  const urlInput = document.getElementById('camera-add-url');
  const addStatus = document.getElementById('camera-add-status');
  const livePlayers = new Map(); // camera key -> LivePlayer handle

  // Linking a camera lives in Settings → CAMERAS, never in this module: the
  // module is only for watching. The ＋ ADD button opens that tab (wired in
  // renderer.js), and CLEAR empties the fields instead of hiding the panel.
  document.getElementById('camera-add-cancel').addEventListener('click', () => {
    nameInput.value = ''; urlInput.value = ''; addStatus.textContent = '';
  });

  // Brand tabs: LOCAL (RTSP) | BLINK
  const panes = { rtsp: document.getElementById('camera-pane-rtsp'), blink: document.getElementById('camera-pane-blink'), ring: document.getElementById('camera-pane-ring'), nest: document.getElementById('camera-pane-nest') };
  document.querySelectorAll('[data-camera-brand]').forEach((tab) => tab.addEventListener('click', () => {
    document.querySelectorAll('[data-camera-brand]').forEach((other) => other.classList.toggle('active', other === tab));
    for (const [brand, pane] of Object.entries(panes)) pane.hidden = brand !== tab.dataset.cameraBrand;
    addStatus.textContent = '';
  }));

  // Blink sign-in happens on Blink's own page in a separate window, so there is
  // nothing to type here and no PIN step — Blink handles its own 2FA.
  const blinkButton = document.getElementById('blink-signin');
  blinkButton.addEventListener('click', async () => {
    blinkButton.disabled = true;
    addStatus.textContent = 'Finish signing in on the Blink window that just opened…';
    try {
      const result = await window.jarvis.cameras.addBlink({});
      addStatus.textContent = result.message || (result.ok ? 'Blink is connected.' : 'Blink sign-in failed.');
      if (result.ok) render();
    } finally {
      blinkButton.disabled = false;
    }
  });

  document.getElementById('camera-scan').addEventListener('click', async () => {
    if (!window.jarvis.cameras.discover) { addStatus.textContent = 'Network scan is not available yet.'; return; }
    addStatus.textContent = 'Scanning your network for cameras (about 5 seconds)…';
    const found = await window.jarvis.cameras.discover();
    if (!found.length) { addStatus.textContent = 'No cameras answered. You can still type the rtsp:// address by hand.'; return; }
    addStatus.textContent = `Found ${found.length}: ${found.map((cam) => cam.address).join(', ')} — fill in the username and password to finish the address.`;
    urlInput.value = `rtsp://username:password@${found[0].address}:554/`;
    if (!nameInput.value) nameInput.value = found[0].name;
  });

  document.getElementById('camera-add-save').addEventListener('click', async () => {
    addStatus.textContent = 'Saving…';
    const result = await window.jarvis.cameras.addRtsp({
      name: nameInput.value || 'My cameras',
      cameras: [{ name: nameInput.value, url: urlInput.value }]
    });
    addStatus.textContent = result.message || '';
    if (result.ok) { nameInput.value = ''; urlInput.value = ''; render(); }
  });

  // One icon language: 1.6px stroke, currentColor, 24-box. No emoji.
  const ICON = {
    refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
    look: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/><path d="M11 8.4l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z" fill="currentColor" stroke="none"/>',
    more: '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
    play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
    stop: '<rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none"/>',
    spark: '<path d="M12 3l1.9 5.2 5.2 1.9-5.2 1.9L12 17.2l-1.9-5.2L4.9 10l5.2-1.9z"/>',
    popout: '<path d="M14 4h6v6"/><path d="M20 4l-8 8"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'
  };
  const svg = (paths, size = 15) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${paths}</svg>`;

  // Every message the tile shows lands in one band under the picture, with a
  // tone so a motion alert never looks like a calm description or an error.
  function say(article, text, tone = 'read') {
    const band = article.querySelector('.camera-read');
    const stamp = article.querySelector('.camera-stamp');
    stamp.textContent = text || '';
    band.dataset.tone = tone;
    band.hidden = !text;
  }

  function tile(camera, siblingCount) {
    const article = document.createElement('div');
    article.className = 'camera-tile';
    article.dataset.key = camera.key;
    article.innerHTML = `
      <div class="camera-view">
        <img alt="" hidden><video muted autoplay playsinline hidden></video>
        <span class="camera-view-empty">NO PICTURE YET</span>
        <div class="camera-top">
          <span class="camera-source"><i class="camera-dot"></i><b class="camera-brand"></b></span>
          <span class="camera-acts">
            <button class="camera-icon camera-refresh" title="Take a fresh picture" aria-label="Take a fresh picture">${svg(ICON.refresh)}</button>
            <button class="camera-icon camera-describe" title="Ask JARVIS what he sees" aria-label="Ask JARVIS what he sees">${svg(ICON.look)}</button>
            <button class="camera-icon camera-popout" title="Open in its own window" aria-label="Open this camera in its own window">${svg(ICON.popout)}</button>
            <button class="camera-icon camera-more" title="More" aria-label="More options" aria-expanded="false">${svg(ICON.more)}</button>
          </span>
        </div>
        <button class="camera-live" title="Watch live" aria-label="Watch live">
          <span class="camera-live-play">${svg(ICON.play, 20)}</span>
          <span class="camera-live-stop">${svg(ICON.stop, 18)}</span>
          <span class="camera-live-wait"></span>
        </button>
        <div class="camera-caption"><span class="camera-name"></span><span class="camera-time"></span></div>
        <div class="camera-menu" hidden><button class="camera-hide" type="button">Hide this camera</button><button class="camera-remove" type="button"></button></div>
      </div>
      <div class="camera-read" hidden>${svg(ICON.spark, 14)}<p class="camera-stamp"></p></div>`;
    article.querySelector('.camera-name').textContent = camera.name;
    article.querySelector('.camera-brand').textContent = camera.brand.toUpperCase();
    article.querySelector('img').alt = `Latest picture from ${camera.name}`;

    // Say out loud what removal really does — it drops the whole account.
    const remove = article.querySelector('.camera-remove');
    const removeLabel = siblingCount > 1
      ? `Disconnect ${camera.brand.toUpperCase()} — removes all ${siblingCount} cameras`
      : `Disconnect ${camera.brand.toUpperCase()} — removes this camera`;
    remove.textContent = removeLabel;

    if (camera.liveOnly) {
      // Nest: no snapshot API — the tile is live-view only.
      article.querySelector('.camera-refresh').hidden = true;
      article.querySelector('.camera-describe').hidden = true;
      article.querySelector('.camera-view-empty').textContent = 'LIVE VIEW ONLY';
    }

    article.querySelector('.camera-refresh').addEventListener('click', () => refresh(article, camera, true));
    article.querySelector('.camera-describe').addEventListener('click', async () => {
      article.dataset.thinking = 'on';
      say(article, 'Looking at the picture…', 'thinking');
      const described = await window.jarvis.cameras.describe(camera.key);
      article.dataset.thinking = '';
      if (described.ok && described.jpegBase64) {
        const img = article.querySelector('img');
        img.src = `data:image/jpeg;base64,${described.jpegBase64}`;
        img.hidden = false;
        article.querySelector('.camera-view-empty').hidden = true;
      }
      if (described.ok) say(article, described.text, 'read');
      else say(article, described.message || 'Could not describe the picture.', 'error');
    });
    article.querySelector('.camera-live').addEventListener('click', () => toggleLive(article, camera));

    // Popping out moves the stream, it does not duplicate it: a camera supports
    // exactly one live viewer (blink-stream-server answers 409 to a second
    // reader; Ring holds one session per camera), so the tile stops its own
    // player and says where the picture went.
    article.querySelector('.camera-popout').addEventListener('click', async () => {
      stopLive(camera.key, article);
      const result = await window.jarvis.cameras.popOut({ key: camera.key, name: camera.name, brand: camera.brand });
      if (!result?.ok) { say(article, result?.message || 'Could not open that window.', 'error'); return; }
      markPoppedOut(article, true);
    });


    // Hiding is the gentle sibling of removal: display-only, per camera, and
    // reversible from the SHOW ALL line under the grid. It exists so a stray or
    // duplicated tile can be dismissed without touching the account.
    article.querySelector('.camera-hide').addEventListener('click', async () => {
      stopLive(camera.key, article);
      await window.jarvis.cameras.hide(`${camera.brand}:${camera.id}`);
      render();
    });

    // The destructive action hides behind the ⋯ menu and asks twice.
    const menu = article.querySelector('.camera-menu');
    const more = article.querySelector('.camera-more');
    more.addEventListener('click', () => {
      const opening = menu.hidden;
      menu.hidden = !opening;
      more.setAttribute('aria-expanded', String(opening));
      remove.classList.remove('confirming');
      remove.textContent = removeLabel;
    });
    let removeTimer = null;
    remove.addEventListener('click', async () => {
      if (!remove.classList.contains('confirming')) {
        remove.classList.add('confirming');
        remove.textContent = 'Tap again to disconnect';
        // The armed state expires, same as arm/disarm — walking away must
        // never leave a one-click account deletion sitting there.
        removeTimer = setTimeout(() => {
          remove.classList.remove('confirming');
          remove.textContent = removeLabel;
          removeTimer = null;
        }, 5000);
        return;
      }
      if (removeTimer) { clearTimeout(removeTimer); removeTimer = null; }
      await window.jarvis.cameras.removeAccount(camera.accountId);
      render();
    });
    return article;
  }

  async function refresh(article, camera, manual) {
    if (manual) article.dataset.loading = 'on';
    const shot = await window.jarvis.cameras.snapshot(camera.key, manual);
    article.dataset.loading = '';
    const img = article.querySelector('img');
    if (shot.ok) {
      img.src = `data:image/jpeg;base64,${shot.jpegBase64}`;
      img.hidden = false;
      article.querySelector('.camera-view-empty').hidden = true;
      // The clock belongs on the picture; the band is for what JARVIS says.
      article.querySelector('.camera-time').textContent =
        new Date(shot.takenAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } else if (manual) {
      say(article, shot.message || 'Could not get a picture.', 'error');
    }
  }

  async function toggleLive(article, camera) {
    const video = article.querySelector('video');
    const img = article.querySelector('img');
    const button = article.querySelector('.camera-live');
    if (livePlayers.has(camera.key)) { stopLive(camera.key, article); return; }
    // State drives the icon now, so the label never has to be rewritten.
    article.dataset.live = 'connecting';
    button.setAttribute('aria-label', 'Connecting to the live view');
    const live = await window.jarvis.cameras.liveStart(camera.key);
    if (!live.ok) {
      article.dataset.live = '';
      button.setAttribute('aria-label', 'Watch live');
      say(article, live.message || 'Live view is not available.', 'error');
      return;
    }
    try {
      const handle = await window.LivePlayer.play({
        video,
        camera,
        live,
        // mpegts.js reports a mid-stream failure long after play() resolved.
        onError: (detail) => {
          stopLive(camera.key, article);
          say(article, `Live view stopped: ${detail}`, 'error');
        }
      });
      livePlayers.set(camera.key, handle);
      video.hidden = false; img.hidden = true;
      article.querySelector('.camera-view-empty').hidden = true;
      article.dataset.live = 'on';
      button.setAttribute('aria-label', 'Stop the live view');
      article.querySelector('.camera-time').textContent = 'LIVE';
    } catch (error) {
      stopLive(camera.key, article);
      say(article, `Live view failed: ${error.message}`, 'error');
    }
  }

  // While a camera is in its own window the tile is a signpost, not a player.
  function markPoppedOut(article, out) {
    if (!article) return;
    article.dataset.poppedOut = out ? 'yes' : '';
    const live = article.querySelector('.camera-live');
    live.disabled = Boolean(out);
    live.setAttribute('aria-label', out ? 'Playing in its own window' : 'Watch live');
    article.querySelector('.camera-popout').hidden = Boolean(out);
    const empty = article.querySelector('.camera-view-empty');
    if (out) {
      empty.hidden = false;
      empty.textContent = 'PLAYING IN ITS OWN WINDOW';
    } else if (empty.textContent === 'PLAYING IN ITS OWN WINDOW') {
      empty.textContent = 'NO PICTURE YET';
      empty.hidden = Boolean(article.querySelector('img').src);
    }
  }

  const tileFor = (key) => grid.querySelector(`.camera-tile[data-key="${key}"]`);

  // The window can close by itself (Alt+F4, taskbar), so the tile learns about
  // it from the main process rather than only from its own CLOSE button.
  window.jarvis.cameras.onWindowClosed?.((key) => markPoppedOut(tileFor(key), false));

  function stopLive(key, article) {
    const handle = livePlayers.get(key);
    if (handle) {
      livePlayers.delete(key);
      // The handle owns whichever transport was used and tears it down the way
      // that transport needs (closing the peer, or destroying the demuxer).
      try { handle.stop(); } catch { /* already gone */ }
    }
    window.jarvis.cameras.liveStop(key);
    if (article) {
      const video = article.querySelector('video');
      video.srcObject = null; video.removeAttribute('src'); video.hidden = true;
      article.dataset.live = '';
      article.querySelector('.camera-live').setAttribute('aria-label', 'Watch live');
      const img = article.querySelector('img');
      if (img.src) img.hidden = false;
      article.querySelector('.camera-time').textContent = '';
    }
  }

  // Ring sign-in: same shape as Blink, but the code round-trips the whole
  // login (Ring only issues the token when email+password+code go together).
  const ringEmail = document.getElementById('ring-email');
  const ringPassword = document.getElementById('ring-password');
  const ringCodeRow = document.getElementById('ring-code-row');
  const ringCode = document.getElementById('ring-code');
  let ringPending = null; // {email, password} kept until the code arrives

  document.getElementById('ring-cancel').addEventListener('click', () => {
    ringEmail.value = ''; ringPassword.value = ''; ringCodeRow.hidden = true; ringPending = null; addStatus.textContent = '';
  });

  async function ringSignIn(code) {
    addStatus.textContent = code ? 'Checking the code…' : 'Signing in to Ring…';
    const payload = ringPending || { email: ringEmail.value, password: ringPassword.value };
    const result = await window.jarvis.cameras.addRing({ ...payload, code });
    if (!result.ok) {
      addStatus.textContent = result.message || 'Ring sign-in failed.';
      ringPending = null; ringPassword.value = ''; ringCodeRow.hidden = true;
      return;
    }
    if (result.needs2fa) {
      ringPending = payload;
      ringCodeRow.hidden = false;
      addStatus.textContent = result.message || 'Enter the code Ring sent you.';
      ringCode.focus();
      return;
    }
    ringPending = null; ringPassword.value = ''; ringCode.value = ''; ringCodeRow.hidden = true;
    addStatus.textContent = result.message || 'Ring is connected.';
    render();
  }

  document.getElementById('ring-signin').addEventListener('click', () => ringSignIn(''));
  document.getElementById('ring-verify').addEventListener('click', () => ringSignIn(ringCode.value));

  // Nest advanced setup: three Google console values, then browser sign-in.
  document.getElementById('nest-console').addEventListener('click', () => window.jarvis.cameras.openNestConsole());
  document.getElementById('nest-cancel').addEventListener('click', () => {
    document.getElementById('nest-project').value = '';
    document.getElementById('nest-client-id').value = '';
    document.getElementById('nest-client-secret').value = '';
    addStatus.textContent = '';
  });
  document.getElementById('nest-signin').addEventListener('click', async () => {
    addStatus.textContent = 'Opening Google sign-in in your browser… approve JARVIS there, then come back.';
    const result = await window.jarvis.cameras.addNest({
      projectId: document.getElementById('nest-project').value,
      clientId: document.getElementById('nest-client-id').value,
      clientSecret: document.getElementById('nest-client-secret').value
    });
    addStatus.textContent = result.message || '';
    if (result.ok) {
      document.getElementById('nest-client-secret').value = '';
      render();
    }
  });

  // Systems strip: arm/disarm with an explicit two-step confirmation.
  const systemsStrip = document.getElementById('camera-systems');
  const armTimers = new Map();

  async function renderSystems() {
    const systems = await window.jarvis.cameras.systems();
    systemsStrip.innerHTML = '';
    for (const system of systems.filter((item) => item.canArm)) {
      const row = document.createElement('div');
      row.className = 'camera-system';
      row.innerHTML = '<span class="camera-system-name"></span><b class="camera-system-state"></b><button class="camera-arm"></button>';
      row.querySelector('.camera-system-name').textContent = system.name;
      const stateLabel = row.querySelector('.camera-system-state');
      stateLabel.textContent = system.armed ? 'ARMED' : 'DISARMED';
      stateLabel.classList.toggle('armed', system.armed);
      const button = row.querySelector('.camera-arm');
      button.textContent = system.armed ? 'DISARM' : 'ARM';
      button.addEventListener('click', async () => {
        // First click asks for confirmation; the action runs only on the
        // second click within 5 seconds. Sensitive actions never fire once.
        if (!armTimers.has(system.key)) {
          button.textContent = system.armed ? 'CONFIRM DISARM?' : 'CONFIRM ARM?';
          button.classList.add('confirming');
          armTimers.set(system.key, setTimeout(() => {
            armTimers.delete(system.key);
            button.textContent = system.armed ? 'DISARM' : 'ARM';
            button.classList.remove('confirming');
          }, 5000));
          return;
        }
        clearTimeout(armTimers.get(system.key));
        armTimers.delete(system.key);
        button.disabled = true;
        const result = await window.jarvis.cameras.setArmed(system.key, !system.armed);
        if (!result.ok) addStatus.textContent = result.message || '';
        renderSystems();
      });
      systemsStrip.appendChild(row);
    }
  }

  // Renders overlap: startup fires one and the driver's cameras:changed fires
  // another moments later. Every await below is a window where the older render
  // can interleave with the newer one and BOTH append their tiles — Adam saw
  // that as 8 tiles for 4 cameras. So each render takes a ticket, all slow
  // work happens before anything touches the DOM, and a render that has been
  // overtaken discards itself. The newest render is the only one that draws.
  let renderTicket = 0;
  async function render() {
    const ticket = ++renderTicket;
    renderSystems();
    const cameras = await window.jarvis.cameras.list();
    const poppedOutKeys = await window.jarvis.cameras.poppedOut?.() || [];
    const hiddenIds = await window.jarvis.cameras.hiddenList?.() || [];
    if (ticket !== renderTicket) return;
    for (const key of [...livePlayers.keys()]) stopLive(key);
    grid.innerHTML = '';
    if (!cameras.length) {
      grid.innerHTML = `
        <div class="camera-none">
          <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M3.5 7.5h12a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-12a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z"/><path d="M17.5 11l4-2.5v7l-4-2.5z"/></svg>
          <b>No cameras connected</b>
          <p>Ring, Blink, Nest and local cameras all link from Settings. Once one is on, its picture and JARVIS's read of it show up here.</p>
          <button type="button" class="camera-none-cta">CONNECT A CAMERA</button>
        </div>`;
      grid.querySelector('.camera-none-cta').addEventListener('click', () => addToggle.click());
      return;
    }
    // How many cameras ride on each account, so "disconnect" can say so.
    const perAccount = cameras.reduce((count, cam) => {
      count[cam.accountId] = (count[cam.accountId] || 0) + 1;
      return count;
    }, {});
    // Windows outlive a grid rebuild, so the popped-out set was asked for above
    // rather than assumed; from here down everything is synchronous on purpose.
    const poppedOut = new Set(poppedOutKeys);
    const hidden = new Set(hiddenIds);
    let hiddenCount = 0;
    for (const camera of cameras) {
      if (hidden.has(`${camera.brand}:${camera.id}`)) { hiddenCount += 1; continue; }
      const article = tile(camera, perAccount[camera.accountId]);
      grid.appendChild(article);
      if (poppedOut.has(camera.key)) { markPoppedOut(article, true); continue; }
      if (!camera.liveOnly) refresh(article, camera, false);
    }
    // Hidden cameras stay reachable: one quiet line, never a buried setting.
    if (hiddenCount > 0) {
      const note = document.createElement('div');
      note.className = 'camera-hidden-note';
      note.innerHTML = `<span>${hiddenCount} camera${hiddenCount === 1 ? '' : 's'} hidden</span> <button type="button" class="camera-show-all">SHOW ALL</button>`;
      note.querySelector('.camera-show-all').addEventListener('click', async () => {
        await window.jarvis.cameras.unhideAll();
        render();
      });
      grid.appendChild(note);
    }
  }

  // Alert badge: refresh the tile and stamp the alert text on it.
  window.jarvis.onCamerasAlert((alert) => {
    const article = grid.querySelector(`[data-key="${alert.key}"]`);
    if (!article) return;
    if (alert.jpegBase64) {
      const img = article.querySelector('img');
      img.src = `data:image/jpeg;base64,${alert.jpegBase64}`;
      img.hidden = false;
      article.querySelector('.camera-view-empty').hidden = true;
    }
    say(article, alert.body, 'alert');
  });

  window.jarvis.onCamerasChanged(() => render());
  render();
})();
