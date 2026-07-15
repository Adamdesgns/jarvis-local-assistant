const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const {
  app, BrowserWindow, ipcMain, dialog, shell, safeStorage, session,
  Menu, clipboard, Tray, nativeImage, Notification, screen, systemPreferences, desktopCapturer
} = require('electron');
const { ConfigStore } = require('./core/config-store');
const { ActivityLog } = require('./core/activity-log');
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
let go2rtc;
let cameras;
let autonomy;
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

function createWidgetWindow() {
  if (widgetWindow && !widgetWindow.isDestroyed()) return widgetWindow;
  const { workArea } = screen.getPrimaryDisplay();
  widgetWindow = new BrowserWindow({
    width: 132,
    height: 132,
    x: workArea.x + workArea.width - 160,
    y: workArea.y + workArea.height - 170,
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
      onReset: () => sendEverywhere('ai:stream-reset', {})
    });
  });
  ipcMain.on('ai:cancel', () => ai.cancel());
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
  ipcMain.on('ui:state', (_event, payload) => {
    if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.webContents.send('ui:state', payload);
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
  memory = new MemoryStore(app.getPath('userData'));
  tasks = new TaskStore(app.getPath('userData'));
  tools = new ToolService({ config, shell, app, emit: sendEverywhere });
  documents = new DocumentService({ config, shell, emit: sendEverywhere });
  ai = new AIService(config, buildToolRegistry({ tools, tasks, memory, config }));
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
      if (channel === 'cameras:alert') autonomy.handleCameraAlert(payload);
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
  router = new CommandRouter({ config, tools, documents, ai, memory, tasks, log, cameras });
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
  cameras?.shutdown();
});
app.on('window-all-closed', () => { if (isQuitting) app.quit(); });
