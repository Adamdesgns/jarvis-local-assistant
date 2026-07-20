const key = () => localStorage.getItem('jarvis-mobile-key');
const headers = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${key()}` });

// pairing/offline are full-screen takeovers (no tab bar); chat/cameras/send
// are tabbed screens reachable via the bottom tab bar.
const ALL_SCREENS = ['pairing', 'chat', 'cameras', 'send', 'offline'];
const TAB_SCREENS = ['chat', 'cameras', 'send'];
let lastTab = 'chat';   // which tab to return to after a takeover (offline) clears

function show(screen) {
  const isTabbed = TAB_SCREENS.includes(screen);
  if (isTabbed) lastTab = screen;

  document.body.className = screen;
  for (const s of ALL_SCREENS) document.getElementById(`screen-${s}`).hidden = s !== screen;
  if (isTabbed) document.body.classList.add('online');

  const tabBar = document.getElementById('tab-bar');
  tabBar.hidden = !isTabbed;
  for (const t of TAB_SCREENS) {
    const btn = document.getElementById(`tab-${t}`);
    const active = t === screen;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  }
}

function bubble(who, text) {
  const div = document.createElement('div');
  div.className = `msg ${who}`;
  div.textContent = text;
  const thread = document.getElementById('thread');
  thread.appendChild(div);
  thread.scrollTop = thread.scrollHeight;
}

// iOS loads the voice list asynchronously, so cache + refresh it on 'voiceschanged'
// rather than trusting a single getVoices() call to have the full list yet.
let cachedVoices = [];
function refreshVoices() { cachedVoices = speechSynthesis.getVoices(); }
if ('speechSynthesis' in window) {
  refreshVoices();
  speechSynthesis.addEventListener('voiceschanged', refreshVoices);
}

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  const utter = new SpeechSynthesisUtterance(text);
  const voices = cachedVoices.length ? cachedVoices : speechSynthesis.getVoices();
  utter.voice = voices.find((v) => /en-GB/i.test(v.lang) && /daniel|arthur/i.test(v.name))
    || voices.find((v) => /en-GB/i.test(v.lang)) || null;
  speechSynthesis.cancel();
  speechSynthesis.speak(utter);
}

let lastRendered = '';

// A non-401 failure (500, malformed body, whatever) must still end with a
// visible bubble — never a thread that just goes silent after the "Working…"
// strip clears. `spoken` lets a failed voice turn announce the failure too,
// same as a successful one would speak its reply.
function renderError(text, { spoken = false } = {}) {
  document.getElementById('agent-status').hidden = true;
  bubble('error', text);
  if (spoken) speak(text);
}

async function send(text, { spoken = false } = {}) {
  bubble('you', text);
  const status = document.getElementById('agent-status');
  status.hidden = false;
  status.textContent = 'Working…';
  try {
    const res = await fetch('/api/chat', { method: 'POST', headers: headers(), body: JSON.stringify({ text }) });
    if (res.status === 401) { localStorage.removeItem('jarvis-mobile-key'); status.hidden = true; return show('pairing'); }
    // .catch() here matters: a 500 with a non-JSON (or empty) body must still
    // fall into the !res.ok branch below and render an error bubble, not throw
    // and get mistaken for a network failure that drops to the offline screen.
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out.reply) {
      return renderError(out.error || 'JARVIS hit a snag — try that again.');
    }
    renderReply(out.reply, spoken);
  } catch { document.getElementById('agent-status').hidden = true; show('offline'); }
}

function renderReply(reply, spoken) {
  document.getElementById('agent-status').hidden = true;
  if (!reply) return;
  // A duplicate reply (e.g. the SSE copy arriving before the POST response)
  // should only suppress the redundant chat bubble — never the speech, or a
  // spoken:true reply that lands after its SSE twin would go silent.
  const isDup = reply === lastRendered;
  if (!isDup) {
    lastRendered = reply;
    bubble('jarvis', reply);
  }
  if (spoken) speak(reply);
}

function connectEvents() {
  const es = new EventSource(`/api/events?key=${encodeURIComponent(key())}`);
  // EventSource can't expose the HTTP status of a failed connection, so a
  // revoked device key 401ing the stream looks identical to a transient wifi
  // blip — both just fire onerror and auto-retry forever. A single onerror is
  // normal (routers hiccup); only once a SECOND consecutive onerror lands with
  // no onopen in between do we spend one authed probe request to tell the two
  // apart, so a real reconnect never gets mistaken for a revoked key.
  let consecutiveErrors = 0;
  let probing = false;
  es.addEventListener('agent-step', (e) => {
    const step = JSON.parse(e.data);
    const el = document.getElementById('agent-status');
    el.hidden = false; el.textContent = step.summary || `Step ${step.index}…`;
  });
  es.addEventListener('reply', (e) => renderReply(JSON.parse(e.data).reply, false));
  es.addEventListener('camera-alert', (e) => {
    cameraAlert = JSON.parse(e.data);
    if (document.body.classList.contains('cameras')) renderCameraAlertBanner();
    else tabCamerasBadge.hidden = false;
  });
  es.onopen = () => { consecutiveErrors = 0; };
  es.onerror = () => {
    consecutiveErrors++;
    if (consecutiveErrors < 2 || probing) return;
    consecutiveErrors = 0;   // next probe needs its own fresh pair of errors
    probing = true;
    fetch('/api/last', { headers: headers() })
      .then((res) => {
        if (res.status !== 401) return;   // still authed — a real transient blip
        localStorage.removeItem('jarvis-mobile-key');
        es.close();
        show('pairing');
      })
      .catch(() => {})   // network error is inconclusive — let EventSource keep retrying
      .finally(() => { probing = false; });
  };
}

// --- mic: press and hold ---
let recorder = null, chunks = [];
const micBtn = document.getElementById('mic-btn');

function stopRecording() {
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  micBtn.classList.remove('recording');
}

micBtn.addEventListener('pointerdown', async (e) => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (ev) => chunks.push(ev.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/mp4' });
      if (blob.size < 1000) return;   // accidental tap
      const status = document.getElementById('agent-status');
      status.hidden = false;
      status.textContent = 'Listening back…';
      try {
        const res = await fetch('/api/voice', { method: 'POST', headers: { 'Content-Type': blob.type, Authorization: `Bearer ${key()}` }, body: blob });
        if (res.status === 401) { localStorage.removeItem('jarvis-mobile-key'); status.hidden = true; return show('pairing'); }
        const out = await res.json().catch(() => ({}));
        if (!res.ok || out.error || !out.reply) {
          return renderError(out.error || 'JARVIS hit a snag — try that again.', { spoken: true });
        }
        bubble('you', out.transcript);
        renderReply(out.reply, true);
      } catch { document.getElementById('agent-status').hidden = true; show('offline'); }
    };
    recorder.start();
    micBtn.classList.add('recording');
    // Capture the pointer so pointerup/cancel still fire on this button even if
    // the finger slides off it before release — a common press-and-hold gotcha.
    micBtn.setPointerCapture?.(e.pointerId);
  } catch { alert('Microphone is blocked. Allow it in iOS Settings → Safari → Microphone.'); }
});
micBtn.addEventListener('pointerup', stopRecording);
micBtn.addEventListener('pointercancel', stopRecording);
micBtn.addEventListener('pointerleave', stopRecording);

// --- composer ---
document.getElementById('send-btn').addEventListener('click', () => {
  const box = document.getElementById('composer');
  const text = box.value.trim();
  if (!text) return;
  box.value = '';
  send(text);
});

// --- pairing ---
document.getElementById('pair-btn').addEventListener('click', async () => {
  const code = document.getElementById('pair-code').value.trim();
  try {
    const res = await fetch('/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, name: navigator.platform || 'Phone' }) });
    const out = await res.json();
    if (!res.ok) { const err = document.getElementById('pair-error'); err.hidden = false; err.textContent = out.error; return; }
    localStorage.setItem('jarvis-mobile-key', out.key);
    boot();
  } catch { show('offline'); }
});

document.getElementById('retry-btn').addEventListener('click', boot);

// --- tab bar ---
for (const btn of document.querySelectorAll('.tab-item')) {
  btn.addEventListener('click', () => {
    const screen = btn.dataset.screen;
    show(screen);
    if (screen === 'send') loadFolders();
    if (screen === 'cameras') {
      tabCamerasBadge.hidden = true;
      loadCameras();
      renderCameraAlertBanner();   // surface an alert that arrived while another tab was open
    }
  });
}

// --- send ---
let sendFolders = null;   // cached after first successful /api/folders fetch
let sendFiles = [];       // File[] currently picked, cleared after each batch
let sendUploading = false;

const sendFileInput = document.getElementById('send-file-input');
const sendFileSummary = document.getElementById('send-file-summary');
const sendDestination = document.getElementById('send-destination');
const sendDestError = document.getElementById('send-dest-error');
const sendUploadBtn = document.getElementById('send-upload-btn');
const sendQueue = document.getElementById('send-queue');
const sendSummary = document.getElementById('send-summary');

function updateSendUploadEnabled() {
  sendUploadBtn.disabled = sendUploading || sendFiles.length === 0 || sendDestination.options.length === 0;
}

function updateSendFileSummary() {
  if (!sendFiles.length) sendFileSummary.textContent = 'No files selected.';
  else if (sendFiles.length === 1) sendFileSummary.textContent = sendFiles[0].name;
  else sendFileSummary.textContent = `${sendFiles.length} files selected.`;
  updateSendUploadEnabled();
}

function renderDestinations(folders) {
  const remembered = localStorage.getItem('jarvis-mobile-dest');
  sendDestination.innerHTML = '';
  for (const folder of folders) {
    const opt = document.createElement('option');
    opt.value = folder;
    opt.textContent = folder;
    sendDestination.appendChild(opt);
  }
  if (remembered && folders.includes(remembered)) sendDestination.value = remembered;
  updateSendUploadEnabled();
}

async function loadFolders() {
  if (sendFolders) return;   // "loaded when the Send tab is first opened" — fetch once
  sendDestError.hidden = true;
  try {
    const res = await fetch('/api/folders', { headers: headers() });
    if (res.status === 401) { localStorage.removeItem('jarvis-mobile-key'); return show('pairing'); }
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      sendDestError.hidden = false;
      sendDestError.textContent = out.error || 'Could not load destination folders.';
      return;
    }
    sendFolders = out.folders || [];
    renderDestinations(sendFolders);
  } catch { show('offline'); }
}

sendFileInput.addEventListener('change', () => {
  sendFiles = Array.from(sendFileInput.files || []);
  sendQueue.innerHTML = '';
  sendSummary.hidden = true;
  updateSendFileSummary();
});

sendUploadBtn.addEventListener('click', async () => {
  if (sendUploading || !sendFiles.length) return;
  sendUploading = true;
  sendUploadBtn.disabled = true;
  sendSummary.hidden = true;
  const destination = sendDestination.value;
  localStorage.setItem('jarvis-mobile-dest', destination);

  sendQueue.innerHTML = '';
  const rows = sendFiles.map((file) => {
    const row = document.createElement('div');
    row.className = 'send-row';
    row.dataset.state = 'queued';
    const name = document.createElement('span');
    name.className = 'send-row-name';
    name.textContent = file.name;
    const state = document.createElement('span');
    state.className = 'send-row-state';
    state.textContent = 'Queued';
    row.append(name, state);
    sendQueue.appendChild(row);
    return { row, state, file };
  });

  let succeeded = 0;
  let attempted = 0;
  for (const { row, state, file } of rows) {
    attempted++;
    row.dataset.state = 'uploading';
    state.textContent = 'Uploading…';
    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-Filename': file.name,
          'X-Destination': destination,
          Authorization: `Bearer ${key()}`
        },
        body: file
      });
      if (res.status === 401) {
        localStorage.removeItem('jarvis-mobile-key');
        row.dataset.state = 'failed';
        state.textContent = 'Session expired.';
        sendUploading = false;
        return show('pairing');
      }
      if (res.status === 413) {
        row.dataset.state = 'failed';
        state.textContent = 'Too large — 25 MB upload limit.';
        continue;
      }
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) {
        row.dataset.state = 'failed';
        state.textContent = out.error || 'Upload failed.';
        continue;
      }
      row.dataset.state = 'done';
      const savedName = out.path ? out.path.split(/[\\/]/).pop() : file.name;
      state.textContent = `Saved as ${savedName}`;
      succeeded++;
    } catch {
      // A network failure means the next request will fail too — stop the
      // batch and drop to the offline screen, same as chat/voice/pairing do.
      row.dataset.state = 'failed';
      state.textContent = 'Network error.';
      sendUploading = false;
      show('offline');
      return;
    }
  }

  sendUploading = false;
  sendSummary.hidden = false;
  sendSummary.textContent = `${succeeded} of ${attempted} sent`;
  sendFiles = [];
  sendFileInput.value = '';
  updateSendFileSummary();
});

// --- cameras ---
let camerasList = null;      // cached camera list after first successful load (retry on failure)
let cameraAlert = null;      // most recent unread camera-alert event, or null
let activeCameraKey = null;  // which camera's detail is currently open, if any
let cameraShotUrl = null;    // object URL for the still on screen — revoke before replacing
let cameraShotLoading = false;
let cameraShotToken = 0;     // bumped on every fetch/nav so a stale response can't overwrite a newer one

const camerasListView = document.getElementById('cameras-list-view');
const camerasDetailView = document.getElementById('cameras-detail-view');
const camerasStatus = document.getElementById('cameras-status');
const camerasListEl = document.getElementById('cameras-list');
const camerasAlertBanner = document.getElementById('cameras-alert-banner');
const camerasDetailName = document.getElementById('cameras-detail-name');
const camerasShotImg = document.getElementById('cameras-shot-img');
const camerasShotLoadingEl = document.getElementById('cameras-shot-loading');
const camerasShotError = document.getElementById('cameras-shot-error');
const camerasShotTime = document.getElementById('cameras-shot-time');
const camerasRefreshBtn = document.getElementById('cameras-refresh-btn');
const tabCamerasBadge = document.getElementById('tab-cameras-badge');

function formatClockTime(at) {
  return new Date(at || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function renderCameraAlertBanner() {
  if (!cameraAlert) { camerasAlertBanner.hidden = true; camerasAlertBanner.textContent = ''; return; }
  camerasAlertBanner.hidden = false;
  camerasAlertBanner.textContent = `🔔 ${cameraAlert.name} — ${cameraAlert.kind}, ${formatClockTime(cameraAlert.at)}`;
}

function renderCamerasList() {
  camerasListEl.innerHTML = '';
  if (!camerasList) return;
  for (const camera of camerasList) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'card cameras-row';
    row.dataset.key = camera.key;
    const name = document.createElement('span');
    name.className = 'cameras-row-name';
    name.textContent = camera.name;
    const chevron = document.createElement('span');
    chevron.className = 'cameras-row-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '›';
    row.append(name, chevron);
    row.addEventListener('click', () => openCameraDetail(camera.key, camera.name));
    camerasListEl.appendChild(row);
  }
}

async function loadCameras() {
  if (camerasList) return;   // "loaded when the Cameras tab is first opened" — fetch once per successful load
  camerasStatus.hidden = false;
  camerasStatus.textContent = 'Loading cameras…';
  camerasListEl.innerHTML = '';
  try {
    const res = await fetch('/api/cameras', { headers: headers() });
    if (res.status === 401) { localStorage.removeItem('jarvis-mobile-key'); return show('pairing'); }
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      camerasStatus.textContent = out.error || 'Could not load cameras.';
      return;
    }
    camerasList = out.cameras || [];
    camerasStatus.textContent = camerasList.length ? '' : 'No cameras set up yet — add them in JARVIS on the PC.';
    camerasStatus.hidden = camerasList.length > 0;
    renderCamerasList();
  } catch { show('offline'); }
}

function revokeCameraShot() {
  if (cameraShotUrl) { URL.revokeObjectURL(cameraShotUrl); cameraShotUrl = null; }
}

function showCamerasList() {
  activeCameraKey = null;
  camerasDetailView.hidden = true;
  camerasListView.hidden = false;
  cameraShotToken++;         // invalidate any in-flight fetch for the camera we're leaving
  cameraShotLoading = false;
  camerasRefreshBtn.disabled = false;
  revokeCameraShot();
}

function openCameraDetail(cameraKey, cameraName) {
  if (cameraAlert && cameraAlert.key === cameraKey) { cameraAlert = null; renderCameraAlertBanner(); }
  activeCameraKey = cameraKey;
  camerasDetailName.textContent = cameraName;
  camerasListView.hidden = true;
  camerasDetailView.hidden = false;
  fetchCameraSnapshot(cameraKey);
}

async function fetchCameraSnapshot(cameraKey) {
  const token = ++cameraShotToken;
  cameraShotLoading = true;
  camerasRefreshBtn.disabled = true;
  camerasShotError.hidden = true;
  camerasShotImg.hidden = true;
  camerasShotTime.hidden = true;
  camerasShotLoadingEl.hidden = false;
  try {
    const res = await fetch(`/api/cameras/snapshot?key=${encodeURIComponent(cameraKey)}`, { headers: headers() });
    if (token !== cameraShotToken) return;   // a newer request (or a back-nav) superseded this one
    if (res.status === 401) { localStorage.removeItem('jarvis-mobile-key'); return show('pairing'); }
    if (!res.ok) {
      const out = await res.json().catch(() => ({}));
      camerasShotLoadingEl.hidden = true;
      camerasShotError.hidden = false;
      camerasShotError.textContent = out.error || 'Could not get a picture.';
      return;
    }
    const blob = await res.blob();
    if (token !== cameraShotToken) return;
    revokeCameraShot();
    cameraShotUrl = URL.createObjectURL(blob);
    camerasShotImg.src = cameraShotUrl;
    camerasShotImg.hidden = false;
    camerasShotLoadingEl.hidden = true;
    camerasShotTime.hidden = false;
    camerasShotTime.textContent = `Taken ${formatClockTime()}`;
  } catch {
    if (token !== cameraShotToken) return;
    camerasShotLoadingEl.hidden = true;
    camerasShotError.hidden = false;
    camerasShotError.textContent = 'Network error — check the connection and try again.';
  } finally {
    if (token === cameraShotToken) { cameraShotLoading = false; camerasRefreshBtn.disabled = false; }
  }
}

document.getElementById('cameras-back-btn').addEventListener('click', showCamerasList);

camerasRefreshBtn.addEventListener('click', () => {
  if (cameraShotLoading || !activeCameraKey) return;   // battery cameras rate-limit — no hammering
  fetchCameraSnapshot(activeCameraKey);
});

camerasAlertBanner.addEventListener('click', () => {
  if (!cameraAlert) return;
  const known = camerasList && camerasList.find((c) => c.key === cameraAlert.key);
  openCameraDetail(cameraAlert.key, known ? known.name : cameraAlert.name);
});

async function boot() {
  if (location.hash.length > 1) { document.getElementById('pair-code').value = location.hash.slice(1); history.replaceState(null, '', '/'); }
  if (!key()) return show('pairing');
  try {
    const res = await fetch('/api/last', { headers: headers() });
    if (res.status === 401) { localStorage.removeItem('jarvis-mobile-key'); return show('pairing'); }
    const out = await res.json();
    show(lastTab);
    if (out.reply && out.reply !== lastRendered) { lastRendered = out.reply; bubble('jarvis', out.reply); }
    connectEvents();
  } catch { show('offline'); }
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
if ('speechSynthesis' in window) speechSynthesis.getVoices();   // prime the voice list (iOS loads it lazily)
boot();
