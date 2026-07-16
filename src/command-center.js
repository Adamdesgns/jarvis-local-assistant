// Command Center view module. A self-contained second skin that paints the
// #cc-root dashboard from the SAME live data renderer.js uses (window.jarvis
// IPC + the shared `state`). Only ever visible when body[data-skin] selects it;
// hidden, its updates touch display:none DOM and cost almost nothing.
(function () {
  const el = (id) => document.getElementById(id);
  const isActive = () => document.body.dataset.skin === 'command-center';
  let started = false;

  function updateClock() {
    const now = new Date();
    const t = el('cc-time'), d = el('cc-date');
    if (t) t.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (d) d.textContent = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
  }

  function buildWaveform() {
    const wf = el('cc-waveform');
    if (!wf || wf.childElementCount) return;
    for (let i = 0; i < 40; i += 1) { const bar = document.createElement('i'); bar.style.setProperty('--i', i); wf.appendChild(bar); }
  }

  function setMeter(name, pct) {
    const value = Math.max(0, Math.min(100, Number(pct) || 0));
    const meter = el(`cc-meter-${name}`);
    if (meter) meter.style.setProperty('--value', `${Math.round(value * 3.6)}deg`);
    const label = el(`cc-${name}`);
    if (label) label.innerHTML = `${Math.round(value)}<small>%</small>`;
  }

  function renderPerf(data) {
    if (!data) return;
    const cpu = Number(data.cpu) || 0;
    const ram = Number(data.memory) || 0;
    setMeter('cpu', cpu);
    setMeter('ram', ram);
    // GPU load isn't measured by the app; show the device name, leave the meter blank.
    const gpuLabel = el('cc-gpu'); if (gpuLabel) gpuLabel.innerHTML = '—';
    const gpuName = el('cc-gpu-name'); if (gpuName) gpuName.textContent = data.gpu || '—';
    const hours = Math.floor((data.uptime || 0) / 3600);
    const up = el('cc-uptime'); if (up) up.textContent = `${hours} HRS`;
    const cpuTop = el('cc-cpu-top'); if (cpuTop) cpuTop.textContent = `${Math.round(cpu)}%`;
    const memTop = el('cc-mem-top'); if (memTop) memTop.textContent = `${Math.round(ram)}%`;
    const gpuTop = el('cc-gpu-top'); if (gpuTop) gpuTop.textContent = '—';
  }

  function renderTasks(tasks) {
    const box = el('cc-tasks');
    if (!box) return;
    box.replaceChildren();
    const list = (tasks || []).filter((t) => t.status !== 'done').slice(0, 6);
    if (!list.length) { box.innerHTML = '<p class="cc-empty">Nothing pending.</p>'; return; }
    for (const task of list) {
      const row = document.createElement('label');
      row.className = 'task';
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = task.status === 'done';
      check.addEventListener('change', async () => {
        await window.jarvis.tasks.update(task.id, { status: check.checked ? 'done' : 'open' });
        renderTasks(await window.jarvis.tasks.list());
      });
      const span = document.createElement('span'); span.textContent = task.title;
      const time = document.createElement('small');
      time.textContent = task.dueAt ? new Date(task.dueAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : (task.project || '').toUpperCase();
      row.append(check, span, time);
      box.append(row);
    }
  }

  function renderProjects(projects) {
    const box = el('cc-projects');
    if (!box) return;
    box.replaceChildren();
    const entries = Object.entries(projects || {});
    if (!entries.length) { box.innerHTML = '<p class="cc-empty">No workspaces set.</p>'; return; }
    for (const [name, path] of entries) {
      const button = document.createElement('button');
      button.className = 'project';
      button.type = 'button';
      const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
      const icon = document.createElement('i'); icon.textContent = initials;
      const copy = document.createElement('span');
      const b = document.createElement('b'); b.textContent = name.toUpperCase();
      const small = document.createElement('small'); small.textContent = path ? path : 'No folder assigned';
      copy.append(b, small);
      const em = document.createElement('em'); em.textContent = path ? 'OPEN' : '—';
      button.append(icon, copy, em);
      if (path) button.addEventListener('click', () => window.jarvis.openPath(path));
      box.append(button);
    }
  }

  function renderActivity(items) {
    const box = el('cc-activity');
    if (!box) return;
    box.replaceChildren();
    const list = (items || []).slice(0, 6);
    if (!list.length) { box.innerHTML = '<p class="cc-empty">No commands logged.</p>'; return; }
    list.forEach((item, index) => {
      const row = document.createElement('div');
      const dot = document.createElement('i'); if (index === 0) dot.className = 'hot';
      const copy = document.createElement('span');
      const b = document.createElement('b'); b.textContent = item.command || item.type || 'Activity';
      const small = document.createElement('small');
      small.textContent = `${item.source || 'local'} · ${item.timestamp ? new Date(item.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}`;
      copy.append(b, small); row.append(dot, copy); box.append(row);
    });
  }

  // Drive the whole Command Center colour + labels from the app's real state.
  function setJarvisState(jarvisState) {
    const map = window.JarvisSkins.mapState(jarvisState);
    const root = el('cc-root');
    if (root) root.style.setProperty('--state', map.color);
    const label = el('cc-state'); if (label) label.textContent = map.ccState;
    const message = el('cc-state-message'); if (message) message.textContent = map.message;
    const core = el('cc-core'); if (core) core.className = map.ccState.toLowerCase();
    const wf = el('cc-waveform'); if (wf) wf.classList.toggle('active', map.ccState !== 'STANDBY' && map.ccState !== 'OFFLINE');
  }

  function setResponse(text) {
    const message = el('cc-state-message');
    if (message && text) message.textContent = text;
  }

  async function refreshAll() {
    try { renderPerf(await window.jarvis.telemetry()); } catch {}
    try { renderTasks(await window.jarvis.tasks.list()); } catch {}
    try { renderActivity(await window.jarvis.recentActivity(20)); } catch {}
    // Projects come from the shared renderer state (loaded at bootstrap).
    try { renderProjects((typeof state !== 'undefined' && state.settings && state.settings.projects) || {}); } catch {}
  }

  function init() {
    if (started) return;
    started = true;
    buildWaveform();
    updateClock();
    setInterval(updateClock, 1000);
    // Live telemetry only while the Command Center is the visible skin.
    setInterval(async () => { if (isActive()) { try { renderPerf(await window.jarvis.telemetry()); } catch {} } }, 4000);
    window.jarvis.onTasksChanged((tasks) => renderTasks(tasks));
  }

  function activate() { refreshAll(); }

  window.JarvisCommandCenter = { init, activate, setJarvisState, setResponse, renderTasks, renderActivity, renderProjects };
})();
