const key = () => localStorage.getItem('jarvis-mobile-key');
const headers = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${key()}` });

function show(screen) {
  document.body.className = screen;
  for (const s of ['pairing', 'chat', 'offline']) document.getElementById(`screen-${s}`).hidden = s !== screen;
  if (screen === 'chat') document.body.classList.add('online');
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

async function boot() {
  if (location.hash.length > 1) { document.getElementById('pair-code').value = location.hash.slice(1); history.replaceState(null, '', '/'); }
  if (!key()) return show('pairing');
  try {
    const res = await fetch('/api/last', { headers: headers() });
    if (res.status === 401) { localStorage.removeItem('jarvis-mobile-key'); return show('pairing'); }
    const out = await res.json();
    show('chat');
    if (out.reply && out.reply !== lastRendered) { lastRendered = out.reply; bubble('jarvis', out.reply); }
    connectEvents();
  } catch { show('offline'); }
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
if ('speechSynthesis' in window) speechSynthesis.getVoices();   // prime the voice list (iOS loads it lazily)
boot();
