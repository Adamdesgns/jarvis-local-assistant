const $ = (id) => document.getElementById(id);
const RESET_LAYOUT = {
  tasks: { x: 74, y: 8, w: 24, h: 58 }, performance: { x: 2, y: 8, w: 22, h: 44 },
  memory: { x: 2, y: 54, w: 24, h: 36 }, activity: { x: 74, y: 62, w: 24, h: 32 },
  'quick-commands': { x: 2, y: 54, w: 22, h: 38 }, projects: { x: 74, y: 8, w: 24, h: 38 },
  'file-explorer': { x: 12, y: 6, w: 76, h: 78 }, 'document-viewer': { x: 18, y: 5, w: 64, h: 76 }
};
const state = {
  settings: {},
  tasks: [],
  memories: [],
  activity: [],
  hiddenModules: [],
  layout: {},
  editing: false,
  activeProject: 'general',
  taskFilter: 'open',
  recording: null,
  pendingApproval: '',
  voiceStatus: {},
  ollamaStatus: {},
  cloudConfigured: false,
  currentDirectory: '',
  searchResults: [],
  searchTemporary: false,
  searchActive: false,
  saveTimer: null
};

function showToast(message, duration = 3200) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), duration);
}

function friendlyError(error) {
  const message = String(error?.message || error || 'Something went wrong.');
  if (/openai|api key|cloud brain|quota|billing/i.test(message)) return message;
  if (/local voice|transcription|python|whisper/i.test(message)) return 'Local voice is not ready yet. Open Settings and select Install Local Voice.';
  if (/ollama|fetch failed|ECONNREFUSED/i.test(message)) return 'Ollama is offline. Your tasks and file tools still work normally.';
  if (/permission|microphone|media/i.test(message)) return 'Windows is not allowing microphone access. Check Microphone Privacy settings.';
  return 'That command did not finish. Try it again or check Settings.';
}

function setCoreState(coreState, kicker) {
  const labels = { ready: 'READY', listening: 'LISTENING', processing: 'PROCESSING', speaking: 'RESPONDING', error: 'ATTENTION', exploding: 'SEARCHING' };
  $('core-state').textContent = labels[coreState] || coreState.toUpperCase();
  $('core-kicker').textContent = kicker || (coreState === 'ready' ? 'AWAITING DIRECTIVE' : 'LOCAL NEURAL PATH ACTIVE');
  document.body.classList.toggle('listening', coreState === 'listening');
  document.body.classList.toggle('recording', coreState === 'listening');
  window.jarvisHologram?.setState(coreState);
  window.jarvis.setUIState(coreState, kicker || labels[coreState]);
}

function setResponse(message) {
  $('jarvis-response').textContent = message;
}

function showDocumentOutput(title, content) {
  $('document-title').textContent = String(title || 'DOCUMENT SUMMARY').toUpperCase();
  $('document-output').textContent = String(content || 'No document content was returned.');
  state.hiddenModules = state.hiddenModules.filter((item) => item !== 'document-viewer');
  renderModuleVisibility();
  scheduleLayoutSave();
}

function renderOllamaStatus(status = {}) {
  state.ollamaStatus = status;
  const ready = Boolean(status.ready || status.online);
  $('ollama-title').textContent = ready ? 'LOCAL BRAIN ONLINE' : String(status.state || 'CONNECTING').replace(/-/g, ' ').toUpperCase();
  $('ollama-detail').textContent = status.message || (ready ? 'Ollama is ready.' : 'No API key or credits required.');
  const color = ready ? '#61efb2' : status.state === 'error' ? '#ff766d' : '#ffb21f';
  $('ollama-light').style.background = color;
  $('ollama-light').style.boxShadow = `0 0 8px ${color}`;
  const button = $('connect-ollama');
  const busy = ['connecting', 'starting', 'downloading'].includes(status.state);
  button.disabled = busy;
  button.textContent = status.state === 'downloading' && status.percent !== null && status.percent !== undefined
    ? `DOWNLOADING LOCAL BRAIN — ${status.percent}%`
    : ready ? 'OLLAMA CONNECTED' : busy ? 'CONNECTING…' : 'CONNECT / REPAIR OLLAMA';
  if (status.message && status.state !== 'online') setResponse(status.message);
  if (status.state === 'online') setResponse('Ollama is connected. Open-ended local conversation is ready.');
}

async function connectOllama() {
  renderOllamaStatus({ state: 'connecting', ready: false, message: 'Connecting to the local brain…' });
  try {
    renderOllamaStatus(await window.jarvis.connectOllama());
  } catch (error) {
    renderOllamaStatus({ state: 'error', ready: false, message: friendlyError(error) });
  }
}

function renderCloudStatus(configured, message = '') {
  state.cloudConfigured = Boolean(configured);
  const color = configured ? '#61efb2' : '#ffb21f';
  $('cloud-light').style.background = color;
  $('cloud-light').style.boxShadow = `0 0 8px ${color}`;
  $('cloud-title').textContent = configured ? 'CLOUD BRAIN CONNECTED' : 'NOT CONNECTED';
  $('cloud-detail').textContent = message || (configured
    ? 'OpenAI API key is encrypted and ready.'
    : 'Recommended for slower GPUs. Uses separate prepaid API credits.');
  $('remove-openai').disabled = !configured;
}

async function connectOpenAI() {
  const key = $('setting-openai-key').value.trim();
  if (!key) return showToast('Paste your OpenAI API key first.');
  $('connect-openai').disabled = true;
  $('connect-openai').textContent = 'TESTING…';
  renderCloudStatus(false, 'Testing OpenAI Cloud Brain…');
  try {
    state.settings = await window.jarvis.saveSettings({
      aiMode: $('setting-ai-mode').value,
      openaiModel: $('setting-openai-model').value
    });
    const result = await window.jarvis.saveOpenAIKey(key);
    $('setting-openai-key').value = '';
    renderCloudStatus(result.ok, result.message);
    showToast(result.ok ? 'Cloud Brain connected.' : result.message, 5500);
  } catch (error) {
    renderCloudStatus(false, friendlyError(error));
  } finally {
    $('connect-openai').disabled = false;
    $('connect-openai').textContent = 'SAVE KEY & TEST';
  }
}

