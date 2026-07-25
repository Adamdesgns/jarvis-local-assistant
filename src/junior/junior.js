/* JARVIS JUNIOR — the children's window.

   Talks to the same main process as the grown-up build over the same preload
   bridge; the difference is that the junior build's router answers, so the
   only things that can come back are the ones a child can have.

   The timer and the routines run their clocks here rather than in the main
   process: a countdown a child is watching must keep ticking whether or not
   the brain is busy thinking about a story. */

const api = window.jarvis;

const el = (id) => document.getElementById(id);
const state = {
  settings: {},
  chart: { chores: [], summary: { stars: 0, streak: 0 } },
  mood: 'ready',
  busy: false,
  streaming: false,
  timer: null,
  routine: null,
  pin: ''
};

/* ---------------------------------------------------------------- speech */

let cachedVoices = [];
function refreshVoices() {
  cachedVoices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
  renderVoiceOptions();
}
if ('speechSynthesis' in window) {
  refreshVoices();
  speechSynthesis.addEventListener('voiceschanged', refreshVoices);
}

function pickVoice() {
  const voices = cachedVoices.length ? cachedVoices : (window.speechSynthesis ? speechSynthesis.getVoices() : []);
  const wanted = state.settings.kidVoiceName;
  return voices.find((voice) => voice.name === wanted)
    || voices.find((voice) => /en-GB/i.test(voice.lang))
    || voices.find((voice) => /^en/i.test(voice.lang))
    || null;
}

function speak(text) {
  if (!('speechSynthesis' in window) || !text) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = pickVoice();
  // A shade slower than the grown-up build: children follow speech better
  // when it is not rushed, and the youngest need it slower still.
  utterance.rate = Number(state.settings.kidAge) <= 7 ? 0.88 : 0.95;
  utterance.pitch = 1.05;
  speechSynthesis.cancel();
  setMood('speaking');
  utterance.onend = () => setMood('ready');
  utterance.onerror = () => setMood('ready');
  speechSynthesis.speak(utterance);
}

function hush() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

/* ------------------------------------------------------------------- orb */

const canvas = el('orb');
const ctx = canvas.getContext('2d');
const MOOD_COLOURS = {
  ready: ['#ffc65c', '#ff9d3d'],
  listening: ['#ff8fb8', '#ff5f92'],
  thinking: ['#6fc9ff', '#8b7bff'],
  speaking: ['#63e6c3', '#3fb9ff']
};

