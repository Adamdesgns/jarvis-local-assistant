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
async function send(text, { spoken = false } = {}) {
  bubble('you', text);
  const status = document.getElementById('agent-status');
  status.hidden = false;
  status.textContent = 'Working…';
  try {
    const res = await fetch('/api/chat', { method: 'POST', headers: headers(), body: JSON.stringify({ text }) });
    if (res.status === 401) { localStorage.removeItem('jarvis-mobile-key'); status.hidden = true; return show('pairing'); }
    const out = await res.json();
    if (!res.ok || !out.reply) {
      status.hidden = true;
      bubble('jarvis', out.error || 'Something went wrong on the PC side — check the desktop.');
      return;
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
  es.addEventListener('agent-step', (e) => {
    const step = JSON.parse(e.data);
    const el = document.getElementById('agent-status');
    el.hidden = false; el.textContent = step.summary || `Step ${step.index}…`;
  });
  es.addEventListener('reply', (e) => renderReply(JSON.parse(e.data).reply, false));
  es.onerror = () => {};   // EventSource auto-reconnects
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
        const out = await res.json();
        if (!res.ok || out.error || !out.reply) {
          return renderReply(out.error || 'Something went wrong on the PC side — check the desktop.', true);
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
