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
      const response = await fetch(live.whepUrl, { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: peer.localDescription.sdp });
      if (!response.ok) throw new Error(`helper answered ${response.status}`);
      await peer.setRemoteDescription({ type: 'answer', sdp: await response.text() });
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

  async function render() {
    for (const key of [...livePeers.keys()]) stopLive(key);
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

  window.jarvis.onCamerasChanged(() => render());
  render();
})();