function sizeOrb() {
  const ratio = window.devicePixelRatio || 1;
  const size = canvas.clientWidth || 260;
  canvas.width = size * ratio;
  canvas.height = size * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

let frame = 0;
function drawOrb() {
  const size = canvas.clientWidth || 260;
  const middle = size / 2;
  const [inner, outer] = MOOD_COLOURS[state.mood] || MOOD_COLOURS.ready;
  const beat = state.mood === 'listening' ? 0.09 : state.mood === 'thinking' ? 0.05 : 0.035;
  const speed = state.mood === 'thinking' ? 0.06 : 0.028;
  const pulse = 1 + Math.sin(frame * speed) * beat;
  const radius = (size * 0.34) * pulse;

  ctx.clearRect(0, 0, size, size);

  // Soft halo.
  const halo = ctx.createRadialGradient(middle, middle, radius * 0.6, middle, middle, size * 0.5);
  halo.addColorStop(0, `${outer}55`);
  halo.addColorStop(1, 'transparent');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(middle, middle, size * 0.5, 0, Math.PI * 2);
  ctx.fill();

  // The body: a blob that wobbles, so it reads as friendly rather than
  // machine-perfect. Three overlapping sine terms is enough to look alive.
  ctx.beginPath();
  for (let angle = 0; angle <= Math.PI * 2 + 0.01; angle += 0.06) {
    const wobble = 1
      + Math.sin(angle * 3 + frame * 0.035) * 0.035
      + Math.sin(angle * 5 - frame * 0.022) * 0.022;
    const r = radius * wobble;
    const x = middle + Math.cos(angle) * r;
    const y = middle + Math.sin(angle) * r;
    if (angle === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  const body = ctx.createRadialGradient(middle - radius * 0.3, middle - radius * 0.35, radius * 0.1, middle, middle, radius);
  body.addColorStop(0, '#ffffff');
  body.addColorStop(0.35, inner);
  body.addColorStop(1, outer);
  ctx.fillStyle = body;
  ctx.fill();

  // Two eyes, because a face is what makes it a friend and not a lamp. They
  // blink on a slow, uneven cycle and squeeze shut while it is thinking.
  const eyeGap = radius * 0.34;
  const eyeY = middle - radius * 0.06;
  const blink = (frame % 260) < 8 ? 0.12 : 1;
  const squint = state.mood === 'thinking' ? 0.45 : 1;
  const eyeHeight = radius * 0.19 * blink * squint;
  ctx.fillStyle = 'rgba(30, 16, 62, 0.82)';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(middle + side * eyeGap, eyeY, radius * 0.085, Math.max(1, eyeHeight), 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // A smile that widens when it is speaking.
  const smile = state.mood === 'speaking' ? 0.42 : 0.3;
  ctx.strokeStyle = 'rgba(30, 16, 62, 0.7)';
  ctx.lineWidth = Math.max(2, radius * 0.05);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(middle, middle + radius * 0.06, radius * smile, 0.25 * Math.PI, 0.75 * Math.PI);
  ctx.stroke();

  frame += 1;
  requestAnimationFrame(drawOrb);
}

function setMood(mood) {
  state.mood = mood;
  el('app').dataset.state = mood;
}

/* --------------------------------------------------------------- answers */

function showAnswer(text, kind = '') {
  const box = el('answer');
  box.textContent = text || '';
  box.className = `answer${kind ? ` ${kind}` : ''}${String(text || '').length > 260 ? ' long' : ''}`;
  box.scrollTop = 0;
}

function setHint(text) {
  el('listen-hint').textContent = text;
}

/* -------------------------------------------------------------- commands */

async function say(text, { spoken = true } = {}) {
  const words = String(text || '').trim();
  if (!words || state.busy) return;
  hush();
  state.busy = true;
  state.streaming = false;
  setMood('thinking');
  setHint('Thinking…');
  showAnswer('');
  el('stop-button').hidden = false;

  try {
    const result = await api.submitCommand(words, 'junior');
    handleResult(result, spoken);
  } catch (error) {
    showAnswer('Something went wrong on the computer. Try again, or ask a grown-up.', 'safety');
    setMood('ready');
  } finally {
    state.busy = false;
    state.streaming = false;
    el('stop-button').hidden = true;
    if (state.mood === 'thinking') setMood('ready');
    setHint('Hold the button and talk to me');
  }
}

function handleResult(result, spoken) {
  if (!result) return;
  const source = result.source || '';

  if (source === 'kid-timer' && result.timer) {
    showAnswer(result.response);
    if (spoken) speak(result.response);
    startTimer(result.timer.seconds, result.timer.label);
    return;
  }

  if (source === 'kid-routine' && result.routine) {
    showAnswer(result.response);
    startRoutine(result.routine, spoken);
    return;
  }

  showAnswer(result.response, source === 'kid-safety' ? 'safety' : '');
  if (spoken) speak(result.response);

  if (result.starChart || result.chores) refreshChart({ celebrate: Boolean(result.celebrate) });
}

/* ---------------------------------------------------------------- timers */

const RING_LENGTH = 553;

function paintTimer(remaining, total, label, step) {
  el('timer-overlay').hidden = false;
  el('timer-title').textContent = label || 'Timer';
  const minutes = Math.floor(remaining / 60);
  const seconds = Math.floor(remaining % 60);
  el('timer-remaining').textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
  el('ring-progress').style.strokeDashoffset = String(RING_LENGTH * (1 - (total ? remaining / total : 0)));
  el('timer-step').textContent = step || '';
}

function clearTimerLoop() {
  if (state.timer && state.timer.handle) clearInterval(state.timer.handle);
  state.timer = null;
}

function stopTimer() {
  clearTimerLoop();
  state.routine = null;
  el('timer-overlay').hidden = true;
  document.querySelector('.timer-sheet').classList.remove('ringing');
  el('timer-skip').hidden = true;
}

function startTimer(seconds, label, onFinish) {
  clearTimerLoop();
  document.querySelector('.timer-sheet').classList.remove('ringing');
  const total = Math.max(1, Number(seconds) || 0);
  const endsAt = Date.now() + total * 1000;
  paintTimer(total, total, label, state.routine ? state.routine.steps[state.routine.index].text : '');
  const tick = () => {
    const remaining = Math.max(0, (endsAt - Date.now()) / 1000);
    paintTimer(remaining, total, label, state.routine ? state.routine.steps[state.routine.index].text : '');
    if (remaining > 0) return;
    clearTimerLoop();
    if (onFinish) return onFinish();
    document.querySelector('.timer-sheet').classList.add('ringing');
    speak('Time is up.');
  };
  state.timer = { handle: setInterval(tick, 250), total, label };
}

/* -------------------------------------------------------------- routines */

function startRoutine(routine, spoken = true) {
  state.routine = { ...routine, index: 0 };
  el('timer-skip').hidden = false;
  if (spoken) speak(routine.intro);
  runRoutineStep();
}

function runRoutineStep() {
  const routine = state.routine;
  if (!routine) return;
  const step = routine.steps[routine.index];
  if (!step) {
    const finish = routine.finish;
    stopTimer();
    showAnswer(finish);
    speak(finish);
    return;
  }
  speak(step.text);
  startTimer(step.seconds, routine.title, () => {
    if (!state.routine) return;
    state.routine.index += 1;
    runRoutineStep();
  });
}

function skipRoutineStep() {
  if (!state.routine) return;
  clearTimerLoop();
  state.routine.index += 1;
  runRoutineStep();
}

/* ----------------------------------------------------------- star chart */

async function refreshChart({ celebrate = false } = {}) {
  try {
    state.chart = await api.kid.chart();
  } catch { return; }
  const summary = state.chart.summary || { stars: 0, streak: 0 };
  el('star-count').textContent = summary.stars;
  const streak = el('streak-badge');
  streak.hidden = !(summary.streak > 1);
  el('streak-count').textContent = summary.streak;
  if (celebrate) {
    const badge = el('star-badge');
    badge.classList.remove('pop');
    void badge.offsetWidth;
    badge.classList.add('pop');
  }
  renderJobs();
  renderParentJobs();
}

function renderJobs() {
  const list = el('jobs-list');
  const due = (state.chart.chores || []).filter((chore) => chore.dueToday);
  list.replaceChildren();
  el('jobs-empty').hidden = due.length > 0;
  for (const chore of due) {
    const row = document.createElement('button');
    row.className = `job${chore.doneToday ? ' done' : ''}`;
    row.type = 'button';

    const tick = document.createElement('span');
    tick.className = 'tick';
    tick.textContent = '✓';

    const name = document.createElement('span');
    name.className = 'job-name';
    name.textContent = chore.title;

    const stars = document.createElement('span');
    stars.className = 'job-stars';
    stars.textContent = `${chore.stars} ★`;

    row.append(tick, name, stars);
    row.addEventListener('click', () => toggleJob(chore));
    list.append(row);
  }
}

async function toggleJob(chore) {
  const outcome = chore.doneToday
    ? await api.kid.undoJob(chore.id)
    : await api.kid.markJob(chore.id);
  await refreshChart({ celebrate: !chore.doneToday });
  if (!chore.doneToday && outcome && outcome.ok !== false) {
    const summary = state.chart.summary || {};
    speak(summary.allDone
      ? `${chore.title}, done. That is every job finished today. Brilliant.`
      : `${chore.title}, done. ${chore.stars} star${chore.stars === 1 ? '' : 's'} for you.`);
  }
}

/* -------------------------------------------------------------- the mic */

let recorder = null;
let recordingStream = null;

async function startRecording() {
  if (state.busy || recorder) return;
  hush();
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch {
    showAnswer('I cannot hear the microphone. Ask a grown-up to switch it on.', 'safety');
    return;
  }
  const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  const mimeType = preferred.find((type) => MediaRecorder.isTypeSupported(type)) || '';
  recorder = new MediaRecorder(recordingStream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  recorder.onstop = async () => {
    recordingStream.getTracks().forEach((track) => track.stop());
    recordingStream = null;
    const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
    recorder = null;
    el('talk-button').classList.remove('recording');
    if (blob.size < 900) { setMood('ready'); setHint('Hold the button and talk to me'); return; }
    setMood('thinking');
    setHint('Listening back…');
    try {
      const transcript = await api.transcribe(new Uint8Array(await blob.arrayBuffer()), blob.type);
      if (!transcript) {
        setMood('ready');
        setHint('Hold the button and talk to me');
        showAnswer('I did not catch that. Have another go.');
        return;
      }
      say(transcript);
    } catch {
      setMood('ready');
      setHint('Hold the button and talk to me');
      showAnswer('My ears are not working. Ask a grown-up to check the voice setup.', 'safety');
    }
  };
  recorder.start();
  el('talk-button').classList.add('recording');
  setMood('listening');
  setHint('I am listening…');
}

function stopRecording() {
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  else el('talk-button').classList.remove('recording');
}

/* ------------------------------------------------------- the grown-up gate */

function renderPin() {
  const display = el('pin-display');
  display.replaceChildren();
  for (let index = 0; index < state.pin.length; index += 1) display.append(document.createElement('i'));
}

function openGate() {
  state.pin = '';
  renderPin();
  el('gate-error').hidden = true;
  api.parent.status().then((status) => {
    // With no PIN set yet, the panel opens straight away and nags about it.
    if (!status.pinSet) {
      el('gate-overlay').hidden = true;
      openParentPanel();
      return;
    }
    el('gate-overlay').hidden = false;
  });
}

async function submitPin() {
  const outcome = await api.parent.unlock(state.pin);
  state.pin = '';
  renderPin();
  if (outcome.ok) {
    el('gate-overlay').hidden = true;
    openParentPanel();
    return;
  }
  const error = el('gate-error');
  error.hidden = false;
  error.textContent = outcome.locked
    ? `Too many tries. Wait ${Math.ceil(outcome.msRemaining / 1000)} seconds.`
    : `That is not the PIN. ${outcome.attemptsLeft} tr${outcome.attemptsLeft === 1 ? 'y' : 'ies'} left.`;
}

/* ------------------------------------------------------ the grown-up panel */

async function openParentPanel() {
  hush();
  el('parent-overlay').hidden = false;
  el('kid-name').value = state.settings.kidName || '';
  el('kid-age').value = state.settings.kidAge || 8;
  el('kid-age-value').textContent = state.settings.kidAge || 8;
  renderVoiceOptions();
  await refreshChart();
  renderQuestions();
  const status = await api.parent.status();
  el('current-pin-field').hidden = !status.pinSet;
  el('about-version').textContent = `JARVIS JUNIOR ${state.version || ''} — the children's build of JARVIS.`;
}

function renderVoiceOptions() {
  const select = el('kid-voice');
  if (!select) return;
  const voices = cachedVoices.filter((voice) => /^en/i.test(voice.lang));
  select.replaceChildren();
  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = 'Choose automatically';
  select.append(auto);
  for (const voice of voices) {
    const option = document.createElement('option');
    option.value = voice.name;
    option.textContent = `${voice.name} (${voice.lang})`;
    select.append(option);
  }
  select.value = state.settings.kidVoiceName || '';
}

function renderParentJobs() {
  const list = el('parent-jobs');
  if (!list) return;
  list.replaceChildren();
  for (const chore of state.chart.chores || []) {
    const row = document.createElement('div');
    row.className = 'parent-job';

    const name = document.createElement('span');
    name.className = 'parent-job-name';
    name.textContent = chore.title;

    const days = document.createElement('span');
    days.className = 'parent-job-days';
    days.textContent = (chore.days && chore.days.length) ? chore.days.join(' ') : 'every day';

    const stars = document.createElement('span');
    stars.className = 'parent-job-stars';
    stars.textContent = `${chore.stars} ★`;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.title = `Remove ${chore.title}`;
    remove.textContent = '×';
    remove.addEventListener('click', async () => {
      await api.kid.removeJob(chore.id);
      refreshChart();
    });

    row.append(name, days, stars, remove);
    list.append(row);
  }
  const summary = state.chart.summary || {};
  el('chart-summary').replaceChildren();
  for (const [label, value] of [['stars now', summary.stars || 0], ['earned in total', summary.earnedAllTime || 0], ['this week', summary.weekStars || 0], ['day streak', summary.streak || 0]]) {
    const item = document.createElement('span');
    const strong = document.createElement('b');
    strong.textContent = value;
    item.append(strong, ` ${label}`);
    el('chart-summary').append(item);
  }
}

async function renderQuestions() {
  const list = el('question-list');
  let entries = [];
  try { entries = await api.kid.questions(25); } catch { entries = []; }
  list.replaceChildren();
  el('questions-empty').hidden = entries.length > 0;
  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'question';
    const question = document.createElement('b');
    question.textContent = `“${entry.command}”`;
    const when = document.createElement('span');
    const stamp = new Date(entry.timestamp);
    when.textContent = `${stamp.toLocaleDateString()} ${stamp.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} — answered: ${entry.response}`;
    row.append(question, when);
    list.append(row);
  }
}

/* ----------------------------------------------------------------- wiring */

function wire() {
  const talk = el('talk-button');
  talk.addEventListener('pointerdown', (event) => {
    talk.setPointerCapture?.(event.pointerId);
    startRecording();
  });
  talk.addEventListener('pointerup', stopRecording);
  talk.addEventListener('pointercancel', stopRecording);

  // Space bar works as push-to-talk too, for a child who finds the keyboard
  // easier than the mouse. Not while they are typing in a box.
  document.addEventListener('keydown', (event) => {
    if (event.code === 'Space' && !event.repeat && document.activeElement?.tagName !== 'INPUT') {
      event.preventDefault();
      startRecording();
    }
    if (event.key === 'Escape') {
      hush();
      api.cancelAI?.();
      if (!el('timer-overlay').hidden) stopTimer();
      else if (!el('jobs-overlay').hidden) el('jobs-overlay').hidden = true;
      else if (!el('gate-overlay').hidden) el('gate-overlay').hidden = true;
    }
  });
  document.addEventListener('keyup', (event) => {
    if (event.code === 'Space' && document.activeElement?.tagName !== 'INPUT') stopRecording();
  });

  el('stop-button').addEventListener('click', () => {
    hush();
    api.cancelAI?.();
    setMood('ready');
  });

  el('type-row').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = el('type-input');
    const text = input.value.trim();
    input.value = '';
    if (text) say(text);
  });

  for (const button of document.querySelectorAll('.quick[data-say]')) {
    button.addEventListener('click', () => say(button.dataset.say));
  }

  el('jobs-button').addEventListener('click', async () => {
    await refreshChart();
    el('jobs-overlay').hidden = false;
  });
  el('jobs-close').addEventListener('click', () => { el('jobs-overlay').hidden = true; });

  el('timer-stop').addEventListener('click', stopTimer);
  el('timer-skip').addEventListener('click', skipRoutineStep);

  el('grownups-button').addEventListener('click', openGate);
  el('gate-cancel').addEventListener('click', () => { el('gate-overlay').hidden = true; });
  el('pin-pad').addEventListener('click', (event) => {
    const key = event.target.closest('button')?.dataset.key;
    if (!key) return;
    if (key === 'clear') state.pin = '';
    else if (key === 'enter') return submitPin();
    else if (state.pin.length < 8) state.pin += key;
    renderPin();
  });

  el('parent-close').addEventListener('click', () => { el('parent-overlay').hidden = true; });
  el('parent-tabs').addEventListener('click', (event) => {
    const tab = event.target.closest('.parent-tab');
    if (!tab) return;
    for (const button of document.querySelectorAll('.parent-tab')) button.classList.toggle('active', button === tab);
    for (const section of document.querySelectorAll('.parent-section')) section.hidden = section.dataset.panel !== tab.dataset.tab;
  });

  el('kid-age').addEventListener('input', (event) => { el('kid-age-value').textContent = event.target.value; });

  el('child-save').addEventListener('click', async () => {
    const patch = {
      kidName: el('kid-name').value.trim().slice(0, 24),
      kidAge: Number(el('kid-age').value),
      kidVoiceName: el('kid-voice').value
    };
    state.settings = await api.saveSettings(patch);
    const note = el('child-saved');
    note.hidden = false;
    setTimeout(() => { note.hidden = true; }, 2200);
  });

  el('add-job').addEventListener('submit', async (event) => {
    event.preventDefault();
    const days = [...document.querySelectorAll('#day-picker input:checked')].map((input) => input.value);
    await api.kid.addJob({ title: el('job-title').value.trim(), stars: Number(el('job-stars').value), days });
    el('job-title').value = '';
    for (const input of document.querySelectorAll('#day-picker input')) input.checked = false;
    refreshChart();
  });

  el('redeem-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const outcome = await api.kid.redeem({ stars: Number(el('redeem-stars').value), reward: el('redeem-reward').value.trim() });
    const note = el('redeem-note');
    note.hidden = false;
    note.textContent = outcome.ok ? 'Traded in.' : `Not enough stars — there are ${outcome.stars}.`;
    el('redeem-reward').value = '';
    refreshChart();
  });

  el('pin-save').addEventListener('click', async () => {
    const note = el('pin-note');
    note.hidden = false;
    if (el('new-pin').value !== el('confirm-pin').value) {
      note.textContent = 'The two PINs are not the same.';
      return;
    }
    const outcome = await api.parent.setPin({ current: el('current-pin').value, next: el('new-pin').value });
    note.textContent = outcome.ok ? 'PIN saved.' : outcome.message;
    if (outcome.ok) {
      el('new-pin').value = '';
      el('confirm-pin').value = '';
      el('current-pin').value = '';
      el('current-pin-field').hidden = false;
    }
  });

  el('window-minimize').addEventListener('click', () => api.windowControl('minimize'));
  el('window-close').addEventListener('click', () => api.windowControl('close'));

  // Streamed text from the brain lands here word by word, so a child is not
  // watching a blank screen while a story is written.
  api.onAIStream?.(({ piece }) => {
    if (!state.busy) return;
    const box = el('answer');
    if (!state.streaming) { box.textContent = ''; state.streaming = true; }
    box.className = 'answer';
    box.textContent += piece;
    box.scrollTop = box.scrollHeight;
  });
  api.onAIStreamReset?.(() => { el('answer').textContent = ''; });

  api.kid.onChartChanged?.(() => refreshChart());

  window.addEventListener('resize', sizeOrb);
}

/* -------------------------------------------------------------- start-up */

async function boot() {
  sizeOrb();
  drawOrb();
  wire();
  try {
    const bootstrap = await api.bootstrap();
    state.settings = bootstrap.settings || {};
    state.version = bootstrap.version;
  } catch {
    state.settings = {};
  }
  await refreshChart();
  const hour = new Date().getHours();
  const name = state.settings.kidName;
  const part = hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';
  showAnswer(name ? `${part}, ${name}!` : `${part}!`);
  setHint('Hold the button and talk to me');

  // A quiet nudge, not a lock: past bedtime it says so once and carries on.
  if (state.settings.kidBedtimeReminder !== false) {
    const bedtime = Number(state.settings.kidBedtimeHour);
    const wake = Number(state.settings.kidWakeHour);
    const late = Number.isFinite(bedtime) && Number.isFinite(wake)
      && (bedtime > wake ? (hour >= bedtime || hour < wake) : (hour >= bedtime && hour < wake));
    if (late) showAnswer(`${name ? `${part}, ${name}!` : `${part}!`}\nIt is past bedtime, so let us keep it quick.`);
  }
}

boot();
