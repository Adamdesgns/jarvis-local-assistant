// The face's brain-stem: pull one snapshot over hud:data, render every panel,
// and refresh when the underlying stores announce a change. Commands from the
// deck or the console line go through the same command:submit pipeline as the
// voice, so the HUD is a viewport onto JARVIS, never a second JARVIS.
(() => {
  const $ = (id) => document.getElementById(id);

  // The deck mirrors the first five skills; vault contributes two verbs.
  const DECK = [
    { label: 'METRICS PULL', phrase: 'metrics pull' },
    { label: 'INBOX BRIEF', phrase: 'inbox brief' },
    { label: 'TREND SCAN', phrase: 'trend scan' },
    { label: 'PLAN TODAY', phrase: 'plan today' },
    { label: 'VAULT STATS', phrase: 'vault stats' },
    { label: 'CLOSE THE DAY', phrase: 'close the day' }
  ];

  let busy = false;

  function tickClock() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    $('clock').textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    $('clock-seconds').textContent = `:${pad(now.getSeconds())}`;
    $('clock-date').textContent = new Intl.DateTimeFormat([], { weekday: 'short', month: 'short', day: 'numeric' })
      .format(now).toUpperCase();
  }

  function row(key, value, tone = '') {
    const div = document.createElement('div');
    div.className = 'row';
    const k = document.createElement('span');
    k.className = 'k';
    k.textContent = key;
    const v = document.createElement('span');
    v.className = `v ${tone}`.trim();
    v.textContent = value;
    div.append(k, v);
    return div;
  }

  function setChip(id, label, on, detail) {
    const chip = $(id);
    chip.textContent = `${label} · ${detail}`;
    chip.className = `chip ${on ? 'on' : 'off'}`;
  }

  function renderVitals(data) {
    const rows = $('vitals-rows');
    rows.replaceChildren(
      row('OPEN TASKS', String(data.vitals.tasks.open), data.vitals.tasks.open ? '' : 'good'),
      row('OVERDUE', String(data.vitals.tasks.overdue), data.vitals.tasks.overdue ? 'hot' : 'good'),
      row('DONE TODAY', String(data.vitals.doneToday), data.vitals.doneToday ? 'good' : ''),
      row('MEMORIES', String(data.vitals.memories)),
      row('UPTIME', `${data.vitals.uptimeHours}h`),
      row('MEM IN USE', `${data.vitals.memUsedGb} GB`)
    );
    const vault = $('vault-rows');
    vault.replaceChildren(
      row('RAW', String(data.vitals.vault.raw)),
      row('WIKI', String(data.vitals.vault.wiki)),
      row('SHIPPED', String(data.vitals.vault.outputs)),
      row('LINKS', String(data.vitals.vault.links))
    );
    const feed = $('vault-feed');
    feed.replaceChildren();
    if (!data.vaultRecent.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Vault empty — say "vault capture" plus a thought.';
      feed.append(empty);
    }
    for (const note of data.vaultRecent) {
      const line = document.createElement('div');
      line.className = 'vault-note';
      const folder = document.createElement('span');
      folder.className = 'folder';
      folder.textContent = note.folder.toUpperCase();
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = note.name;
      line.append(folder, name);
      feed.append(line);
    }
    $('foot-version').textContent = `v${data.vitals.version}`;
  }

  function renderSchedule(data) {
    const box = $('schedule');
    box.replaceChildren();
    const items = [...data.schedule].sort((a, b) => a.when.time.localeCompare(b.when.time));
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No schedules yet — add one in the main window.';
      box.append(empty);
      return;
    }
    const now = new Date();
    const nowKey = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    let nextMarked = false;
    for (const item of items) {
      const line = document.createElement('div');
      const past = item.when.time < nowKey;
      line.className = `sched-item${past ? ' past' : ''}`;
      if (!past && !nextMarked) { line.classList.add('next'); nextMarked = true; }
      const time = document.createElement('span');
      time.className = 'time';
      time.textContent = item.when.time;
      const name = document.createElement('span');
      name.textContent = item.name;
      line.append(time, name);
      box.append(line);
    }
  }

  function renderAudio(data) {
    const stt = data.voice || {};
    const tts = data.tts || {};
    const sttOn = Boolean(stt.running);
    const ttsOn = Boolean(tts.workerReady && tts.modelReady);
    $('audio-rows').replaceChildren(
      row('STT ENGINE', stt.installed ? (sttOn ? 'ONLINE' : 'STOPPED') : 'NOT INSTALLED', sttOn ? 'good' : 'hot'),
      row('WAKE WORD', stt.wakeReady ? 'LISTENING' : 'STANDBY', stt.wakeReady ? 'good' : ''),
      row('TTS VOICE', ttsOn ? (tts.voice || 'READY').toUpperCase() : 'SYSTEM FALLBACK', ttsOn ? 'good' : ''),
      row('PUSH TO TALK', 'HOLD SPACE IN MAIN WINDOW')
    );
    setChip('chip-core', 'CORE', true, 'ONLINE');
    setChip('chip-stt', 'EARS', sttOn, sttOn ? (stt.wakeReady ? 'ALIVE' : 'WARM') : 'OFF');
    setChip('chip-tts', 'MOUTH', ttsOn, ttsOn ? 'READY' : 'FALLBACK');
  }

  function renderActivity(data) {
    const box = $('activity');
    box.replaceChildren();
    if (!data.activity.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Quiet so far.';
      box.append(empty);
    }
    for (const entry of data.activity) {
      const line = document.createElement('div');
      line.className = 'activity-line';
      const source = document.createElement('b');
      source.textContent = `[${entry.source || entry.type || 'log'}] `;
      line.append(source, document.createTextNode(entry.command || entry.response || ''));
      box.append(line);
    }
  }

  async function refresh() {
    try {
      const data = await window.jarvis.hud.data();
      renderVitals(data);
      renderSchedule(data);
      renderAudio(data);
      renderActivity(data);
    } catch { /* main process not ready yet — the next tick retries */ }
  }

  function consoleLine(text, cls = '') {
    const box = $('console');
    const line = document.createElement('div');
    line.className = `console-line ${cls}`.trim();
    line.textContent = text;
    box.append(line);
    while (box.children.length > 80) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }

  async function submit(phrase) {
    if (busy || !phrase) return;
    busy = true;
    $('deck-state').textContent = 'RUNNING';
    for (const button of document.querySelectorAll('.deck button')) button.disabled = true;
    consoleLine(`> ${phrase}`, 'you');
    try {
      const result = await window.jarvis.submitCommand(phrase, 'general');
      consoleLine(result?.response || '(no reply)', result?.success === false ? 'err' : '');
    } catch (error) {
      consoleLine(`Something broke: ${error.message}`, 'err');
    }
    busy = false;
    $('deck-state').textContent = 'IDLE';
    for (const button of document.querySelectorAll('.deck button')) button.disabled = false;
    refresh();
  }

  function buildDeck() {
    const deck = $('deck');
    for (const entry of DECK) {
      const button = document.createElement('button');
      button.textContent = entry.label;
      button.addEventListener('click', () => submit(entry.phrase));
      deck.append(button);
    }
  }

  $('console-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = $('console-text');
    const phrase = input.value.trim();
    input.value = '';
    submit(phrase);
  });

  $('hud-close').addEventListener('click', () => window.close());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') window.close();
  });

  buildDeck();
  tickClock();
  setInterval(tickClock, 1000);
  refresh();
  setInterval(refresh, 30000);
  window.jarvis.onTasksChanged(() => refresh());
  window.jarvis.schedule.onChanged(() => refresh());
  window.jarvis.onWakeStatus(() => refresh());
  window.jarvis.onTtsStatus(() => refresh());
})();
