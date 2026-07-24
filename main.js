const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const {
  app, BrowserWindow, ipcMain, dialog, shell, safeStorage, session,
  Menu, clipboard, Tray, nativeImage, Notification, screen, systemPreferences, desktopCapturer, powerMonitor
} = require('electron');
const { ConfigStore } = require('./core/config-store');
const { ActivityLog } = require('./core/activity-log');
const { CrashLog, installProcessHandlers } = require('./core/crash-log');
const { MemoryStore } = require('./core/memory-store');
const { TaskStore } = require('./core/task-store');
const { ToolService } = require('./core/tool-service');
const { DocumentService } = require('./core/document-service');
const { AIService } = require('./core/ai-service');
const { OllamaService } = require('./core/ollama-service');
const { LocalVoiceService } = require('./core/local-voice-service');
const { Go2RtcManager } = require('./core/camera/go2rtc-manager');
const { CameraService } = require('./core/camera/camera-service');
const { FolderWatchService } = require('./core/folder-watch');
const { AutonomyService } = require('./core/autonomy-service');
const { checkForUpdate } = require('./core/update-check');
const updateRepo = require('./package.json').updateRepo || '';
const { buildToolRegistry } = require('./core/tool-registry');
const { CommandRouter } = require('./core/router');
const { ClaudeBridge, createTranscript } = require('./core/claude-bridge');
const { ScreenReader } = require('./core/screen-reader');
const { ScreenHands } = require('./core/screen-drive-session');
const { ScreenDriver } = require('./core/screen-driver');
const { ORB_DEFAULT, ZOOM_MAX, clampToWorkArea, resizeOutcome, zoomOutcome, defaultOrbBounds } = require('./core/orb-bounds');
const { MobileServer } = require('./core/mobile-server');
const { MobileAuth } = require('./core/mobile-auth');
const { ScheduleStore } = require('./core/schedule-store');
const { ScheduleService } = require('./core/schedule-service');
const QRCode = require('qrcode');

// Chromium's native Windows window-occlusion tracker is a separate mechanism
// from Electron's per-window `backgroundThrottling` option (already false on
// both windows below): it independently marks a window "occluded" whenever
// another window fully covers it on screen — e.g. File Explorer maximized on
// top of JARVIS — and that occlusion signal is what silently pauses/stalls
// in-flight work like SpeechSynthesis. `backgroundThrottling:false` only
// disables JS timer/animation throttling and does not stop this. Must be set
// before the app is ready.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

// Last-resort safety net: an error nothing else caught is written to
// crash.log beside the rest of the user data instead of silently killing the
// app. Renderer windows report their escaped errors into the same log.
const crashLog = new CrashLog(app.getPath('userData'));
installProcessHandlers(process, crashLog);
ipcMain.on('crash:renderer-error', (_event, info) => {
  crashLog.record(`renderer:${(info && info.source) || 'window'}`, info);
});

let mainWindow;
let widgetWindow;
let tray;
let isQuitting = false;
let config;
let log;
let memory;
let tasks;
let tools;
let documents;
let ai;
let ollama;
let localVoice;
let folderWatch;
let router;
let claudeBridge;
let screenReader;
let hands;
let driveStopWindow;
let go2rtc;
let cameras;
let autonomy;
let mobileAuth;
let mobileServer;
let scheduleStore;
let scheduleService;
let currentSkin = 'classic';
let gpuLabel = 'RTX 5060 · 8 GB';
let previousCpu = null;

const captureMode = Boolean(process.env.JARVIS_CAPTURE_PATH);
const gotLock = captureMode ? true : app.requestSingleInstanceLock();
if (!gotLock) app.quit();

