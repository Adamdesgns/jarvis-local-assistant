// Cameras module: tile grid, snapshots, WHEP live view via the local go2rtc helper.
(() => {
  const grid = document.getElementById('camera-grid');
  const addForm = document.getElementById('camera-add-form');
  const addToggle = document.getElementById('camera-add-toggle');
  if (!grid || !addForm || !addToggle || !window.jarvis?.cameras) return;

  const nameInput = document.getElementById('camera-add-name');
  const urlInput = document.getElementById('camera-add-url');
  const addStatus = document.getElementById('camera-add-status');
  const livePeers = new Map(); // camera key -> RTCPeerConnection

  addToggle.addEventListener('click', () => { addForm.hidden = !addForm.hidden; });
  document.getElementById('camera-add-cancel').addEventListener('click', () => { addForm.hidden = true; });

  // Brand tabs: LOCAL (RTSP) | BLINK
  const panes = { rtsp: document.getElementById('camera-pane-rtsp'), blink: document.getElementById('camera-pane-blink'), ring: document.getElementById('camera-pane-ring') };
  document.querySelectorAll('[data-camera-brand]').forEach((tab) => tab.addEventListener('click', () => {
    document.querySelectorAll('[data-camera-brand]').forEach((other) => other.classList.toggle('active', other === tab));
    for (const [brand, pane] of Object.entries(panes)) pane.hidden = brand !== tab.dataset.cameraBrand;
    addStatus.textContent = '';
  }));

  // Blink sign-in with the emailed-PIN step.
  const blinkEmail = document.getElementById('blink-email');
  const blinkPassword = document.getElementById('blink-password');
  const blinkPinRow = document.getElementById('blink-pin-row');
  const blinkPin = document.getElementById('blink-pin');
  let pendingBlinkAccount = '';

  document.getElementById('blink-cancel').addEventListener('click', () => {
    addForm.hidden = true; blinkPassword.value = ''; blinkPinRow.hidden = true; pendingBlinkAccount = '';
  });

  document.getElementById('blink-signin').addEventListener('click', async () => {
    addStatus.textContent = 'Signing in to Blink…';
    const result = await window.jarvis.cameras.addBlink({ email: blinkEmail.value, password: blinkPassword.value });
    blinkPassword.value = '';
    if (!result.ok) { addStatus.textContent = result.message || 'Blink sign-in failed.'; return; }
    if (result.needsPin) {
      pendingBlinkAccount = result.accountId;
      blinkPinRow.hidden = false;
      addStatus.textContent = 'Blink emailed you a PIN. Type it here to finish.';
      blinkPin.focus();
      return;
    }
    addStatus.textContent = result.message || 'Blink is connected.';
    addForm.hidden = true;
    render();
  });

  document.getElementById('blink-verify').addEventListener('click', async () => {
    if (!pendingBlinkAccount) { addStatus.textContent = 'Sign in first, then enter the PIN.'; return; }
    addStatus.textContent = 'Checking the PIN…';
    const result = await window.jarvis.cameras.blinkPin(pendingBlinkAccount, blinkPin.value);
    addStatus.textContent = result.message || '';
    if (result.ok) {
      blinkPin.value = ''; blinkPinRow.hidden = true; pendingBlinkAccount = '';
      addForm.hidden = true;
      render();
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

  addForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    addStatus.textContent = 'Saving…';
    const result = await window.jarvis.cameras.addRtsp({
      name: nameInput.value || 'My cameras',
      cameras: [{ name: nameInput.value, url: urlInput.value }]
    });
    addStatus.textContent = result.message || '';
    if (result.ok) { nameInput.value = ''; urlInput.value = ''; addForm.hidden = true; render(); }
  });

  function tile(camera) {
    const article = document.createElement('div');
    article.className = 'camera-tile';
    article.dataset.key = camera.key;
    article.innerHTML = `
      <div class="camera-view"><img alt="" hidden><video muted autoplay playsinline hidden></video><span class="camera-view-empty">NO PICTURE YET</span></div>
      <div class="camera-tile-bar">
        <span class="camera-name"></span><b class="camera-brand"></b>
        <button class="camera-refresh" title="Take a fresh picture">↻</button>
        <button class="camera-live" title="Live view">▶ LIVE</button>
        <button class="camera-remove" title="Remove this camera's account">×</button>
      </div>
      <span class="camera-stamp"></span>`;
    article.querySelector('.camera-name').textContent = camera.name;
    article.querySelector('.camera-brand').textContent = camera.brand.toUpperCase();
    article.querySelector('img').alt = camera.name;
    article.querySelector('.camera-refresh').addEventListener('click', () => refresh(article, camera, true));
    article.querySelector('.camera-live').addEventListener('click', () => toggleLive(article, camera));
    article.querySelector('.camera-remove').addEventListener('click', async () => {
      await window.jarvis.cameras.removeAccount(camera.accountId);
      render();
    });
    return article;
  }

  async function refresh(article, camera, manual) {
    const shot = await window.jarvis.cameras.snapshot(camera.key, manual);
    const img = article.querySelector('img');
    const stamp = article.querySelector('.camera-stamp');
    if (shot.ok) {
      img.src = `data:image/jpeg;base64,${shot.jpegBase64}`;
      img.hidden = false;
      article.querySelector('.camera-view-empty').hidden = true;
      stamp.textContent = `PICTURE · ${new Date(shot.takenAt).toLocaleTimeString()}`;
    } else if (manual) {
      stamp.textContent = shot.message || 'Could not get a picture.';
    }
  }

  async function toggleLive(article, camera) {
    const video = article.querySelector('video');
    const img = article.querySelector('img');
    const button = article.querySelector('.camera-live');
    if (livePeers.has(camera.key)) { stopLive(camera.key, article); return; }
    button.textContent = '… CONNECTING';
    const live = await window.jarvis.cameras.liveStart(camera.key);
    if (!live.ok) { button.textContent = '▶ LIVE'; article.querySelector('.camera-stamp').textContent = live.message; return; }
    try {
      const peer = new RTCPeerConnection();
      livePeers.set(camera.key, peer);
      peer.addTransceiver('video', { direction: 'recvonly' });
      peer.addTransceiver('audio', { direction: 'recvonly' });
      peer.ontrack = (event) => { video.srcObject = event.streams[0]; };
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await new Promise((resolve) => {
        if (peer.iceGatheringState === 'complete') return resolve();
        peer.addEventListener('icegatheringstatechange', () => { if (peer.iceGatheringState === 'complete') resolve(); });
        setTimeout(resolve, 2000);
      });
      let answerSdp;
      if (live.mode === 'sdp-bridge') {
        const bridged = await window.jarvis.cameras.liveAnswer(camera.key, peer.localDescription.sdp);
        if (!bridged.ok) throw new Error(bridged.message || 'live view refused');
        answerSdp = bridged.answerSdp;
      } else {
        const response = await fetch(live.whepUrl, { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: peer.localDescription.sdp });
        if (!response.ok) throw new Error(`helper answered ${response.status}`);
        answerSdp = await response.text();
      }
      await peer.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      video.hidden = false; img.hidden = true;
      article.querySelector('.camera-view-empty').hidden = true;
      button.textContent = '■ STOP';
      article.querySelector('.camera-stamp').textContent = 'LIVE';
    } catch (error) {
      stopLive(camera.key, article);
      article.querySelector('.camera-stamp').textContent = `Live view failed: ${error.message}`;
    }
  }

  function stopLive(key, article) {
    const peer = livePeers.get(key);
    if (peer) { try { peer.close(); } catch {} livePeers.delete(key); }
    window.jarvis.cameras.liveStop(key);
    if (article) {
      const video = article.querySelector('video');
      video.srcObject = null; video.hidden = true;
      article.querySelector('.camera-live').textContent = '▶ LIVE';
      const img = article.querySelector('img');
      if (img.src) img.hidden = false;
      article.querySelector('.camera-stamp').textContent = '';
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
    addForm.hidden = true; ringPassword.value = ''; ringCodeRow.hidden = true; ringPending = null;
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
    addForm.hidden = true;
    render();
  }

  document.getElementById('ring-signin').addEventListener('click', () => ringSignIn(''));
  document.getElementById('ring-verify').addEventListener('click', () => ringSignIn(ringCode.value));

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

  async function render() {
    for (const key of [...livePeers.keys()]) stopLive(key);
    renderSystems();
    const cameras = await window.jarvis.cameras.list();
    grid.innerHTML = '';
    if (!cameras.length) {
      grid.innerHTML = '<p class="camera-empty">No cameras yet. Select ＋ ADD to connect one.</p>';
      return;
    }
    for (const camera of cameras) {
      const article = tile(camera);
      grid.appendChild(article);
      refresh(article, camera, false);
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
    article.querySelector('.camera-stamp').textContent = `⚠ ${alert.body}`;
  });

  window.jarvis.onCamerasChanged(() => render());
  render();
})();