function speak(message) {
  if (!state.settings.voiceEnabled || !message || !('speechSynthesis' in window)) {
    if (!state.searchActive) setCoreState('ready');
    return;
  }
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(message.replace(/[*#•]/g, ' '));
  const voices = speechSynthesis.getVoices();
  const preferred = ['Ryan', 'Guy', 'George', 'Daniel', 'David', 'Mark'];
  utterance.voice = preferred.map((name) => voices.find((voice) => voice.name.includes(name))).find(Boolean)
    || voices.find((voice) => voice.lang.startsWith('en'));
  utterance.rate = .98;
  utterance.pitch = .88;
  utterance.volume = .92;
  utterance.onstart = () => setCoreState('speaking', 'LOCAL VOICE RESPONSE');
  utterance.onend = () => { if (!state.searchActive) setCoreState('ready'); };
  utterance.onerror = () => { if (!state.searchActive) setCoreState('ready'); };
  speechSynthesis.speak(utterance);
}

function moduleElement(name) {
  return document.querySelector(`[data-module="${name}"]`);
}

function applyModuleLayout(name) {
  const module = moduleElement(name);
  const layout = state.layout[name];
  if (!module || !layout) return;
  module.style.left = `${layout.x}%`;
  module.style.top = `${layout.y}%`;
  module.style.width = `${layout.w}%`;
  module.style.height = `${layout.h}%`;
  module.style.zIndex = String(layout.z || 1);
}

function renderModuleVisibility() {
  document.querySelectorAll('[data-module]').forEach((module) => {
    const hidden = state.hiddenModules.includes(module.dataset.module);
    if (!module.classList.contains('spotlight')) module.classList.toggle('hidden-module', hidden);
    applyModuleLayout(module.dataset.module);
  });
  document.querySelectorAll('[data-toggle-module]').forEach((button) => {
    const enabled = !state.hiddenModules.includes(button.dataset.toggleModule);
    button.classList.toggle('enabled', enabled);
    button.querySelector('i').textContent = enabled ? '✓' : '';
  });
}

function scheduleLayoutSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(async () => {
    try {
      state.settings = await window.jarvis.saveSettings({ hiddenModules: state.hiddenModules, moduleLayout: state.layout });
    } catch {}
  }, 350);
}

function toggleModule(name, visible) {
  const currentlyHidden = state.hiddenModules.includes(name);
  const shouldShow = visible ?? currentlyHidden;
  if (shouldShow) state.hiddenModules = state.hiddenModules.filter((item) => item !== name);
  else if (!currentlyHidden) state.hiddenModules.push(name);
  if (shouldShow && state.engine) {
    const rect = state.layout[name] || RESET_LAYOUT[name] || { x: 30, y: 12, w: 32, h: 44 };
    const visible = Object.entries(state.layout).filter(([key]) => key !== name && !state.hiddenModules.includes(key)).map(([, value]) => value);
    const covered = visible.reduce((sum, other) => sum + window.JarvisLayout.overlapArea(rect, other), 0);
    if (!state.layout[name] || covered > rect.w * rect.h * 0.6) state.engine.place(name, { w: rect.w, h: rect.h });
  }
  renderModuleVisibility();
  scheduleLayoutSave();
  if (name === 'file-explorer' && shouldShow) showFileRoots();
}

function bindModuleLayout() {
  state.engine = window.JarvisLayout.createEngine({
    layer: $('module-layer'),
    layout: state.layout,
    apply: applyModuleLayout,
    save: scheduleLayoutSave
  });
  document.querySelectorAll('.module').forEach((module) => state.engine.attach(module));
}

function formatDate(value) {
  if (!value) return 'NO DUE DATE';
  return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function renderTasks(tasks = state.tasks) {
  state.tasks = tasks;
  const list = $('task-list');
  list.replaceChildren();
  const openCount = state.tasks.filter((task) => task.status === 'open').length;
  $('task-count').textContent = `${openCount} OPEN`;
  const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);
  const visible = (state.taskFilter === 'all' ? state.tasks : state.tasks.filter((task) => task.status === 'open'))
    .filter((task) => state.taskFilter !== 'today' || (task.dueAt && new Date(task.dueAt) <= endOfToday))
    .filter((task) => state.taskFilter !== 'project' || task.project === state.activeProject)
    .sort((a, b) => ({ high: 0, normal: 1, low: 2 }[a.priority || 'normal']) - ({ high: 0, normal: 1, low: 2 }[b.priority || 'normal']));
  if (!visible.length) {
    list.innerHTML = '<div class="empty-state">NOTHING PENDING.<br>YOUR HEAD IS CLEAR.</div>';
    return;
  }
  for (const task of visible) {
    const row = document.createElement('div');
    row.className = `task-item ${task.status === 'done' ? 'done' : ''}`;
    const check = document.createElement('button');
    check.className = 'task-check';
    check.title = task.status === 'done' ? 'Reopen task' : 'Complete task';
    check.addEventListener('click', async () => {
      await window.jarvis.tasks.update(task.id, { status: task.status === 'done' ? 'open' : 'done' });
      renderTasks(await window.jarvis.tasks.list());
    });
    const copy = document.createElement('div');
    copy.className = 'task-copy';
    const title = document.createElement('b'); title.textContent = task.title;
    title.title = 'Click to edit';
    title.addEventListener('click', () => {
      const input = document.createElement('input');
      input.className = 'task-edit';
      input.value = task.title;
      title.replaceWith(input);
      input.focus();
      const commit = async () => {
        const value = input.value.trim();
        if (value && value !== task.title) await window.jarvis.tasks.update(task.id, { title: value });
        renderTasks(await window.jarvis.tasks.list());
      };
      input.addEventListener('keydown', (event) => { if (event.key === 'Enter') input.blur(); if (event.key === 'Escape') { input.value = task.title; input.blur(); } });
      input.addEventListener('blur', commit);
    });
    const priority = document.createElement('button');
    priority.className = `task-priority ${task.priority || 'normal'}`;
    priority.textContent = (task.priority || 'normal').toUpperCase();
    priority.title = 'Click to change priority';
    priority.addEventListener('click', async () => {
      const next = { low: 'normal', normal: 'high', high: 'low' }[task.priority || 'normal'];
      await window.jarvis.tasks.update(task.id, { priority: next });
      renderTasks(await window.jarvis.tasks.list());
    });
    const meta = document.createElement('span'); meta.textContent = `${task.project} · ${formatDate(task.dueAt)}${task.repeat ? ` · repeats ${task.repeat}` : ''}`;
    copy.append(title, priority, meta);
    const remove = document.createElement('button'); remove.className = 'task-delete'; remove.textContent = '×';
    remove.addEventListener('click', async () => { await window.jarvis.tasks.remove(task.id); renderTasks(await window.jarvis.tasks.list()); });
    row.append(check, copy, remove);
    list.append(row);
  }
}

function renderMemories(memories = state.memories) {
  state.memories = memories;
  const list = $('memory-list');
  list.replaceChildren();
  const filter = ($('memory-search')?.value || '').trim().toLowerCase();
  const visible = filter
    ? memories.filter((memory) => memory.text.toLowerCase().includes(filter))
    : memories;
  if (!visible.length) { list.innerHTML = `<div class="empty-state">${filter ? 'NO MATCHING MEMORIES' : 'NO SAVED MEMORIES'}</div>`; return; }
  for (const memory of visible.slice(0, 30)) {
    const row = document.createElement('div'); row.className = 'memory-item';
    const text = document.createElement('b'); text.textContent = memory.text;
    text.title = 'Click to edit';
    text.addEventListener('click', () => {
      const input = document.createElement('input');
      input.className = 'task-edit';
      input.value = memory.text;
      text.replaceWith(input);
      input.focus();
      const commit = async () => {
        const value = input.value.trim();
        if (value && value !== memory.text) await window.jarvis.memories.update(memory.id, value);
        renderMemories(await window.jarvis.memories.list());
      };
      input.addEventListener('keydown', (event) => { if (event.key === 'Enter') input.blur(); if (event.key === 'Escape') { input.value = memory.text; input.blur(); } });
      input.addEventListener('blur', commit);
    });
    const forget = document.createElement('button');
    forget.className = 'task-delete';
    forget.textContent = '×';
    forget.title = 'Forget this memory';
    forget.addEventListener('click', async () => {
      await window.jarvis.memories.remove(memory.id);
      renderMemories(await window.jarvis.memories.list());
    });
    const meta = document.createElement('span'); meta.textContent = `${memory.project || 'general'} · ${new Date(memory.createdAt).toLocaleDateString()}`;
    row.append(text, forget, meta); list.append(row);
  }
}

function renderActivity(items = state.activity) {
  state.activity = items;
  const list = $('activity-list'); list.replaceChildren();
  if (!items.length) { list.innerHTML = '<div class="empty-state">NO COMMANDS LOGGED</div>'; return; }
  for (const item of items.slice(0, 20)) {
    const row = document.createElement('div'); row.className = 'activity-item';
    const title = document.createElement('b'); title.textContent = item.command || item.type;
    const meta = document.createElement('span'); meta.textContent = `${item.source || 'local'} · ${new Date(item.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    row.append(title, meta); list.append(row);
  }
}

function renderTelemetry(data) {
  $('cpu-value').textContent = data.cpu;
  $('ram-value').textContent = data.memory;
  $('cpu-meter').style.setProperty('--value', data.cpu);
  $('ram-meter').style.setProperty('--value', data.memory);
  $('gpu-value').textContent = data.gpu || 'RTX 5060 · 8 GB';
  $('ram-detail').textContent = `${data.memoryUsedGb} / ${data.memoryTotalGb} GB`;
  const hours = Math.floor((data.uptime || 0) / 3600);
  $('uptime-value').textContent = `${hours} HOURS`;
}

function formatBytes(bytes) {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function buildFileRow(file, matching = false) {
    const row = document.createElement('button'); row.className = `file-row ${matching ? 'match' : ''}`;
    const name = document.createElement('div'); name.className = 'file-name';
    const icon = document.createElement('i'); icon.textContent = file.type === 'folder' ? '▱' : '◇';
    const copy = document.createElement('div');
    const title = document.createElement('b'); title.textContent = file.name;
    const path = document.createElement('small'); path.textContent = file.path;
    copy.append(title, path); name.append(icon, copy);
    const modified = document.createElement('span'); modified.textContent = file.modifiedAt ? new Date(file.modifiedAt).toLocaleDateString() : '—';
    const size = document.createElement('span'); size.textContent = file.type === 'folder' ? 'FOLDER' : formatBytes(file.size);
    row.append(name, modified, size);
    row.addEventListener('click', async () => {
      if (file.type === 'folder' && !matching) await browseDirectory(file.path);
      else {
        const result = await window.jarvis.files.open(file.path);
        showToast(result.ok ? `Opening ${file.name}` : result.message);
      }
    });
  return row;
}

function renderFileRows(files, matching = false) {
  const list = $('file-browser-list'); list.replaceChildren();
  if (!files.length) { list.innerHTML = '<div class="empty-state">NO FILES TO DISPLAY</div>'; return; }
  for (const file of files) list.append(buildFileRow(file, matching));
}

function folderEntry(folder) {
  return { name: folder.split(/[\\/]/).filter(Boolean).pop() || folder, path: folder, type: 'folder', modifiedAt: null, size: 0 };
}

async function showFileRoots() {
  try {
    const home = await window.jarvis.files.home();
    state.currentDirectory = '';
    $('file-breadcrumb').textContent = 'APPROVED LOCATIONS';
    $('file-pin').textContent = '☆';
    const list = $('file-browser-list'); list.replaceChildren();
    const section = (label) => {
      const heading = document.createElement('div');
      heading.className = 'file-section';
      heading.textContent = label;
      list.append(heading);
    };
    if (home.pinned.length) {
      section('★ PINNED FOLDERS');
      for (const folder of home.pinned) list.append(buildFileRow(folderEntry(folder)));
    }
    section('APPROVED LOCATIONS');
    for (const root of home.roots) list.append(buildFileRow(folderEntry(root)));
    if (home.recent.length) {
      section('RECENT FILES');
      for (const item of home.recent) list.append(buildFileRow({ name: item.name, path: item.path, type: 'file', modifiedAt: item.openedAt, size: 0 }));
    }
  } catch (error) { showToast(friendlyError(error)); }
}

async function browseDirectory(directory) {
  try {
    state.currentDirectory = directory;
    $('file-breadcrumb').textContent = directory;
    $('scan-label').textContent = 'BROWSING LOCAL FILES';
    $('scan-path').textContent = directory;
    $('file-pin').textContent = (state.settings.pinnedFolders || []).includes(directory) ? '★' : '☆';
    $('file-watch').classList.toggle('active', (state.settings.watchedFolders || []).some((entry) => entry.path === directory));
    renderFileRows(await window.jarvis.files.list(directory));
  } catch (error) { showToast(friendlyError(error)); }
}

function startSearchExperience(query = 'local files') {
  state.searchActive = true;
  state.searchResults = [];
  state.searchTemporary = state.hiddenModules.includes('file-explorer');
  const explorer = moduleElement('file-explorer');
  explorer.classList.remove('hidden-module');
  explorer.classList.add('spotlight');
  applyModuleLayout('file-explorer');
  document.body.classList.add('searching');
  setCoreState('exploding', 'DISASSEMBLING CORE · FILE SEARCH');
  $('scan-label').textContent = 'DEPLOYING FILE EXPLORER';
  $('scan-path').textContent = query;
  $('scan-counter').textContent = 'INITIALIZING';
  renderFileRows([]);
  window.jarvis.restoreMain();
}

function finishSearchExperience(force = false) {
  const explorer = moduleElement('file-explorer');
  explorer.classList.remove('spotlight');
  document.body.classList.remove('searching');
  document.body.classList.add('reforming');
  state.searchActive = false;
  window.jarvisHologram?.setState('ready');
  setTimeout(() => document.body.classList.remove('reforming'), 900);
  if (state.searchTemporary || force) {
    setTimeout(() => explorer.classList.add('hidden-module'), state.settings.motionMode === 'reduced' ? 50 : 650);
  }
  setCoreState('ready', 'CORE REFORMED');
}

function renderVoiceStatus(status) {
  state.voiceStatus = status || {};
  const installed = Boolean(status?.installed);
  const running = Boolean(status?.running);
  const wake = Boolean(status?.wakeReady);
  $('voice-dot').style.background = wake ? '#61efb2' : running ? '#ffb21f' : '#ff665c';
  $('voice-status').textContent = wake ? 'SAY “HEY JARVIS” · LOCAL VOICE READY' : running ? 'PUSH-TO-TALK READY · WAKE WORD STARTING' : 'LOCAL VOICE NEEDS SETUP';
  $('local-voice-light').style.background = wake ? '#61efb2' : installed ? '#ffb21f' : '#ff665c';
  $('local-voice-title').textContent = wake ? 'HEY JARVIS IS ACTIVE' : installed ? 'LOCAL VOICE INSTALLED' : 'LOCAL VOICE NOT INSTALLED';
  $('local-voice-detail').textContent = status?.message || 'No API key or credits required.';
}

async function startRecording(trigger = 'manual') {
  if (state.recording) return stopRecording();
  if (!state.voiceStatus.installed || !state.voiceStatus.running) {
    setResponse('Local voice needs one-time installation. No credits are required.');
    openSettings();
    return;
  }
  try {
    speechSynthesis?.cancel();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    const mimeType = preferred.find((type) => MediaRecorder.isTypeSupported(type)) || '';
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const context = new AudioContext();
    const analyser = context.createAnalyser(); analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    const chunks = [];
    const started = performance.now();
    let heardSpeech = false;
    let lastSpeech = started;
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = async () => {
      cancelAnimationFrame(state.recording?.monitor || 0);
      stream.getTracks().forEach((track) => track.stop());
      await context.close();
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
      state.recording = null;
      window.jarvisHologram?.setAudioLevel(0);
      if (blob.size < 800) { setCoreState('ready'); return; }
      setCoreState('processing', 'LOCAL SPEECH RECOGNITION');
      try {
        const transcript = await window.jarvis.transcribe(new Uint8Array(await blob.arrayBuffer()), blob.type);
        if (transcript) executeCommand(transcript);
        else { setResponse('I didn’t catch that. Try once more.'); setCoreState('ready'); }
      } catch (error) {
        const message = friendlyError(error); setResponse(message); showToast(message); setCoreState('error', 'LOCAL VOICE NEEDS ATTENTION');
      }
    };
    function monitor() {
      if (!state.recording) return;
      analyser.getByteTimeDomainData(samples);
      let total = 0;
      for (const sample of samples) { const value = (sample - 128) / 128; total += value * value; }
      const rms = Math.sqrt(total / samples.length);
      window.jarvisHologram?.setAudioLevel(Math.min(1, rms * 9));
      if (rms > .027) { heardSpeech = true; lastSpeech = performance.now(); }
      const elapsed = performance.now() - started;
      if ((heardSpeech && elapsed > 900 && performance.now() - lastSpeech > 1350) || elapsed > 15000) return stopRecording();
      state.recording.monitor = requestAnimationFrame(monitor);
    }
    state.recording = { recorder, stream, monitor: 0 };
    recorder.start(250);
    setCoreState('listening', trigger === 'wake' ? 'HEY JARVIS DETECTED' : 'LISTENING LOCALLY');
    monitor();
  } catch (error) {
    const message = friendlyError(error); setResponse(message); showToast(message); setCoreState('error');
  }
}

function stopRecording() {
  if (state.recording?.recorder?.state === 'recording') state.recording.recorder.stop();
}

function looksLikeFileSearch(command) {
  const text = command.trim();
  return /^(?:jarvis[, ]*)?(?:can you\s+)?(?:find|locate|look for|search(?: my (?:computer|files))? for|find\s+and\s+open)\s+/i.test(text)
    || /^(?:search|find|look)\s+(?:inside|through)\s+(?:my\s+)?documents?/i.test(text)
    || /^open\s+.*\b(latest|newest|file|document|report|proposal|instructions|manual|pdf|docx|xlsx)\b/i.test(text);
}

async function executeCommand(command) {
  const text = String(command || '').trim();
  if (!text) return;
  $('command-input').value = '';
  if (looksLikeFileSearch(text)) startSearchExperience(text);
  else setCoreState('processing', 'ROUTING LOCAL COMMAND');
  setResponse(`› ${text}`);
  try {
    const result = await window.jarvis.submitCommand(text);
    setResponse(result.response);
    if (result.tasks) renderTasks(result.tasks);
    if (result.memories || result.source === 'memory') renderMemories(await window.jarvis.memories.list());
    if (result.openSettings) openSettings();
    if (result.document) showDocumentOutput(result.document.name, result.response);
    if (result.approval) showApproval(result.approval);
    if (result.files) {
      state.searchResults = result.files;
      renderFileRows(result.files, true);
      if (result.openedFile) {
        $('scan-label').textContent = 'MATCH FOUND · OPENING FILE';
        $('scan-path').textContent = result.openedFile.path;
        setTimeout(() => finishSearchExperience(), state.settings.motionMode === 'cinematic' ? 1700 : 500);
      } else if (result.needsChoice) {
        $('scan-label').textContent = 'MULTIPLE MATCHES · SELECT ONE';
        $('scan-path').textContent = result.query;
      } else if (!result.files.length) {
        $('scan-label').textContent = 'NO MATCH FOUND';
        $('scan-path').textContent = result.query;
        setTimeout(() => finishSearchExperience(), 1800);
      }
    }
    state.activity = await window.jarvis.recentActivity(20); renderActivity(state.activity);
    if (!result.approval && !state.searchActive) speak(result.response);
    else if (!result.approval && result.openedFile) speak(result.response);
  } catch (error) {
    const message = friendlyError(error); setResponse(message); showToast(message); setCoreState('error', 'LOCAL COMMAND FAILED');
    if (state.searchActive) setTimeout(() => finishSearchExperience(), 1200);
  }
}

function showApproval(approval) {
  state.pendingApproval = approval.id;
  $('approval-title').textContent = approval.title;
  $('approval-detail').textContent = approval.detail;
  $('approval-modal').showModal();
}

async function resolveApproval(approved) {
  $('approval-modal').close();
  const result = await window.jarvis.resolveApproval(state.pendingApproval, approved);
  state.pendingApproval = '';
  setResponse(result.response);
  speak(result.response);
}

function renderSearchRoots() {
  const list = $('search-root-list'); list.replaceChildren();
  for (const [index, root] of (state.settings.searchRoots || []).entries()) {
    const row = document.createElement('div'); row.className = 'search-root';
    const label = document.createElement('span'); label.textContent = root;
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×';
    remove.addEventListener('click', () => { state.settings.searchRoots.splice(index, 1); renderSearchRoots(); });
    row.append(label, remove); list.append(row);
  }
}

function updateFolderLabels() {
  for (const name of ['anvil', 'the bench', 'adamscraft']) {
    $(`folder-${name.replace(/\s/g, '-')}`).textContent = state.settings.projects?.[name] || 'Not assigned';
  }
}

function openSettings() {
  $('setting-ollama-model').value = state.settings.ollamaModel || 'qwen3:8b';
  $('setting-ai-mode').value = state.settings.aiMode || 'local';
  $('setting-openai-model').value = state.settings.openaiModel || 'gpt-5-mini';
  $('setting-openai-key').value = '';
  $('setting-profile-name').value = state.settings.profileName || 'User';
  $('setting-voice').checked = Boolean(state.settings.voiceEnabled);
  $('setting-wake').checked = Boolean(state.settings.wakeWordEnabled);
  $('setting-orb').checked = Boolean(state.settings.minimizeToOrb);
  $('setting-top').checked = Boolean(state.settings.orbAlwaysOnTop);
  $('setting-startup').checked = Boolean(state.settings.startWithWindows);
  $('setting-motion').value = state.settings.motionMode || 'cinematic';
  updateFolderLabels(); renderSearchRoots(); renderVoiceStatus(state.voiceStatus); renderCloudStatus(state.cloudConfigured);
  $('settings-modal').showModal();
}

async function saveSettings(event) {
  event.preventDefault();
  const patch = {
    profileName: $('setting-profile-name').value.trim() || 'User',
    aiMode: $('setting-ai-mode').value,
    openaiModel: $('setting-openai-model').value,
    ollamaModel: $('setting-ollama-model').value.trim() || 'qwen3:8b',
    voiceEnabled: $('setting-voice').checked,
    wakeWordEnabled: $('setting-wake').checked,
    minimizeToOrb: $('setting-orb').checked,
    orbAlwaysOnTop: $('setting-top').checked,
    startWithWindows: $('setting-startup').checked,
    motionMode: $('setting-motion').value,
    projects: state.settings.projects,
    searchRoots: state.settings.searchRoots
  };
  state.settings = await window.jarvis.saveSettings(patch);
  $('settings-modal').close();
  showToast('Settings saved locally.');
}

const diagnostics = { data: null, micTest: null, wakeTimer: null, wakeCountdown: null };

function renderDiagnosticRow(key, ok, detail) {
  const row = document.querySelector(`.diagnostic-row[data-check="${key}"]`);
  if (!row) return;
  row.classList.toggle('pass', ok);
  row.classList.toggle('fail', !ok);
  row.querySelector('span').textContent = detail || (ok ? 'Working' : 'Needs attention');
}

async function refreshDiagnostics() {
  document.querySelectorAll('.diagnostic-row').forEach((row) => {
    row.classList.remove('pass', 'fail');
    row.querySelector('span').textContent = 'Checking…';
  });
  try {
    const data = await window.jarvis.diagnoseVoice();
    diagnostics.data = data;
    const checks = data.checks || {};
    renderDiagnosticRow('micPermission', data.micPermission === 'granted', `Windows reports: ${data.micPermission || 'unknown'}`);
    renderDiagnosticRow('microphone', Boolean(checks.microphone?.ok), checks.microphone?.detail || 'Install Local Voice to check devices');
    renderDiagnosticRow('installed', Boolean(data.installed), data.installed ? `Python ${data.python || 'ready'}` : 'Select Repair Voice below');
    renderDiagnosticRow('speechModel', Boolean(checks.speechModel?.ok), checks.speechModel?.detail || 'Install Local Voice to download it');
    renderDiagnosticRow('wakeModel', Boolean(checks.wakeModel?.ok), checks.wakeModel?.detail || 'Install Local Voice to download it');
    renderDiagnosticRow('running', Boolean(data.running), data.statusMessage || (data.running ? 'Background service is on' : 'Not running'));
    renderDiagnosticRow('wakeReady', Boolean(data.wakeReady), data.wakeReady ? 'Say “Hey Jarvis”' : 'Wake word is off or still starting');
  } catch (error) {
    $('diagnostic-result').textContent = friendlyError(error);
  }
}

async function runMicTest() {
  if (diagnostics.micTest) return;
  const button = $('diag-test-mic');
  const output = $('diagnostic-result');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    const mimeType = preferred.find((type) => MediaRecorder.isTypeSupported(type)) || '';
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const context = new AudioContext();
    const analyser = context.createAnalyser(); analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    const chunks = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    diagnostics.micTest = { recorder, stream };
    button.disabled = true;
    button.textContent = 'RECORDING · SPEAK NOW';
    output.textContent = 'Say a short phrase, for example: “Testing my microphone.”';
    const meter = () => {
      if (!diagnostics.micTest) { $('diagnostic-level').style.width = '0%'; return; }
      analyser.getByteTimeDomainData(samples);
      let total = 0;
      for (const sample of samples) { const value = (sample - 128) / 128; total += value * value; }
      $('diagnostic-level').style.width = `${Math.min(100, Math.sqrt(total / samples.length) * 900)}%`;
      requestAnimationFrame(meter);
    };
    meter();
    recorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      await context.close();
      diagnostics.micTest = null;
      button.textContent = 'TRANSCRIBING…';
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
      try {
        if (blob.size < 800) { output.textContent = 'I did not hear anything. Check the microphone rows above.'; return; }
        const transcript = await window.jarvis.transcribe(new Uint8Array(await blob.arrayBuffer()), blob.type);
        output.textContent = transcript ? `I heard: “${transcript}”` : 'The recording worked, but no words were recognized. Try speaking louder.';
      } catch (error) {
        output.textContent = friendlyError(error);
      } finally {
        button.disabled = false;
        button.textContent = 'TEST MICROPHONE';
      }
    };
    recorder.start(250);
    setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 4200);
  } catch (error) {
    diagnostics.micTest = null;
    button.disabled = false;
    button.textContent = 'TEST MICROPHONE';
    output.textContent = friendlyError(error);
  }
}

function runWakeTest() {
  const button = $('diag-test-wake');
  const output = $('diagnostic-result');
  if (diagnostics.wakeTimer) return;
  if (!diagnostics.data?.wakeReady) {
    output.textContent = 'The wake word is not listening yet. Fix the red rows above first, then try again.';
    return;
  }
  let remaining = 15;
  button.disabled = true;
  const tick = () => { button.textContent = `SAY “HEY JARVIS” · ${remaining}s`; };
  tick();
  output.textContent = 'Listening… say “Hey Jarvis” out loud.';
  diagnostics.wakeCountdown = setInterval(() => { remaining -= 1; tick(); }, 1000);
  diagnostics.wakeTimer = setTimeout(() => finishWakeTest(false), 15000);
}

function finishWakeTest(detected) {
  if (!diagnostics.wakeTimer) return;
  clearTimeout(diagnostics.wakeTimer);
  clearInterval(diagnostics.wakeCountdown);
  diagnostics.wakeTimer = null;
  diagnostics.wakeCountdown = null;
  const button = $('diag-test-wake');
  button.disabled = false;
  button.textContent = 'TEST “HEY JARVIS”';
  $('diagnostic-result').textContent = detected
    ? 'Wake word detected. “Hey Jarvis” is working.'
    : 'I did not hear “Hey Jarvis” in 15 seconds. Speak closer to the microphone, or select Repair Voice.';
}

function openVoiceDiagnostics() {
  $('voice-diagnostics-modal').showModal();
  $('diagnostic-result').textContent = 'Use the buttons below to test your microphone and wake word.';
  refreshDiagnostics();
}

function bindEvents() {
  document.querySelectorAll('[data-window]').forEach((button) => button.addEventListener('click', () => window.jarvis.windowControl(button.dataset.window)));
  $('command-form').addEventListener('submit', (event) => { event.preventDefault(); executeCommand($('command-input').value); });
  $('mic-button').addEventListener('click', () => startRecording('manual'));
  $('quick-task-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const title = $('quick-task-input').value.trim(); if (!title) return;
    await window.jarvis.tasks.add({ title, project: state.activeProject }); $('quick-task-input').value = ''; renderTasks(await window.jarvis.tasks.list());
  });
  document.querySelectorAll('[data-task-filter]').forEach((button) => button.addEventListener('click', () => {
    state.taskFilter = button.dataset.taskFilter; document.querySelectorAll('[data-task-filter]').forEach((item) => item.classList.toggle('active', item === button)); renderTasks();
  }));
  $('memory-search').addEventListener('input', () => renderMemories());
  $('memory-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const text = $('memory-input').value.trim(); if (!text) return;
    await window.jarvis.memories.add(text, state.activeProject); $('memory-input').value = ''; renderMemories(await window.jarvis.memories.list());
  });
  document.querySelectorAll('[data-project]').forEach((button) => button.addEventListener('click', () => {
    state.activeProject = button.dataset.project; $('active-project').textContent = state.activeProject.toUpperCase(); document.querySelectorAll('[data-project]').forEach((item) => item.classList.toggle('active', item === button));
  }));
  document.querySelectorAll('[data-command]').forEach((button) => button.addEventListener('click', () => executeCommand(button.dataset.command)));

  $('modules-button').addEventListener('click', () => $('module-drawer').classList.toggle('open'));
  $('close-modules').addEventListener('click', () => $('module-drawer').classList.remove('open'));
  $('layout-button').addEventListener('click', () => {
    state.editing = !state.editing; document.body.classList.toggle('layout-editing', state.editing); $('layout-button').classList.toggle('active', state.editing); showToast(state.editing ? 'Drag modules and resize from the bottom-right corner.' : 'Layout saved.');
  });
  document.querySelectorAll('[data-toggle-module]').forEach((button) => button.addEventListener('click', () => toggleModule(button.dataset.toggleModule)));
  document.querySelectorAll('[data-hide]').forEach((button) => button.addEventListener('click', () => toggleModule(button.closest('.module').dataset.module, false)));
  document.querySelectorAll('[data-collapse]').forEach((button) => button.addEventListener('click', () => button.closest('.module').classList.toggle('collapsed')));
  $('reset-layout').addEventListener('click', () => {
    state.hiddenModules = ['performance','memory','activity','quick-commands','projects','file-explorer','document-viewer'];
    for (const key of Object.keys(state.layout)) delete state.layout[key];
    Object.assign(state.layout, JSON.parse(JSON.stringify(RESET_LAYOUT)));
    renderModuleVisibility(); scheduleLayoutSave(); showToast('Default layout restored.');
  });

  $('file-up').addEventListener('click', async () => {
    if (!state.currentDirectory) return showFileRoots();
    const roots = (await window.jarvis.files.roots()).map((root) => root.replace(/[\\/]+$/, '').toLowerCase());
    const current = state.currentDirectory.replace(/[\\/]+$/, '');
    // Navigation stops at the approved roots: going up from a root shows the
    // roots list instead of erroring on a folder outside the allowed area.
    if (roots.includes(current.toLowerCase())) return showFileRoots();
    const separator = current.includes('\\') ? '\\' : '/';
    const parent = current.split(separator).slice(0, -1).join(separator);
    const parentAllowed = roots.some((root) => parent.toLowerCase() === root || parent.toLowerCase().startsWith(`${root}${separator}`));
    if (parent && parentAllowed) browseDirectory(parent); else showFileRoots();
  });
  $('file-close-search').addEventListener('click', () => finishSearchExperience(true));
  $('file-pin').addEventListener('click', async () => {
    if (!state.currentDirectory) return showToast('Open a folder first, then pin it.');
    const pinned = [...(state.settings.pinnedFolders || [])];
    const index = pinned.indexOf(state.currentDirectory);
    if (index >= 0) pinned.splice(index, 1); else pinned.unshift(state.currentDirectory);
    state.settings = await window.jarvis.saveSettings({ pinnedFolders: pinned.slice(0, 8) });
    $('file-pin').textContent = index >= 0 ? '☆' : '★';
    showToast(index >= 0 ? 'Folder unpinned.' : 'Folder pinned to the top of the explorer.');
  });
  $('copy-document-output').addEventListener('click', async () => {
    await window.jarvis.writeClipboard($('document-output').textContent);
    showToast('Document summary copied.');
  });

  $('settings-button').addEventListener('click', openSettings);
  document.querySelectorAll('[data-close-settings]').forEach((button) => button.addEventListener('click', () => $('settings-modal').close()));
  $('settings-form').addEventListener('submit', saveSettings);
  $('install-local-voice').addEventListener('click', async () => { const result = await window.jarvis.setupLocalVoice(); showToast(result.message, 5000); });
  $('open-voice-diagnostics').addEventListener('click', openVoiceDiagnostics);
  $('close-diagnostics').addEventListener('click', () => { finishWakeTest(false); $('voice-diagnostics-modal').close(); });
  $('diag-refresh').addEventListener('click', refreshDiagnostics);
  $('diag-test-mic').addEventListener('click', runMicTest);
  $('diag-test-wake').addEventListener('click', runWakeTest);
  $('diag-repair').addEventListener('click', async () => {
    const result = await window.jarvis.setupLocalVoice();
    $('diagnostic-result').textContent = `${result.message} When the installer window finishes, select Run Checks Again.`;
  });
  $('diag-copy').addEventListener('click', async () => {
    const data = { ...(diagnostics.data || {}) };
    const checks = data.checks || {};
    const label = (ok) => (ok ? 'PASS' : 'FAIL');
    const lines = [
      'JARVIS VOICE DIAGNOSTIC REPORT',
      `App version: ${data.appVersion || 'unknown'} · Python: ${data.python || 'not installed'}`,
      `[${label(data.micPermission === 'granted')}] Microphone permission — ${data.micPermission || 'unknown'}`,
      `[${label(checks.microphone?.ok)}] Microphone device — ${checks.microphone?.detail || 'not checked'}`,
      `[${label(data.installed)}] Python voice environment`,
      `[${label(checks.speechModel?.ok)}] Speech model — ${checks.speechModel?.detail || 'not checked'}`,
      `[${label(checks.wakeModel?.ok)}] Wake-word model — ${checks.wakeModel?.detail || 'not checked'}`,
      `[${label(data.running)}] Voice service running — ${data.statusMessage || ''}`,
      `[${label(data.wakeReady)}] Wake word listening`
    ];
    await window.jarvis.writeClipboard(lines.join('\n'));
    showToast('Diagnostic report copied. Paste it anywhere.');
  });
  $('connect-ollama').addEventListener('click', connectOllama);
  $('connect-openai').addEventListener('click', connectOpenAI);
  $('remove-openai').addEventListener('click', async () => {
    const result = await window.jarvis.removeOpenAIKey();
    renderCloudStatus(false, result.message);
    if (state.settings.aiMode === 'cloud') $('setting-ai-mode').value = 'local';
    showToast(result.message);
  });
  $('openai-billing').addEventListener('click', () => window.jarvis.openOpenAIBilling());
  $('openai-keys').addEventListener('click', () => window.jarvis.openOpenAIKeys());
  $('get-ollama').addEventListener('click', () => window.jarvis.openOllamaDownload());
  document.querySelectorAll('[data-folder]').forEach((button) => button.addEventListener('click', async () => {
    const selected = await window.jarvis.chooseFolder(`Assign ${button.dataset.folder} workspace`);
    if (selected) { state.settings.projects[button.dataset.folder] = selected; updateFolderLabels(); }
  }));
  $('add-search-root').addEventListener('click', async () => {
    const selected = await window.jarvis.chooseFolder('Add a folder JARVIS may search');
    if (selected && !state.settings.searchRoots.includes(selected)) { state.settings.searchRoots.push(selected); renderSearchRoots(); }
  });
  $('file-watch').addEventListener('click', async () => {
    if (!state.currentDirectory) return showToast('Open a folder first, then watch it.');
    const watched = [...(state.settings.watchedFolders || [])];
    const index = watched.findIndex((entry) => entry.path === state.currentDirectory);
    if (index >= 0) watched.splice(index, 1); else watched.unshift({ path: state.currentDirectory, pattern: '*' });
    state.settings = await window.jarvis.saveSettings({ watchedFolders: watched.slice(0, 6) });
    $('file-watch').classList.toggle('active', index < 0);
    showToast(index >= 0 ? 'Stopped watching this folder.' : 'Watching this folder. You will get a notification when files change.');
  });
  $('approval-deny').addEventListener('click', () => resolveApproval(false));
  $('approval-accept').addEventListener('click', () => resolveApproval(true));

  window.jarvis.onWakeDetected(() => {
    if (diagnostics.wakeTimer) return finishWakeTest(true);
    startRecording('wake');
  });
  window.jarvis.onVoiceSetupProgress(({ line }) => {
    $('diag-repair').disabled = true;
    $('diag-repair').textContent = 'INSTALLING…';
    $('diagnostic-result').textContent = line;
    $('local-voice-detail').textContent = line;
  });
  window.jarvis.onVoiceSetupDone(({ ok, message }) => {
    $('diag-repair').disabled = false;
    $('diag-repair').textContent = 'REPAIR VOICE';
    $('diagnostic-result').textContent = message;
    showToast(message, 6000);
    if (ok) setTimeout(refreshDiagnostics, 2400);
  });
  window.jarvis.onWakeStatus(renderVoiceStatus);
  window.jarvis.onOllamaStatus(renderOllamaStatus);
  window.jarvis.onTasksChanged(renderTasks);
  window.jarvis.onFileStart((payload) => { if (!state.searchActive) startSearchExperience(payload.query); $('scan-label').textContent = 'SCANNING APPROVED LOCATIONS'; });
  window.jarvis.onFileProgress((payload) => { $('scan-path').textContent = payload.directory; $('scan-counter').textContent = `${payload.scannedFolders} FOLDERS · ${payload.scannedItems} ITEMS`; });
  window.jarvis.onFileMatch((payload) => { $('scan-label').textContent = 'POSSIBLE MATCH DETECTED'; if (payload.file) { state.searchResults = [payload.file, ...state.searchResults.filter((item) => item.path !== payload.file.path)].slice(0, 30); renderFileRows(state.searchResults, true); } });
  window.jarvis.onFileComplete((payload) => { $('scan-counter').textContent = `${payload.scannedFolders} FOLDERS · ${payload.files.length} MATCHES`; renderFileRows(payload.files, true); });
}

async function initialize() {
  bindEvents(); bindModuleLayout(); setCoreState('processing', 'LOCAL BOOT SEQUENCE');
  try {
    const bootstrap = await window.jarvis.bootstrap();
    state.settings = bootstrap.settings;
    state.tasks = bootstrap.tasks;
    state.memories = bootstrap.memories;
    state.activity = bootstrap.recentActivity;
    state.hiddenModules = [...(state.settings.hiddenModules || [])];
    // Mutate, never reassign: the layout engine holds a reference to this object.
    Object.assign(state.layout, JSON.parse(JSON.stringify(state.settings.moduleLayout || {})));
    state.voiceStatus = bootstrap.voiceStatus;
    state.cloudConfigured = Boolean(bootstrap.cloudConfigured);
    $('app-version').textContent = `VERSION ${bootstrap.version}`;
    renderModuleVisibility(); renderTasks(); renderMemories(); renderActivity(); renderTelemetry(bootstrap.telemetry); renderVoiceStatus(state.voiceStatus);
    setResponse(`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, ${state.settings.profileName || 'User'}. Your private local assistant is online.`);
    $('system-status').textContent = 'LOCAL CORE ONLINE'; $('status-dot').style.background = '#61efb2'; setCoreState('ready');
    connectOllama();
  } catch (error) {
    setResponse(friendlyError(error)); setCoreState('error', 'LOCAL BOOT NEEDS ATTENTION');
  }
  setInterval(async () => { try { renderTelemetry(await window.jarvis.telemetry()); } catch {} }, 4000);
}

window.addEventListener('DOMContentLoaded', initialize);