function sendEverywhere(channel, payload) {
  for (const window of [mainWindow, widgetWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
  }
}

// A short human phrase for one agent step, shown live as JARVIS works.
function summarizeAgentStep(step) {
  const args = step.args || {};
  switch (step.tool) {
    case 'search_files': return `Searching files${args.query ? `: “${args.query}”` : ''}…`;
    case 'read_file': return `Reading ${args.path ? path.basename(String(args.path)) : 'a file'}…`;
    case 'add_task': return `Adding task${args.title ? `: “${args.title}”` : ''}…`;
    case 'remember_note': return 'Saving a note…';
    case 'search_memory': return 'Searching your notes…';
    case 'list_open_tasks': return 'Checking your tasks…';
    case 'open_application': return `Opening ${args.name || 'an app'}…`;
    case 'get_current_datetime': return 'Checking the time…';
    default: return `Working: ${step.tool}…`;
  }
}

app.on('second-instance', () => restoreMainWindow());

function editableContextMenu(window, params) {
  if (!params.isEditable && !params.selectionText) return;
  const template = [];
  if (params.isEditable) {
    template.push(
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
      { role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }
    );
  } else {
    template.push({ role: 'copy' }, { role: 'selectAll' });
  }
  Menu.buildFromTemplate(template).popup({ window });
}

function attachEditingShortcuts(window) {
  window.webContents.on('context-menu', (_event, params) => editableContextMenu(window, params));
  window.webContents.on('before-input-event', (event, input) => {
    if (!(input.control || input.meta) || input.type !== 'keyDown') return;
    const commands = {
      c: 'copy', v: 'paste', x: 'cut', a: 'selectAll', z: input.shift ? 'redo' : 'undo', y: 'redo'
    };
    const command = commands[input.key.toLowerCase()];
    if (!command || typeof window.webContents[command] !== 'function') return;
    event.preventDefault();
    window.webContents[command]();
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    frame: false,
    backgroundColor: '#02070b',
    title: 'JARVIS',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  attachEditingShortcuts(mainWindow);
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });
  mainWindow.on('minimize', (event) => {
    if (config.getSettings().minimizeToOrb) {
      event.preventDefault();
      showOrb();
    }
  });
  mainWindow.on('close', (event) => {
    if (!isQuitting && !captureMode) {
      event.preventDefault();
      showOrb();
    }
  });

  if (process.env.JARVIS_CAPTURE_PATH) {
    mainWindow.webContents.once('did-finish-load', async () => {
      await new Promise((resolve) => setTimeout(resolve, 1600));
      const image = await mainWindow.webContents.capturePage();
      fs.writeFileSync(process.env.JARVIS_CAPTURE_PATH, image.toPNG());
      isQuitting = true;
      app.quit();
    });
  }
}

function orbWorkArea(bounds) {
  const display = screen.getDisplayMatching({ x: Math.round(bounds.x), y: Math.round(bounds.y), width: bounds.size, height: bounds.size });
  return display.workArea;
}

function currentOrbBounds() {
  const [x, y] = widgetWindow.getPosition();
  const [size] = widgetWindow.getSize();
  return { x, y, size };
}

let orbSaveTimer = null;
function persistOrbBounds() {
  clearTimeout(orbSaveTimer);
  orbSaveTimer = setTimeout(() => {
    if (!widgetWindow || widgetWindow.isDestroyed()) return;
    try { config.updateSettings({ orbBounds: currentOrbBounds() }); } catch {}
  }, 400);
}

// --- The STOP window -------------------------------------------------------
// A tiny always-on-top window owned by main that exists only while JARVIS is
// driving the screen. It is one of three simultaneous signals (window, orb
// state, audio cue) and the one that doubles as a kill switch. If its renderer
// dies or the window vanishes while a session is live, the session aborts —
// no visible stop button, no driving.
function openDriveStopWindow(onStop, onLost) {
  closeDriveStopWindow();
  const { workArea } = screen.getPrimaryDisplay();
  driveStopWindow = new BrowserWindow({
    width: 380,
    height: 76,
    x: workArea.x + workArea.width - 396,
    y: workArea.y + 16,
    frame: false,
    transparent: true,
    resizable: false,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-stop.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });
  // 'screen-saver' outranks ordinary always-on-top windows, so nothing JARVIS
  // is driving can cover the stop button.
  driveStopWindow.setAlwaysOnTop(true, 'screen-saver');
  driveStopWindow.loadFile(path.join(__dirname, 'src', 'stop.html'));
  driveStopWindow.once('ready-to-show', () => {
    if (driveStopWindow && !driveStopWindow.isDestroyed()) driveStopWindow.showInactive();
  });
  driveStopWindow.webContents.on('render-process-gone', () => onLost?.());
  driveStopWindow.on('closed', () => {
    driveStopWindow = null;
    onLost?.();
  });
}

function updateDriveStopWindow(text) {
  if (driveStopWindow && !driveStopWindow.isDestroyed()) {
    driveStopWindow.webContents.send('drive:step', { text });
  }
}

function closeDriveStopWindow() {
  const window = driveStopWindow;
  driveStopWindow = null;
  if (window && !window.isDestroyed()) window.destroy();
}

function createWidgetWindow() {
  if (widgetWindow && !widgetWindow.isDestroyed()) return widgetWindow;
  const { workArea } = screen.getPrimaryDisplay();
  const saved = config?.getSettings().orbBounds;
  const wanted = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)
    ? { x: saved.x, y: saved.y, size: saved.size || ORB_DEFAULT }
    : defaultOrbBounds(workArea);
  // Clamp against whichever display the saved spot is nearest — monitors change.
  const bounds = clampToWorkArea(wanted, orbWorkArea(wanted));
  widgetWindow = new BrowserWindow({
    width: bounds.size,
    height: bounds.size,
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    transparent: true,
    frame: false,
    resizable: false,
    show: false,
    skipTaskbar: false,
    alwaysOnTop: config?.getSettings().orbAlwaysOnTop !== false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });
  widgetWindow.loadFile(path.join(__dirname, 'src', 'widget.html'));
  widgetWindow.webContents.on('did-finish-load', () => {
    if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.webContents.send('ui:skin', currentSkin);
  });
  attachEditingShortcuts(widgetWindow);
  widgetWindow.on('close', (event) => {
    if (!isQuitting) { event.preventDefault(); widgetWindow.hide(); }
  });
  return widgetWindow;
}

function showOrb() {
  mainWindow?.hide();
  const widget = createWidgetWindow();
  widget.showInactive();
}

function restoreMainWindow() {
  widgetWindow?.hide();
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')).resize({ width: 24, height: 24 });
  tray = new Tray(icon);
  tray.setToolTip('JARVIS — Local Assistant');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open JARVIS', click: restoreMainWindow },
    { label: 'Show Floating Orb', click: showOrb },
    { type: 'separator' },
    { label: 'Exit JARVIS', click: () => { isQuitting = true; app.quit(); } }
  ]));
  tray.on('double-click', restoreMainWindow);
}

function isAllowedPath(target) {
  let resolved;
  try { resolved = path.resolve(target); } catch { return false; }
  const settings = config.getSettings();
  const roots = [...(settings.searchRoots || []), ...Object.values(settings.projects || {}).filter(Boolean)];
  return roots.some((root) => {
    const base = path.resolve(root);
    return resolved === base || resolved.startsWith(`${base}${path.sep}`);
  });
}

function cpuPercent() {
  const current = os.cpus().map((cpu) => cpu.times);
  if (!previousCpu) { previousCpu = current; return 8; }
  let idle = 0;
  let total = 0;
  current.forEach((times, index) => {
    const prior = previousCpu[index];
    const currentTotal = Object.values(times).reduce((sum, value) => sum + value, 0);
    const priorTotal = Object.values(prior).reduce((sum, value) => sum + value, 0);
    idle += times.idle - prior.idle;
    total += currentTotal - priorTotal;
  });
  previousCpu = current;
  return total ? Math.round((1 - idle / total) * 100) : 0;
}

async function collectTelemetry() {
  const total = os.totalmem();
  const used = total - os.freemem();
  return {
    cpu: cpuPercent(),
    memory: Math.round((used / total) * 100),
    memoryUsedGb: (used / (1024 ** 3)).toFixed(1),
    memoryTotalGb: (total / (1024 ** 3)).toFixed(0),
    gpu: gpuLabel,
    platform: `${os.type()} ${os.release()}`,
    uptime: os.uptime()
  };
}

function packagedScript(name) {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'scripts', name)
    : path.join(__dirname, 'scripts', name);
}

function voiceDataRoot() {
  return path.join(app.getPath('userData'), 'voice');
}

let voiceSetupChild = null;

function runLocalVoiceSetup() {
  if (process.platform !== 'win32') return { started: false, message: 'Local voice setup runs on Windows.' };
  if (voiceSetupChild) return { started: false, message: 'The voice installer is already running. Watch its progress below.' };
  const scriptPath = packagedScript('setup-local-voice.ps1');
  const child = spawn('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath,
    '-DataRoot', voiceDataRoot(), '-SourceRoot', path.dirname(scriptPath), '-NoPause'
  ], {
    cwd: app.getPath('userData'),
    windowsHide: true
  });
  voiceSetupChild = child;
  const forward = (chunk) => {
    const line = String(chunk).split('\n').map((item) => item.trim()).filter(Boolean).pop();
    if (line) sendEverywhere('voice:setup-progress', { line });
  };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', forward);
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', forward);
  child.on('error', (error) => {
    voiceSetupChild = null;
    sendEverywhere('voice:setup-done', { ok: false, message: `The installer could not start: ${error.message}` });
  });
  child.on('close', (code) => {
    voiceSetupChild = null;
    const ok = code === 0;
    sendEverywhere('voice:setup-done', {
      ok,
      message: ok
        ? 'Local voice is installed. Starting the voice service…'
        : `The installer stopped with an error (code ${code}). Copy the diagnostic report for details.`
    });
    if (ok) {
      localVoice.stop();
      setTimeout(() => {
        localVoice.start();
        sendEverywhere('voice:status', localVoice.getStatus());
      }, 1700);
    }
  });
  return { started: true, message: 'Installing local voice. Progress appears below — no window to babysit.' };
}

function applyLoginSetting(enabled) {
  const options = { openAtLogin: Boolean(enabled) };
  if (!app.isPackaged) {
    options.path = process.execPath;
    options.args = [__dirname];
  }
  app.setLoginItemSettings(options);
}

function loadMobileDevices() {
  try { return JSON.parse(config.getSecret('mobileDevices') || '[]'); } catch { return []; }
}
function saveMobileDevices() { config.setSecret('mobileDevices', JSON.stringify(mobileAuth.toJSON())); }

async function syncMobileServer() {
  const settings = config.getSettings();
  mobileServer.stop();
  if (settings.mobileEnabled) await mobileServer.start();
  sendEverywhere('mobile:status', mobileServer.status());
}

// Fan the camera alert out to every paired phone over SSE. Deliberately
// drops the base64 JPEG — SSE frames are line-based text and a multi-hundred
// KB blob in one frame is a bad idea; the phone fetches the still itself via
// GET /api/cameras/snapshot. Called before mobileServer/mobileAuth exist
// (camera alerts can't fire before cameras.init(), which happens after both
// are constructed further down in app.whenReady), but is defensive anyway
// since it fires from an event callback, not construction order.
function pushCameraAlertToPhones({ key, kind, name, body, at }) {
  if (!mobileServer || !mobileAuth) return;
  for (const device of mobileAuth.listDevices()) {
    mobileServer.pushEvent(device.id, 'camera-alert', { key, kind, name, body, at });
  }
}

function setupIpc() {
  ipcMain.handle('bootstrap', async () => ({
    settings: config.publicSettings(),
    telemetry: await collectTelemetry(),
    recentActivity: log.recent(12),
    memories: memory.list(20),
    tasks: tasks.list(),
    taskSummary: tasks.summary(),
    voiceStatus: localVoice.getStatus(),
    cloudConfigured: Boolean(config.getSecret('openaiKey')),
    anthropicConfigured: Boolean(config.getSecret('anthropicKey')),
    version: app.getVersion()
  }));
  ipcMain.handle('telemetry', collectTelemetry);
  ipcMain.handle('command:submit', (_event, payload) => {
    const text = typeof payload === 'string' ? payload : payload?.text;
    const project = typeof payload === 'object' && payload ? payload.project : 'general';
    return router.handle(text, project, {
      onChunk: (piece) => sendEverywhere('ai:stream', { piece }),
      onReset: () => sendEverywhere('ai:stream-reset', {}),
      onStep: (step) => sendEverywhere('agent:step', { index: step.index, tool: step.tool, summary: summarizeAgentStep(step) })
    });
  });
  // One cancel to stop everything: the brain mid-thought AND the hands
  // mid-step. Escape, the orb stop button and a spoken "stop" all land here.
  ipcMain.on('ai:cancel', () => {
    ai.cancel();
    hands?.abortActive('user-interrupt');
  });
  ipcMain.on('screen:drive-stop', () => hands?.abortActive('stop-button'));
  ipcMain.handle('approval:resolve', (_event, payload) => router.resolveApproval(payload.id, Boolean(payload.approved)));
  ipcMain.handle('activity:recent', (_event, limit) => log.recent(Math.min(100, Number(limit) || 20)));
  ipcMain.handle('voice:transcribe', (_event, payload) => localVoice.transcribe(Buffer.from(payload.bytes), payload.mimeType));
  ipcMain.handle('voice:status', () => localVoice.getStatus());
  ipcMain.handle('voice:diagnose', async () => {
    const diagnostic = await localVoice.diagnose();
    let micPermission = 'unknown';
    try { micPermission = systemPreferences.getMediaAccessStatus('microphone'); } catch {}
    return { ...diagnostic, micPermission, appVersion: app.getVersion() };
  });
  ipcMain.handle('voice:setup', () => runLocalVoiceSetup());
  ipcMain.handle('voice:restart', () => { localVoice.stop(); setTimeout(() => localVoice.start(), 1700); return { ok: true }; });
  ipcMain.handle('mobile:status', () => mobileServer.status());
  ipcMain.handle('mobile:devices', () => mobileAuth.listDevices());
  ipcMain.handle('mobile:revoke', (_event, id) => { const ok = mobileAuth.revoke(id); if (ok) saveMobileDevices(); return { ok }; });
  ipcMain.handle('mobile:pair', async () => {
    const status = mobileServer.status();
    if (!status.running) return { ok: false, reason: status.reason || 'Turn the mobile toggle on first.' };
    const { code, expiresAt } = mobileAuth.startPairing();
    const publicUrl = String(config.getSettings().mobilePublicUrl || '').trim().replace(/\/+$/, '');
    const url = publicUrl ? `${publicUrl}/` : `http://${status.address}:${status.port}/`;
    const qrUrl = `${url}#${code}`;
    const qr = await QRCode.toDataURL(qrUrl, { margin: 1, width: 240 });
    return { ok: true, code, url, qr, expiresAt };
  });
  ipcMain.handle('schedule:list', () => scheduleStore.list());
  ipcMain.handle('schedule:add', (_event, input) => {
    try {
      const item = scheduleStore.add(input);
      scheduleService.arm();
      sendEverywhere('schedule:changed', scheduleStore.list());
      return { ok: true, item };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  ipcMain.handle('schedule:update', (_event, { id, patch }) => {
    try {
      const item = scheduleStore.update(id, patch);
      scheduleService.arm();
      sendEverywhere('schedule:changed', scheduleStore.list());
      return { ok: true, item };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  ipcMain.handle('schedule:remove', (_event, id) => {
    try {
      const removed = scheduleStore.remove(id);
      scheduleService.arm();
      sendEverywhere('schedule:changed', scheduleStore.list());
      return { ok: removed };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  ipcMain.handle('schedule:runNow', async (_event, id) => {
    try {
      const result = await scheduleService.runNow(id);
      scheduleService.arm();
      sendEverywhere('schedule:changed', scheduleStore.list());
      return result;
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  ipcMain.handle('ollama:connect', () => ollama.connect());
  ipcMain.handle('ollama:status', () => ollama.serverStatus());
  ipcMain.handle('openai:save-key', async (_event, key) => {
    const value = String(key || '').trim();
    if (!value) return { ok: false, message: 'Paste an OpenAI API key first.' };
    config.setSecret('openaiKey', value);
    const result = await ai.testCloud('openai');
    if (!result.ok) config.setSecret('openaiKey', '');
    return result;
  });
  ipcMain.handle('openai:remove-key', () => {
    config.setSecret('openaiKey', '');
    return { ok: true, message: 'OpenAI key removed from this computer.' };
  });
  ipcMain.handle('openai:test', () => ai.testCloud('openai'));

  ipcMain.handle('anthropic:save-key', async (_event, key) => {
    const value = String(key || '').trim();
    if (!value) return { ok: false, message: 'Paste an Anthropic API key first.' };
    config.setSecret('anthropicKey', value);
    const result = await ai.testCloud('anthropic');
    if (!result.ok) config.setSecret('anthropicKey', '');
    return result;
  });
  ipcMain.handle('anthropic:remove-key', () => {
    config.setSecret('anthropicKey', '');
    return { ok: true, message: 'Claude key removed from this computer.' };
  });
  ipcMain.handle('anthropic:test', () => ai.testCloud('anthropic'));

  ipcMain.handle('tasks:list', () => tasks.list());
  ipcMain.handle('tasks:add', (_event, input) => tasks.add(input));
  ipcMain.handle('tasks:update', (_event, { id, patch }) => tasks.update(id, patch));
  ipcMain.handle('tasks:remove', (_event, id) => tasks.remove(id));
  ipcMain.handle('memory:list', () => memory.list(100));
  ipcMain.handle('memory:add', (_event, { text, project }) => memory.add(text, project));
  ipcMain.handle('memory:update', (_event, { id, text }) => memory.update(id, text));
  ipcMain.handle('memory:remove', (_event, id) => memory.remove(id));

  ipcMain.handle('files:roots', () => config.getSettings().searchRoots || []);
  ipcMain.handle('files:home', () => {
    const settings = config.getSettings();
    return {
      roots: settings.searchRoots || [],
      pinned: (settings.pinnedFolders || []).filter((folder) => fs.existsSync(folder)),
      recent: (settings.recentFiles || []).filter((item) => fs.existsSync(item.path))
    };
  });
  ipcMain.handle('files:list', async (_event, directory) => {
    if (!isAllowedPath(directory)) throw new Error('That folder is outside your approved search locations.');
    return tools.listDirectory(directory);
  });
  ipcMain.handle('path:open', async (_event, target) => {
    if (!isAllowedPath(target)) return { ok: false, message: 'That path is outside your approved folders.' };
    return tools.openPath(target);
  });

  ipcMain.handle('settings:save', async (_event, patch) => {
    const previous = config.getSettings();
    const updated = config.updateSettings(patch);
    applyLoginSetting(updated.startWithWindows);
    if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.setAlwaysOnTop(Boolean(updated.orbAlwaysOnTop));
    if (previous.wakeWordEnabled !== updated.wakeWordEnabled || previous.localVoiceModel !== updated.localVoiceModel) {
      localVoice.stop();
      setTimeout(() => localVoice.start(), 1700);
    }
    if (JSON.stringify(previous.watchedFolders || []) !== JSON.stringify(updated.watchedFolders || [])) {
      folderWatch.start();
    }
    if (previous.mobileEnabled !== updated.mobileEnabled || previous.mobilePort !== updated.mobilePort) syncMobileServer();
    if (previous.schedulesEnabled !== updated.schedulesEnabled) {
      scheduleService.start().catch((error) => {
        log.write({ type: 'schedule-error', command: 'settings-save-start', response: error && error.message ? error.message : String(error), source: 'schedule' });
      });
    }
    return updated;
  });
  ipcMain.handle('update:check', () => checkForUpdate(app.getVersion(), updateRepo));
  ipcMain.handle('update:open', (_event, url) => shell.openExternal(String(url || `https://github.com/${updateRepo}/releases/latest`)));
  ipcMain.handle('screen:describe', async (_event, question) => {
    if (!ai.hasCloudKey()) {
      return { ok: false, message: 'Looking at your screen needs a Cloud Brain. Add a Claude or OpenAI key in Settings — the local vision model is a future option.' };
    }
    // Privacy: tell every window we are viewing the screen, before and after.
    sendEverywhere('screen:viewing', { active: true });
    log.write({ type: 'screen-view', command: question || 'look at my screen', response: 'Captured the screen for a one-time look.', source: 'vision' });
    try {
      const display = screen.getPrimaryDisplay();
      const { width, height } = display.size;
      const scale = display.scaleFactor || 1;
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) }
      });
      const primary = sources[0];
      if (!primary || primary.thumbnail.isEmpty()) return { ok: false, message: 'Windows did not return a screen image to look at.' };
      const base64 = primary.thumbnail.toPNG().toString('base64');
      const answer = await ai.describeImage(base64, question || 'Describe what is on this screen and anything that looks important.', {});
      return { ok: answer.ok !== false, message: answer.text, source: answer.source };
    } catch (error) {
      return { ok: false, message: `I could not read the screen: ${error.message}` };
    } finally {
      sendEverywhere('screen:viewing', { active: false });
    }
  });
  ipcMain.handle('backup:export', async () => {
    const stamp = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export JARVIS data',
      defaultPath: `JARVIS-backup-${stamp}.json`,
      filters: [{ name: 'JARVIS backup', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, message: 'Export cancelled.' };
    // API keys are never exported — they stay in Windows secure storage.
    const publicSettings = config.publicSettings();
    delete publicSettings.hasOpenAIKey;
    delete publicSettings.hasAnthropicKey;
    const payload = {
      app: 'JARVIS', kind: 'backup', version: app.getVersion(), exportedAt: new Date().toISOString(),
      settings: publicSettings, tasks: tasks.list(), memories: memory.list(1000)
    };
    try {
      fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf8');
      return { ok: true, message: `Saved your tasks, notes, and settings to ${path.basename(result.filePath)}. API keys were not included.`, path: result.filePath };
    } catch (error) {
      return { ok: false, message: `Could not write the backup: ${error.message}` };
    }
  });
  ipcMain.handle('backup:import', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import a JARVIS backup', properties: ['openFile'],
      filters: [{ name: 'JARVIS backup', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, message: 'Import cancelled.' };
    let payload;
    try { payload = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8')); }
    catch { return { ok: false, message: 'That file is not a readable JARVIS backup.' }; }
    if (payload?.app !== 'JARVIS' || payload.kind !== 'backup') return { ok: false, message: 'That JSON is not a JARVIS backup file.' };
    const addedTasks = tasks.importTasks(payload.tasks || []);
    const addedMemories = memory.importMemories(payload.memories || []);
    // Restore only non-secret preferences (projects, roots, routines, etc.).
    if (payload.settings) {
      const s = payload.settings;
      config.updateSettings({
        projects: s.projects, searchRoots: s.searchRoots, pinnedFolders: s.pinnedFolders,
        watchedFolders: s.watchedFolders, routines: s.routines, focusApps: s.focusApps,
        profileName: s.profileName
      });
    }
    folderWatch.start();
    return { ok: true, message: `Imported ${addedTasks} task${addedTasks === 1 ? '' : 's'} and ${addedMemories} note${addedMemories === 1 ? '' : 's'}, and restored your folders and routines.`, tasks: tasks.list(), memories: memory.list(100) };
  });
  ipcMain.handle('dialog:folder', async (_event, title) => {
    const result = await dialog.showOpenDialog(mainWindow, { title: String(title || 'Select folder'), properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? '' : result.filePaths[0];
  });
  ipcMain.handle('clipboard:read', () => clipboard.readText());
  ipcMain.handle('clipboard:write', (_event, text) => clipboard.writeText(String(text || '')));
  ipcMain.handle('external:ollama', () => shell.openExternal('https://ollama.com/download/windows'));
  ipcMain.handle('external:openai-billing', () => shell.openExternal('https://platform.openai.com/settings/organization/billing/overview'));
  ipcMain.handle('external:openai-keys', () => shell.openExternal('https://platform.openai.com/api-keys'));
  ipcMain.handle('external:anthropic-keys', () => shell.openExternal('https://console.anthropic.com/settings/keys'));

  ipcMain.handle('cameras:bootstrap', async () => ({
    accounts: cameras.listAccounts(),
    cameras: await cameras.listCameras(),
    systems: await cameras.listSystems(),
    status: cameras.getStatus()
  }));
  ipcMain.handle('cameras:add-blink', (_event, payload) => cameras.addBlinkAccount(payload || {}));
  ipcMain.handle('cameras:blink-pin', (_event, payload) => cameras.submitBlinkPin(String(payload?.accountId || ''), String(payload?.pin || '')));
  ipcMain.handle('cameras:systems', () => cameras.listSystems());
  ipcMain.handle('cameras:add-ring', (_event, payload) => cameras.addRingAccount(payload || {}));
  ipcMain.handle('cameras:live-answer', (_event, payload) => cameras.answerLiveView(String(payload?.key || ''), String(payload?.offerSdp || '')));
  ipcMain.handle('cameras:add-nest', (_event, payload) => cameras.addNestAccount(payload || {}, { openExternal: (url) => shell.openExternal(url) }));
  ipcMain.handle('external:nest-console', () => shell.openExternal('https://console.nest.google.com/device-access'));
  ipcMain.handle('cameras:describe', async (_event, key) => {
    const shot = await cameras.getSnapshot(String(key || ''), { manual: true });
    if (!shot.ok) return { ok: false, message: shot.message };
    const camera = (await cameras.listCameras()).find((item) => item.key === String(key));
    const described = await ai.describeCameraFrame(shot.jpegBase64, camera?.name || 'Camera');
    if (!described.ok) {
      return { ok: false, message: 'No vision model answered. Install one with "ollama pull gemma3:4b", or allow cloud analysis in Settings.' };
    }
    log.write({ type: 'camera', command: 'describe camera', response: described.text, source: 'cameras' });
    return { ok: true, text: described.text, jpegBase64: shot.jpegBase64 };
  });
  ipcMain.handle('cameras:set-armed', (_event, payload) => cameras.setArmed(String(payload?.key || ''), Boolean(payload?.armed)));
  ipcMain.handle('cameras:add-rtsp', (_event, payload) => cameras.addRtspAccount(payload || {}));
  ipcMain.handle('cameras:remove-account', (_event, accountId) => cameras.removeAccount(String(accountId || '')));
  ipcMain.handle('cameras:list', () => cameras.listCameras());
  ipcMain.handle('cameras:snapshot', (_event, payload) => cameras.getSnapshot(String(payload?.key || ''), { manual: Boolean(payload?.manual) }));
  ipcMain.handle('cameras:live-start', (_event, key) => cameras.openLiveView(String(key || '')));
  ipcMain.handle('cameras:live-stop', (_event, key) => cameras.closeLiveView(String(key || '')));
  ipcMain.handle('cameras:discover', () => {
    const { discoverCameras } = require('./core/camera/onvif-discovery');
    return discoverCameras({});
  });

  ipcMain.on('widget:show', showOrb);
  ipcMain.on('widget:restore', restoreMainWindow);
  // Orb drag: the widget reports gesture start/move/end; main reads the global
  // cursor so window movement stays exact regardless of renderer coordinates.
  let orbDrag = null;
  ipcMain.on('widget:drag-start', () => {
    if (!widgetWindow || widgetWindow.isDestroyed()) return;
    const [x, y] = widgetWindow.getPosition();
    orbDrag = { win: { x, y }, cursor: screen.getCursorScreenPoint() };
  });
  ipcMain.on('widget:drag-move', () => {
    if (!orbDrag || !widgetWindow || widgetWindow.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint();
    widgetWindow.setPosition(
      Math.round(orbDrag.win.x + cursor.x - orbDrag.cursor.x),
      Math.round(orbDrag.win.y + cursor.y - orbDrag.cursor.y)
    );
  });
  ipcMain.on('widget:drag-end', () => {
    orbDrag = null;
    if (!widgetWindow || widgetWindow.isDestroyed()) return;
    const clamped = clampToWorkArea(currentOrbBounds(), orbWorkArea(currentOrbBounds()));
    widgetWindow.setBounds({ x: Math.round(clamped.x), y: Math.round(clamped.y), width: clamped.size, height: clamped.size });
    persistOrbBounds();
  });
  // Orb resize: scroll wheel. Two phases —
  //  1. window-resize (ORB_MIN..screen size), 7px per tick, clamped on-screen;
  //  2. at screen size, one more scroll enters a fullscreen "zoom" where the orb
  //     keeps swelling under scroll control until the white core nearly leaves
  //     the screen, then detonates. Scrolling back down / clicking exits safely.
  // Shrinking past the minimum still vanishes.
  let orbPopping = false;   // true during the explode/vanish + respawn window
  let orbZoom = null;       // null = window mode; a number (1..ZOOM_MAX) = zoom mode
  let orbPreZoom = null;    // window bounds to restore when leaving zoom mode
  const orbScreenMax = () => { const wa = orbWorkArea(currentOrbBounds()); return Math.min(wa.width, wa.height); };

  const respawnOrb = () => {
    orbPopping = false;
    orbZoom = null;
    orbPreZoom = null;
    if (!widgetWindow || widgetWindow.isDestroyed()) return;
    widgetWindow.setIgnoreMouseEvents(false);
    const home = defaultOrbBounds(screen.getPrimaryDisplay().workArea);
    widgetWindow.setBounds({ x: home.x, y: home.y, width: home.size, height: home.size });
    widgetWindow.webContents.send('widget:pop-reset');
    widgetWindow.showInactive();
    persistOrbBounds();
  };

  const detonateOrb = () => {
    orbPopping = true;
    if (!widgetWindow || widgetWindow.isDestroyed()) return;
    widgetWindow.setIgnoreMouseEvents(true); // let clicks fall through during the blast
    widgetWindow.webContents.send('widget:pop', { kind: 'explode' });
    setTimeout(() => { if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.hide(); }, 1050);
    setTimeout(respawnOrb, 4050); // ~3s of silence after it disappears
  };

  const exitZoom = () => {
    orbZoom = null;
    if (!widgetWindow || widgetWindow.isDestroyed()) return;
    widgetWindow.webContents.send('widget:zoom-exit');
    const back = clampToWorkArea(orbPreZoom || defaultOrbBounds(screen.getPrimaryDisplay().workArea), orbWorkArea(orbPreZoom || currentOrbBounds()));
    orbPreZoom = null;
    widgetWindow.setBounds({ x: Math.round(back.x), y: Math.round(back.y), width: back.size, height: back.size });
    persistOrbBounds();
  };

  ipcMain.on('widget:resize', (_event, direction) => {
    if (orbPopping || !widgetWindow || widgetWindow.isDestroyed()) return;
    const dir = direction > 0 ? 1 : -1;

    if (orbZoom !== null) {
      const outcome = zoomOutcome(orbZoom, dir);
      if (outcome.type === 'zoom') { orbZoom = outcome.zoom; widgetWindow.webContents.send('widget:zoom', { zoom: orbZoom }); }
      else if (outcome.type === 'exit') exitZoom();
      else if (outcome.type === 'explode') { orbZoom = ZOOM_MAX; widgetWindow.webContents.send('widget:zoom', { zoom: ZOOM_MAX }); detonateOrb(); }
      return;
    }

    const outcome = resizeOutcome(currentOrbBounds(), dir, orbScreenMax());
    if (outcome.type === 'resize') {
      const clamped = clampToWorkArea(outcome.bounds, orbWorkArea(outcome.bounds));
      widgetWindow.setBounds({ x: Math.round(clamped.x), y: Math.round(clamped.y), width: clamped.size, height: clamped.size });
      persistOrbBounds();
    } else if (outcome.type === 'vanish') {
      orbPopping = true;
      widgetWindow.webContents.send('widget:pop', { kind: 'vanish' });
      setTimeout(() => { if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.hide(); }, 650);
      setTimeout(respawnOrb, 3650);
    } else if (outcome.type === 'zoom-enter') {
      // Fill the whole monitor and hand control to the fullscreen swell.
      orbPreZoom = currentOrbBounds();
      orbZoom = 1;
      const full = screen.getDisplayMatching({ x: Math.round(orbPreZoom.x), y: Math.round(orbPreZoom.y), width: orbPreZoom.size, height: orbPreZoom.size }).bounds;
      widgetWindow.setBounds(full);
      widgetWindow.webContents.send('widget:zoom', { zoom: 1, entering: true });
    }
  });

  // Clicking the giant orb mid-swell backs out to the normal window (an escape
  // hatch so the fullscreen orb can never trap the desktop).
  ipcMain.on('widget:zoom-abort', () => {
    if (orbPopping || orbZoom === null) return;
    exitZoom();
  });
  ipcMain.on('ui:state', (_event, payload) => {
    if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.webContents.send('ui:state', payload);
  });
  ipcMain.on('ui:skin', (_event, skin) => {
    currentSkin = skin || 'classic';
    if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.webContents.send('ui:skin', currentSkin);
  });
  ipcMain.on('window:control', (_event, action) => {
    if (!mainWindow) return;
    if (action === 'minimize') showOrb();
    if (action === 'maximize') mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
    if (action === 'close') { isQuitting = true; app.quit(); }
  });
}

function checkTaskReminders() {
  for (const task of tasks.dueForNotification()) {
    if (Notification.isSupported()) {
      new Notification({ title: `JARVIS · ${task.project.toUpperCase()}`, body: task.title, icon: path.join(__dirname, 'assets', 'icon.png') }).show();
    }
    tasks.update(task.id, { notified: true });
    sendEverywhere('tasks:changed', tasks.list());
  }
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'media'));
  session.defaultSession.setPermissionCheckHandler((_contents, permission) => permission === 'media');

  config = new ConfigStore(app.getPath('userData'), safeStorage);
  log = new ActivityLog(app.getPath('userData'));
  autonomy = new AutonomyService({ config, emit: sendEverywhere, log });
  currentSkin = config.getSettings().skin || 'classic';
  memory = new MemoryStore(app.getPath('userData'));
  tasks = new TaskStore(app.getPath('userData'));
  tools = new ToolService({ config, shell, app, emit: sendEverywhere });
  documents = new DocumentService({ config, shell, emit: sendEverywhere });
  // getCameras/getAi are lazy getters: `cameras` isn't constructed until
  // below, and `ai` cannot be passed to its own registry before `new
  // AIService(...)` returns. Both closures resolve once the module-level
  // `let` bindings are assigned, without reordering construction.
  ai = new AIService(config, buildToolRegistry({ tools, tasks, memory, config, documents, getCameras: () => cameras, getAi: () => ai }));
  ollama = new OllamaService({ config, emit: sendEverywhere });
  go2rtc = new Go2RtcManager({
    binaryPath: app.isPackaged
      ? path.join(process.resourcesPath, 'go2rtc', 'go2rtc.exe')
      : path.join(__dirname, 'resources', 'go2rtc', 'go2rtc.exe'),
    dataDir: path.join(app.getPath('userData'), 'cameras'),
    emit: sendEverywhere
  });
  cameras = new CameraService({
    config, log, go2rtc,
    // Autonomy listens where the alert is born: same payload the UI gets.
    emit: (channel, payload) => {
      sendEverywhere(channel, payload);
      if (channel === 'cameras:alert') {
        autonomy.handleCameraAlert(payload);
        pushCameraAlertToPhones(payload);
      }
    },
    notify: (title, body) => {
      if (Notification.isSupported()) new Notification({ title, body, icon: path.join(__dirname, 'assets', 'icon.png') }).show();
    },
    notifyGate: (alert) => autonomy.notifyGate(alert)
  });
  // Smart alerts: describe the frame with the local vision model when the
  // user has AI descriptions turned on. Failures fall back to generic text.
  cameras.describeFrame = async (jpegBase64, context) => {
    if (config.getSettings().cameraAiDescriptions !== true) return null;
    const described = await ai.describeCameraFrame(jpegBase64, context.name);
    return described.ok ? described.text : null;
  };
  cameras.init();
  claudeBridge = new ClaudeBridge({
    config,
    transcript: createTranscript(app.getPath('userData')),
    log
  });
  // Slice 1 of JARVIS's "hands": reads the screen, clicks nothing. Shows the
  // same "viewing your screen" indicator the cloud-vision feature uses, since a
  // read is a privacy event even though it changes nothing on the PC. The
  // helper lives in scripts/ (kept out of the asar so it runs from disk).
  screenReader = new ScreenReader({
    scriptPath: path.join(__dirname, 'scripts', 'read-screen.ps1'),
    log,
    onViewing: (active) => sendEverywhere('screen:viewing', { active })
  });
  // Slice 2 of the hands: the session referee, backed by one persistent
  // drive-screen.ps1 helper per approved session. The voice route arrives in
  // its own commit — until then no plan can reach run(). Every stop path is
  // live already.
  hands = new ScreenHands({
    driverFactory: () => new ScreenDriver({ scriptPath: path.join(__dirname, 'scripts', 'drive-screen.ps1'), log }),
    getSettings: () => config.getSettings(),
    log,
    onEvent: (payload) => sendEverywhere('screen:drive', payload),
    // A mid-session "will ask again" step: park a resolver in the router's
    // pending map (so the ordinary approval:resolve IPC answers it) and show
    // the same approval card UI the rest of the app uses.
    requestApproval: (card) => new Promise((resolve) => {
      // Self-cleaning: if nobody answers, the card denies itself and leaves
      // no stale entry a later click could mistake for a live approval.
      const settle = (approved) => {
        router.pending.delete(card.id);
        clearTimeout(sweeper);
        resolve(Boolean(approved));
      };
      const sweeper = setTimeout(() => settle(false), 70000);
      router.pending.set(card.id, { type: 'drive-step', resolve: settle });
      sendEverywhere('screen:drive', { type: 'approval', approval: card });
    }),
    stopWindow: { open: openDriveStopWindow, update: updateDriveStopWindow, close: closeDriveStopWindow }
  });
  router = new CommandRouter({ config, tools, documents, ai, memory, tasks, log, cameras, claude: claudeBridge, screen: screenReader, hands });
  scheduleStore = new ScheduleStore(app.getPath('userData'));
  scheduleService = new ScheduleService({ store: scheduleStore, config, router, emit: sendEverywhere, log });
  scheduleService.start().catch((error) => {
    log.write({ type: 'schedule-error', command: 'boot-start', response: error && error.message ? error.message : String(error), source: 'schedule' });
  });
  powerMonitor.on('resume', () => {
    try {
      scheduleService.arm();
    } catch (error) {
      log.write({ type: 'schedule-error', command: 'resume-arm', response: error && error.message ? error.message : String(error), source: 'schedule' });
    }
  });
  folderWatch = new FolderWatchService({
    config,
    emit: sendEverywhere,
    notify: (title, body) => {
      if (Notification.isSupported()) new Notification({ title, body, icon: path.join(__dirname, 'assets', 'icon.png') }).show();
    }
  });
  localVoice = new LocalVoiceService({
    voiceRoot: voiceDataRoot(),
    scriptPath: packagedScript('local_voice.py'),
    config,
    emit: sendEverywhere
  });
  mobileAuth = new MobileAuth({ devices: loadMobileDevices() });
  mobileServer = new MobileServer({
    config, router, auth: mobileAuth, documents,
    transcribe: (buffer, mimeType) => localVoice.transcribe(buffer, mimeType),
    staticDir: path.join(__dirname, 'src', 'mobile'),
    orbsDir: path.join(__dirname, 'src', 'orbs'),
    onDevicesChanged: saveMobileDevices,
    // Lazy getter: `cameras` is constructed above (before mobileServer), but
    // this keeps the same defensive pattern used for buildToolRegistry's
    // getCameras — cameras may be reassigned or absent in some code paths.
    getCameras: () => cameras
  });
  if (config.getSettings().mobileEnabled) syncMobileServer();
  try {
    const gpu = await app.getGPUInfo('basic');
    const device = gpu?.gpuDevice?.find((item) => item.active) || gpu?.gpuDevice?.[0];
    if (device?.deviceString) gpuLabel = device.deviceString;
  } catch {}

  setupIpc();
  createMainWindow();
  createTray();
  applyLoginSetting(config.getSettings().startWithWindows);
  localVoice.start();
  folderWatch.start();
  setInterval(checkTaskReminders, 30000);
  // Quiet update check a few seconds after launch; only speaks up if newer.
  setTimeout(async () => {
    const info = await checkForUpdate(app.getVersion(), updateRepo);
    if (info.updateAvailable) {
      sendEverywhere('update:available', info);
      if (Notification.isSupported()) {
        new Notification({ title: 'JARVIS update available', body: `Version ${info.latest} is ready to download.`, icon: path.join(__dirname, 'assets', 'icon.png') }).show();
      }
    }
  }, 6000);
});

app.on('before-quit', () => {
  isQuitting = true;
  localVoice?.stop();
  mobileServer?.stop();
  scheduleService?.stop();
  cameras?.shutdown();
});
app.on('window-all-closed', () => { if (isQuitting) app.quit(); });
