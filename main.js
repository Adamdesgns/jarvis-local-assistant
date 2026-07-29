const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const {
  app, BrowserWindow, ipcMain, dialog, shell, safeStorage, session,
  Menu, clipboard, Tray, nativeImage, Notification, screen, systemPreferences, desktopCapturer, powerMonitor
} = require('electron');
const { ConfigStore } = require('./core/config-store');
const { resolveVariant, isJr, profileFor, jrUserDataPath, jrIpcAllowlist, filterJrSettingsPatch } = require('./core/variant');
const { ParentControls } = require('./core/parent-controls');
const { buildJrPromptRules } = require('./core/kid-mode');
const { PRO_FEATURES, isPro, gateSettingsPatch, applyLicenseToSettings, featureAllowed } = require('./core/license-gate');
const { resolveEdition, effectiveLicenseState, defaultAssistantName } = require('./core/edition');
const { needsNaming, namingPatch, nameHeardIn, normalizeAssistantName } = require('./core/onboarding');
const { LicenseService } = require('./core/license-service');
const { ActivityLog } = require('./core/activity-log');
const { Transcript } = require('./core/transcript');
const { CrashLog, installProcessHandlers } = require('./core/crash-log');
const { MemoryStore } = require('./core/memory-store');
const { TaskStore } = require('./core/task-store');
const { GameScores } = require('./core/game-scores');
const { tttMove, rpsThrow } = require('./core/games');
const { gameLine } = require('./core/game-lines');
const { ToolService } = require('./core/tool-service');
const { DocumentService } = require('./core/document-service');
const { createCommandRunner } = require('./core/command-runner');
const { classifyCommand } = require('./src/command-guard');
const { AIService } = require('./core/ai-service');
const { OllamaService } = require('./core/ollama-service');
const { LocalVoiceService, shouldRestartVoice } = require('./core/local-voice-service');
const { VoiceService } = require('./core/voice-service');
const { Go2RtcManager } = require('./core/camera/go2rtc-manager');
const { CameraService } = require('./core/camera/camera-service');
const { DefenseService } = require('./core/defense-service');
const { BROWSER_PARTITION, sanitizeWebviewParams, isNavigationAllowed, decidePermission, shouldBlockDownload } = require('./core/browser-guard');
const { FolderWatchService } = require('./core/folder-watch');
const { AutonomyService } = require('./core/autonomy-service');
const { checkForUpdate } = require('./core/update-check');
const updateRepo = require('./package.json').updateRepo || '';
const proBuyUrl = require('./package.json').proBuyUrl || '';
const { buildToolRegistry } = require('./core/tool-registry');
const { CommandRouter } = require('./core/router');
const { ClaudeBridge, createTranscript } = require('./core/claude-bridge');
const { ScreenReader } = require('./core/screen-reader');
const { ScreenHands } = require('./core/screen-drive-session');
const { ScreenDriver } = require('./core/screen-driver');
const { ORB_DEFAULT, ZOOM_MAX, clampToWorkArea, resizeOutcome, zoomOutcome, defaultOrbBounds } = require('./core/orb-bounds');
const { isWithinWindow } = require('./core/autonomy-rules');
const { MobileServer } = require('./core/mobile-server');
const { MobileAuth } = require('./core/mobile-auth');
const { ScheduleStore } = require('./core/schedule-store');
const { ScheduleService } = require('./core/schedule-service');
const { NightShiftService } = require('./core/night-shift');
const { HeartbeatService, buildDefaultChecks } = require('./core/heartbeat');
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

// JARVIS's voice (core/voice-service.js) runs Kokoro on the GPU via WebGPU.
// On a laptop with switchable graphics Chromium picks the integrated adapter
// by default to save battery, which measured 3x slower here than the discrete
// one (RTF 0.50 on Intel vs 0.15 on the RTX). Also set before app ready.
app.commandLine.appendSwitch('force_high_performance_gpu');

// Which build this is — 'standard' (the JARVIS that has always shipped) or
// 'jr' (the parental-controls build). Stamped at build time into
// package.json's jarvisVariant (packaged builds only — an unpackaged app has
// no stamp to trust) and forced with --jr / JARVIS_VARIANT=jr for
// `npm run start:jr`. See core/variant.js for why this is a different axis
// from core/edition.js.
const VARIANT = resolveVariant({
  stamped: app.isPackaged ? require('./package.json').jarvisVariant : '',
  env: process.argv.includes('--jr') ? 'jr' : process.env.JARVIS_VARIANT
});
const JR = isJr(VARIANT);
// JR's data NEVER touches the grown-up folder — dev mode included. This is
// the fix for the JUNIOR dev-mode leak found 2026-07-28. Must run before
// ANY service reads app.getPath('userData') — CrashLog, two lines down, is
// the very first one.
if (JR) app.setPath('userData', jrUserDataPath(app.getPath('appData')));

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
let transcript;
let memory;
let tasks;
let gameScores;
let tools;
let documents;
// THE TERMINAL stage 2's runner. Safe to build at module scope: the approved-root
// check is a closure, so it resolves `documents` at call time, not load time.
const terminalRunner = createCommandRunner({
  isAllowed: (target) => Boolean(documents && documents.isAllowed(target))
});
let ai;
let ollama;
let localVoice;
let voiceService;
let folderWatch;
let router;
let claudeBridge;
let screenReader;
let hands;
let driveStopWindow;
let go2rtc;
let cameras;
let defense;
let autonomy;
let mobileAuth;
let mobileServer;
let scheduleStore;
let scheduleService;
let nightShift;
let heartbeat;
let licenseService;
let parentControls;
let PROFILE;
// JR's content-lock rules thunk — the same one AIService is constructed with
// (see the `new AIService(...)` call and its `{ profile, jrPromptRules }`
// options) and the same shape core/router.js's #aiContext() computes
// per-call. Module-level, like `ai`/`PROFILE`, so a handler registered in
// setupIpc() (a separate function) can still reach it via closure once boot
// assigns it. Null in standard builds and whenever JR has no parentControls.
let jrPromptRulesThunk = null;
let camerasInitialized = false;
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
      backgroundThrottling: false,
      // THE BROWSER module's <webview>. Every attach is rewritten by
      // core/browser-guard.js below — no preload, forced stranger partition,
      // no node — so enabling the tag does not widen what a page can reach.
      webviewTag: true
    }
  });
  // The browser wall, seam 1: whatever webview params the renderer asked
  // for, the guard decides what actually attaches.
  mainWindow.webContents.on('will-attach-webview', (_event, webPreferences, params) => {
    sanitizeWebviewParams(webPreferences);
    sanitizeWebviewParams(params);
  });
  // Seam 2: guests never open OS windows (links become tabs), and never
  // leave the web (file:, chrome:, javascript: refused at navigation).
  mainWindow.webContents.on('did-attach-webview', (_event, guest) => {
    guest.setWindowOpenHandler(({ url }) => {
      if (isNavigationAllowed(url)) sendEverywhere('browser:open-tab', { url });
      return { action: 'deny' };
    });
    guest.on('will-navigate', (event, url) => {
      if (!isNavigationAllowed(url)) {
        event.preventDefault();
        sendEverywhere('browser:notice', { message: 'That address is not a web page, so I left it alone.' });
      }
    });
  });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  attachEditingShortcuts(mainWindow);
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });
  mainWindow.on('focus', () => maybeMorningReport());
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
  // icon-tray.png is the orb rendered at its brightest pose and cropped tighter —
  // the full-detail icon.png turns to mush once it's downscaled to tray size.
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon-tray.png')).resize({ width: 24, height: 24 });
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

// The edition — resolved once at startup from the build-time stamp, never
// from settings. The stamp is a plain file electron-builder drops next to the
// app code (see extraResources in package.json); reading it from resourcesPath
// keeps it out of the asar and out of settings.json. A missing or unreadable
// stamp on a packaged build means RETAIL — fail closed, per core/edition.js.
const EDITION = resolveEdition({
  packaged: app.isPackaged,
  stamped: (() => {
    try { return fs.readFileSync(path.join(process.resourcesPath, 'edition'), 'utf8'); }
    catch { return ''; }
  })()
});

// The licence state every gate consults. Master is always Pro — that's the
// point of the master build — and retail reads what's persisted. This is the
// ONLY place the two are combined, so the edition can't leak into disk state.
function currentLicenseState() {
  return effectiveLicenseState(EDITION, config.getSettings().license);
}

// A read-only settings view with unlicensed Pro flags forced off. Services
// that only consult settings get this instead of the raw config, so the
// license gate holds even if a Pro flag survives in settings.json. The view
// also carries the EFFECTIVE licence (not the persisted one) so services
// that check settings.license themselves — defense mode — see the same state
// every other gate sees. Never persist this view.
function licensedSettings() {
  const state = currentLicenseState();
  return { ...applyLicenseToSettings(config.getSettings(), state), license: state };
}

async function syncMobileServer() {
  // JR never constructs mobileServer/mobileAuth (PROFILE.phone is always
  // false) but the mobileEnabled setting bit is still one settings:save can
  // write (see task-6-report.md); no-op rather than throw on the null pair.
  if (!mobileServer || !mobileAuth) return;
  const settings = licensedSettings();
  mobileServer.stop();
  if (settings.mobileEnabled) await mobileServer.start();
  const status = mobileServer.status();
  if (!status.running && !settings.mobileEnabled && config.getSettings().mobileEnabled) {
    status.reason = 'The phone companion is a JARVIS Pro feature — unlock it in Settings → PRO.';
  }
  sendEverywhere('mobile:status', status);
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
  // JARVIS JR's parent-lock surface. Registered unconditionally — the IPC
  // allowlist installed earlier is what actually keeps these reachable only
  // in JR (jrIpcAllowlist admits them at every checklist setting) — but each
  // handler also refuses on its own when !JR, so a standard build calling one
  // of these directly (it never does; nothing in the standard renderer sends
  // them) gets a clean { ok: false } instead of a crash on a null
  // parentControls. Every jr:parent:* mutation demands the PIN in the same
  // call — the renderer never holds an unlocked session token.
  ipcMain.handle('jr:status', () => ({ jr: JR, setUp: JR ? parentControls.isSetUp() : true, profile: PROFILE }));
  ipcMain.handle('jr:setup:complete', (_e, payload) => {
    if (!JR) return { ok: false };
    const result = parentControls.completeSetup(payload || {});
    // PROFILE was computed once at boot from whatever the checklist held
    // then (empty, pre-setup). Setup just wrote the real checklist, so the
    // profile this whole process built its services from is now stale — the
    // only clean fix is to rebuild the process, not patch PROFILE in place.
    if (result.ok) { app.relaunch(); app.exit(0); }
    return result;
  });
  ipcMain.handle('jr:parent:verify', (_e, payload) => JR ? parentControls.verifyPin(payload?.pin) : { ok: false });
  ipcMain.handle('jr:parent:controls', (_e, payload) => {
    if (!JR) return { ok: false };
    const gate = parentControls.verifyPin(payload?.pin);
    if (!gate.ok) return gate;
    const controls = payload?.patch ? parentControls.setControls(payload.patch) : parentControls.getControls();
    // No hot-disable: an off-to-on flip would need a service this process
    // never constructed, and an on-to-off flip should not yank a feature out
    // from under something mid-use. Every checklist change takes effect at
    // next launch; relaunchNeeded tells the renderer to say so.
    return { ok: true, controls, relaunchNeeded: Boolean(payload?.patch) };
  });
  ipcMain.handle('jr:parent:pin', (_e, payload) => JR ? parentControls.setPin(payload?.oldPin, payload?.newPin) : { ok: false });

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
    version: app.getVersion(),
    edition: EDITION,
    // Retail, first run only: the renderer shows the naming screen before
    // anything else. Master never sees it — he already has a name.
    needsNaming: needsNaming({ edition: EDITION, settings: config.getSettings() })
  }));
  ipcMain.handle('telemetry', collectTelemetry);
  // Closes first-run naming. Goes through updateSettings like every other
  // patch — namingPatch() emits exactly two allowlisted keys, and skipping
  // (empty name) still stamps so the question never returns.
  ipcMain.handle('onboarding:name', (_event, payload) => {
    const settings = config.updateSettings(namingPatch(payload?.name));
    log.write({
      type: 'system',
      command: 'first-run-naming',
      response: `The assistant is named ${settings.assistantName}.`,
      source: 'onboarding'
    });
    return { settings };
  });
  // The say-it-back check: the renderer records the buyer saying the name,
  // transcribes through the same local pipeline as every other utterance,
  // and this compares phonetically. Coaching, not a gate — skippable.
  ipcMain.handle('onboarding:heard', async (_event, payload) => {
    const transcript = await localVoice.transcribe(Buffer.from(payload.bytes), payload.mimeType);
    return { transcript, heard: nameHeardIn(transcript, String(payload?.name || '')) };
  });
  // Every exchange passes through here, which makes it the one honest place to
  // journal the conversation. The user's line is written BEFORE the router
  // runs, so a request that crashes or hangs still leaves a record of what was
  // asked; the reply is written after, and only if there was one.
  ipcMain.handle('command:submit', async (_event, payload) => {
    const text = typeof payload === 'string' ? payload : payload?.text;
    const project = typeof payload === 'object' && payload ? payload.project : 'general';
    transcript.append('you', text);
    const result = await router.handle(text, project, {
      onChunk: (piece) => sendEverywhere('ai:stream', { piece }),
      onReset: () => sendEverywhere('ai:stream-reset', {}),
      onStep: (step) => sendEverywhere('agent:step', { index: step.index, tool: step.tool, summary: summarizeAgentStep(step) })
    });
    transcript.append('jarvis', result?.response);
    return result;
  });
  // The record, as text, ready to paste. Reading it is deliberately a pull:
  // nothing streams the conversation anywhere on its own.
  ipcMain.handle('transcript:read', () => ({ text: transcript.read(), folder: transcript.dir }));
  ipcMain.handle('transcript:reveal', async () => {
    try {
      await shell.openPath(transcript.dir);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error && error.message ? error.message : String(error) };
    }
  });
  // One cancel to stop everything: the brain mid-thought AND the hands
  // mid-step. Escape, the orb stop button and a spoken "stop" all land here.
  ipcMain.on('ai:cancel', () => {
    ai.cancel();
    hands?.abortActive('user-interrupt');
  });
  ipcMain.on('screen:drive-stop', () => hands?.abortActive('stop-button'));
  // THE TERMINAL, stage 2 — user-typed Windows commands.
  //
  // Two calls on purpose. The renderer classifies first so it can show the
  // confirm card for an approve-tier command, then calls run with approved:true
  // once the human says yes. The runner re-classifies and refuses an
  // unapproved approve-tier command anyway, so the card cannot be skipped.
  //
  // HARD RAIL: nothing here is reachable by the model. There is no
  // run_command tool in core/tool-registry.js, and a test enforces that. Only
  // the human's keystrokes in the console reach this handler.
  ipcMain.handle('terminal:classify', (_event, payload) => {
    const text = typeof payload === 'string' ? payload : payload?.command;
    return classifyCommand(text);
  });
  ipcMain.handle('terminal:run', async (_event, payload) => {
    // documents is null whenever PROFILE.documents is off — a checklist
    // combination the terminal control does not imply (a parent can turn
    // terminal on without turning documents on). Same empty-roots refusal a
    // fresh install with no approved folder yet already returns.
    const roots = documents ? documents.approvedRoots() : [];
    if (!roots.length) {
      return {
        refused: true,
        tier: 'free',
        reason: 'There are no approved folders yet, so there is nowhere safe to run a command. Add one in Settings → FILES.',
        stdout: '', stderr: '', code: null, timedOut: false, truncated: false
      };
    }
    // cwd is renderer-supplied so `cd` can move around, but it is only ever
    // honoured inside an approved root — the runner re-checks it too.
    const requested = payload?.cwd;
    const cwd = requested && documents && documents.isAllowed(requested) ? requested : roots[0];
    const result = await terminalRunner.run({
      command: payload?.command,
      cwd,
      approved: payload?.approved === true
    });
    // Every command the console runs — and every one it refuses — is on the
    // record, so "what did I run in there?" has an answer.
    log.write({
      type: 'terminal',
      command: String(payload?.command || '').slice(0, 200),
      response: result.refused
        ? `refused (${result.tier}): ${result.reason}`
        : `exit ${result.code}${result.timedOut ? ' (timed out)' : ''}`,
      source: 'terminal'
    });
    return { ...result, cwd };
  });
  ipcMain.handle('terminal:cwd', () => {
    const roots = documents ? documents.approvedRoots() : [];
    return { cwd: roots[0] || '', roots };
  });
  ipcMain.handle('approval:resolve', (_event, payload) => router.resolveApproval(payload.id, Boolean(payload.approved)));
  ipcMain.handle('activity:recent', (_event, limit) => log.recent(Math.min(100, Number(limit) || 20)));
  // Speaking (Kokoro). The renderer gets raw WAV bytes back and plays them; a
  // { ok:false } reply is its cue to fall back to the system voice rather than
  // go silent.
  ipcMain.handle('tts:speak', async (_event, payload) => {
    const result = await voiceService.synthesize(payload?.text, { voice: payload?.voice });
    if (!result.ok) return { ok: false, error: result.error, fallback: true };
    return { ok: true, wav: result.wav, voice: result.voice, cached: Boolean(result.cached) };
  });
  ipcMain.handle('tts:voices', () => voiceService.listVoices());
  ipcMain.handle('tts:status', () => voiceService.status());

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
  // Real Math.random on both engines here — the rng parameter exists so the
  // core/games.js test suite can pin deterministic behaviour; live play gets
  // genuine randomness. JARVIS is always 'O' in tic tac toe (the games UI
  // has the kid moving first as 'X' — see the games plan's Task 6).
  ipcMain.handle('game:move', (_event, payload) => {
    const { game, board, difficulty, history } = payload || {};
    if (game === 'ttt') return { move: tttMove(board, 'O', difficulty) };
    if (game === 'rps') return { shape: rpsThrow(difficulty, history) };
    throw new Error(`Unknown game: ${game}`);
  });
  ipcMain.handle('game:score', (_event, payload) => {
    const { game, outcome } = payload || {};
    return game && outcome ? gameScores.record(game, outcome) : gameScores.get();
  });
  // The games UI's trash-talk lines (core/game-lines.js), age-banded off the
  // same parentControls.age() the router uses for its own gameStart line
  // (core/router.js). gameLine() throws on an unknown occasion — caught here
  // so a UI typo degrades to a silent no-line rather than a dead overlay.
  ipcMain.handle('game:line', (_event, payload) => {
    try {
      return { line: gameLine(String(payload?.occasion || ''), { age: parentControls ? parentControls.age() : 11 }) };
    } catch {
      return { line: '' };
    }
  });
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
    // JR first: capability-adjacent settings (searchRoots, routines,
    // cameraAccounts, screenControlEnabled, aiMode, ...) are parental
    // territory — the parent panel's PIN-gated channels are the only route
    // to them in JR. filterJrSettingsPatch keeps only cosmetic/voice state;
    // everything else in a JR renderer patch is silently dropped before the
    // license gate or ConfigStore ever see it. No-op in standard (JR false).
    const incomingPatch = JR ? filterJrSettingsPatch(patch || {}) : (patch || {});
    // The license choke point: an unlicensed attempt to switch a Pro feature
    // on is stripped here, before anything persists, and reported so the UI
    // can explain instead of silently snapping the toggle back.
    const { patch: gatedPatch, refused } = gateSettingsPatch(previous, incomingPatch, currentLicenseState());
    // The rename path shares first-run naming's rules: control characters
    // stripped (the name lands verbatim in every system prompt), capped, and
    // an emptied field falls back to a real name instead of a broken prompt.
    // Master keeps JARVIS as the fallback rather than the retail product name.
    if (Object.prototype.hasOwnProperty.call(gatedPatch, 'assistantName')) {
      gatedPatch.assistantName = String(gatedPatch.assistantName || '').trim()
        ? normalizeAssistantName(gatedPatch.assistantName)
        : defaultAssistantName(EDITION);
    }
    if (refused.length) sendEverywhere('license:pro-refused', { refused });
    const updated = config.updateSettings(gatedPatch);
    applyLoginSetting(updated.startWithWindows);
    if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.setAlwaysOnTop(Boolean(updated.orbAlwaysOnTop));
    // assistantName is in this list because the wake MODE depends on it —
    // renaming him from Jarvis to anything else switches engines entirely.
    if (shouldRestartVoice(previous, updated)) {
      localVoice.stop();
      setTimeout(() => localVoice.start(), 1700);
    }
    if (folderWatch && JSON.stringify(previous.watchedFolders || []) !== JSON.stringify(updated.watchedFolders || [])) {
      folderWatch.start();
    }
    if (previous.mobileEnabled !== updated.mobileEnabled || previous.mobilePort !== updated.mobilePort) syncMobileServer();
    if (scheduleService && previous.schedulesEnabled !== updated.schedulesEnabled) {
      scheduleService.start().catch((error) => {
        log.write({ type: 'schedule-error', command: 'settings-save-start', response: error && error.message ? error.message : String(error), source: 'schedule' });
      });
    }
    if (previous.orbSkin !== updated.orbSkin || previous.orbColor !== updated.orbColor) {
      sendEverywhere('orb:prefs', { orbSkin: updated.orbSkin || 'original', orbColor: updated.orbColor || 'gold' });
    }
    // setupNightShift touches scheduleStore and nightShift directly with no
    // null-check of its own — both are always off in JR, so only run it when
    // both are actually constructed (true in standard; never in JR, even if
    // a kid flips nightShiftEnabled through this same channel).
    if (updated.nightShiftEnabled === true && previous.nightShiftEnabled !== true && scheduleStore && nightShift) {
      return setupNightShift(updated);
    }
    return updated;
  });
  ipcMain.handle('orb:prefs', () => {
    const settings = config.getSettings();
    return { orbSkin: settings.orbSkin || 'original', orbColor: settings.orbColor || 'gold' };
  });
  ipcMain.handle('nightshift:status', () => ({
    enabled: config.getSettings().nightShiftEnabled === true,
    folder: config.getSettings().nightShiftFolder || '',
    doneCount: nightShift ? nightShift.doneCount() : 0,
    jobs: scheduleStore.list()
      .filter((item) => item.action && item.action.kind === 'brainJob')
      .map((item) => ({ id: item.id, name: item.name, enabled: item.enabled, time: item.when && item.when.time, lastRunAt: item.lastRunAt, lastResult: item.lastResult }))
  }));
  ipcMain.handle('update:check', () => checkForUpdate(app.getVersion(), updateRepo));
  ipcMain.handle('update:open', (_event, url) => shell.openExternal(String(url || `https://github.com/${updateRepo}/releases/latest`)));
  ipcMain.handle('screen:describe', async (_event, question) => {
    if (!isPro(currentLicenseState())) {
      return { ok: false, message: 'Looking at your screen is a JARVIS Pro feature. Open Settings → PRO to unlock it.' };
    }
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
      // FIX (Task 7): this call used to hand describeImage an empty context
      // — the per-call-context-only design fails open for exactly a caller
      // like this one that forgets to thread the profile/content-lock rules.
      // AIService's own construction-time profile/jrPromptRules (above) now
      // covers this even if the context stayed empty, but threading it
      // explicitly here too keeps this call site honest on its own, the same
      // way core/router.js's #aiContext() does for every this.ai. call there.
      const answer = await ai.describeImage(base64, question || 'Describe what is on this screen and anything that looks important.', {
        profile: PROFILE,
        jrPromptRules: jrPromptRulesThunk ? jrPromptRulesThunk() : ''
      });
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

  // JARVIS Pro licensing. Every network call here is a button the user just
  // pressed — never automatic (see license-service.js).
  ipcMain.handle('license:status', () => ({
    // The PRO tab shows the effective state, so a master build reads
    // "licensed" instead of asking its own author for money.
    license: currentLicenseState(),
    edition: EDITION,
    features: PRO_FEATURES.map((feature) => ({ id: feature.id, label: feature.label })),
    buyUrl: proBuyUrl
  }));
  ipcMain.handle('license:activate', async (_event, key) => {
    const result = await licenseService.activate(key);
    if (result.ok) {
      // Bring already-configured Pro features to life without a restart.
      if (!camerasInitialized) {
        cameras.init();
        camerasInitialized = true;
      }
      syncMobileServer();
      scheduleService.start().catch((error) => {
        log.write({ type: 'schedule-error', command: 'license-activate-start', response: error && error.message ? error.message : String(error), source: 'schedule' });
      });
      log.write({ type: 'license', command: 'activate', response: 'JARVIS Pro activated on this PC.', source: 'license' });
    }
    return { ...result, settings: config.publicSettings() };
  });
  ipcMain.handle('license:validate', async () => {
    const result = await licenseService.validate();
    return { ...result, settings: config.publicSettings() };
  });
  ipcMain.handle('license:deactivate', async () => {
    const result = await licenseService.deactivate();
    if (result.ok) {
      syncMobileServer();
      scheduleService.start().catch(() => {});
      log.write({ type: 'license', command: 'deactivate', response: 'JARVIS Pro deactivated; the seat is free for another PC.', source: 'license' });
    }
    return { ...result, settings: config.publicSettings() };
  });
  ipcMain.handle('external:buy-pro', () => {
    if (!proBuyUrl) return { ok: false, message: 'The JARVIS Pro store link is not set up yet.' };
    shell.openExternal(proBuyUrl);
    return { ok: true };
  });

  ipcMain.handle('cameras:bootstrap', async () => ({
    accounts: cameras.listAccounts(),
    cameras: await cameras.listCameras(),
    systems: await cameras.listSystems(),
    status: cameras.getStatus()
  }));
  // Adding a camera account is the camera module's licensed doorway. Saved
  // accounts are never touched (see license-gate.js on cameraAccounts) — they
  // just stay dormant until cameras.init() runs under a license.
  const cameraRefusal = () => (featureAllowed('camera', config.getSettings(), currentLicenseState())
    ? null
    : { ok: false, message: 'Cameras are a JARVIS Pro feature. Open Settings → PRO to unlock them.' });
  ipcMain.handle('cameras:add-blink', (_event, payload) => cameraRefusal() || cameras.addBlinkAccount(payload || {}));
  ipcMain.handle('cameras:blink-pin', (_event, payload) => cameras.submitBlinkPin(String(payload?.accountId || ''), String(payload?.pin || '')));
  ipcMain.handle('cameras:systems', () => cameras.listSystems());
  ipcMain.handle('cameras:add-ring', (_event, payload) => cameraRefusal() || cameras.addRingAccount(payload || {}));
  ipcMain.handle('cameras:live-answer', (_event, payload) => cameras.answerLiveView(String(payload?.key || ''), String(payload?.offerSdp || '')));
  ipcMain.handle('cameras:add-nest', (_event, payload) => cameraRefusal() || cameras.addNestAccount(payload || {}, { openExternal: (url) => shell.openExternal(url) }));
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
  ipcMain.handle('cameras:add-rtsp', (_event, payload) => cameraRefusal() || cameras.addRtspAccount(payload || {}));
  ipcMain.handle('cameras:remove-account', (_event, accountId) => cameras.removeAccount(String(accountId || '')));
  ipcMain.handle('cameras:list', () => cameras.listCameras());
  ipcMain.handle('cameras:snapshot', (_event, payload) => cameras.getSnapshot(String(payload?.key || ''), { manual: Boolean(payload?.manual) }));
  ipcMain.handle('cameras:live-start', (_event, key) => cameras.openLiveView(String(key || '')));
  ipcMain.handle('cameras:live-stop', (_event, key) => cameras.closeLiveView(String(key || '')));
  ipcMain.handle('cameras:discover', () => {
    const { discoverCameras } = require('./core/camera/onvif-discovery');
    return discoverCameras({});
  });

  // JARVIS JR's one doorway for camera CONFIG (see core/variant.js — the
  // cameras:add-*/remove-account/set-armed/blink-pin channels are deliberately
  // absent from the JR allowlist under their own names). Same shape as the
  // other jr:parent:* mutations: the PIN is verified in THIS call, through the
  // same PinGate lockout, and only on success does it dispatch to the exact
  // same CameraService methods (and the same cameraRefusal() Pro gate) the
  // standard build's own camera handlers call directly above — no separate
  // credential-handling path to keep in sync.
  //
  // Task 8b adds the 'list' action (parent panel's CAMERAS tab, src/jr-parent-
  // ui.js). It is handled BEFORE the `if (!cameras)` guard on purpose: `cameras`
  // (the CameraService instance) is null whenever the "Cameras" checklist item
  // is off — see `if (PROFILE.cameras)` above, where the service itself is
  // never constructed, same JUNIOR principle as everything else in core/
  // variant.js. But a parent must still be able to see (and remove) whatever
  // is already configured even in that state, so 'list' reads straight off
  // config.getSettings().cameraAccounts instead of going through the service.
  // Every other action still requires `cameras` to exist (Cameras checklist
  // item on, and a relaunch since it happened) because adding/removing an
  // account calls a CameraService method. Only id/brand/name are returned —
  // never a secret; those live in config's separate secrets storage
  // (CameraService's #readSecrets/setSecret) and are never on the account
  // object itself.
  ipcMain.handle('jr:parent:cameras', async (_e, payload) => {
    if (!JR) return { ok: false };
    const gate = parentControls.verifyPin(payload?.pin);
    if (!gate.ok) return gate;
    const body = payload?.payload;
    const action = String(payload?.action || '');
    if (action === 'list') {
      const accounts = config.getSettings().cameraAccounts || [];
      return { ok: true, accounts: accounts.map((account) => ({ id: account.id, brand: account.brand, name: account.name })) };
    }
    if (!cameras) return { ok: false, message: 'Cameras are not turned on for JARVIS JR.' };
    switch (action) {
      case 'add-blink': return cameraRefusal() || cameras.addBlinkAccount(body || {});
      case 'blink-pin': return cameras.submitBlinkPin(String(body?.accountId || ''), String(body?.pin || ''));
      case 'add-ring': return cameraRefusal() || cameras.addRingAccount(body || {});
      case 'add-nest': return cameraRefusal() || cameras.addNestAccount(body || {}, { openExternal: (url) => shell.openExternal(url) });
      case 'add-rtsp': return cameraRefusal() || cameras.addRtspAccount(body || {});
      case 'remove-account': return cameras.removeAccount(String(body || ''));
      case 'set-armed': return cameras.setArmed(String(body?.key || ''), Boolean(body?.armed));
      default: return { ok: false, message: 'Unknown camera action.' };
    }
  });

  // Defense mode. Enter is Pro-gated inside the service; exit and wave-off
  // are deliberately ungated — standing down must always work.
  ipcMain.handle('defense:status', () => defense.status());
  ipcMain.handle('defense:enter', () => defense.requestEnter({ kind: 'manual' }));
  ipcMain.handle('defense:exit', () => { defense.exit(); return { ok: true }; });
  ipcMain.handle('defense:wave-off', () => ({ ok: defense.waveOff() }));
  ipcMain.handle('defense:zones', (_event, stateCode) => defense.listCountyZones(String(stateCode || '')));

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

// First-enable setup: create the drafts folder, approve it, seed the two
// starter jobs (once), and hand back the final settings.
function setupNightShift(updated) {
  const draftsDir = path.join(os.homedir(), 'Documents', 'JARVIS Drafts');
  try { fs.mkdirSync(draftsDir, { recursive: true }); } catch {}
  const patch = {};
  if (!updated.nightShiftFolder) patch.nightShiftFolder = draftsDir;
  const roots = updated.searchRoots || [];
  const target = patch.nightShiftFolder || updated.nightShiftFolder;
  if (!roots.some((root) => path.resolve(root) === path.resolve(target))) {
    patch.searchRoots = [...roots, target];
  }
  const final = Object.keys(patch).length ? config.updateSettings(patch) : updated;
  const hasBrainJobs = scheduleStore.list().some((item) => item.action && item.action.kind === 'brainJob');
  if (!hasBrainJobs) {
    scheduleStore.add({
      name: 'Daily social draft',
      when: { time: '02:00', repeat: 'daily' },
      action: { kind: 'brainJob', prompt: 'Write a short, plain-spoken social media post about the JARVIS build journey, using my recent notes and activity for material. First person, blue-collar voice, no hype words. This is a draft for me to review — do not address anyone directly.' }
    });
    scheduleStore.add({
      name: 'Morning briefing file',
      when: { time: '05:30', repeat: 'daily' },
      action: { kind: 'brainJob', prompt: 'Summarize yesterday for me in plain language: tasks completed and still open, files I worked with, and anything the cameras logged. Short and honest.' }
    });
    sendEverywhere('schedule:changed', scheduleStore.list());
  }
  return final;
}

// Morning report: once the night window has ended and unreported jobs exist,
// say what the shift finished — spoken, carded, and saved as its own draft.
async function maybeMorningReport() {
  try {
    if (!nightShift) return;
    const settings = licensedSettings();
    if (settings.nightShiftEnabled !== true) return;
    const pending = nightShift.pendingReport();
    if (!pending.length) return;
    const start = Number.isFinite(Number(settings.nightShiftStart)) ? Number(settings.nightShiftStart) : 0;
    const end = Number.isFinite(Number(settings.nightShiftEnd)) ? Number(settings.nightShiftEnd) : 6;
    if (start !== end && isWithinWindow(new Date(), start, end)) return; // still night — wait
    const done = pending.filter((entry) => entry.ok);
    const failed = pending.filter((entry) => !entry.ok);
    const parts = [];
    if (done.length) parts.push(`While you slept I finished ${done.length} job${done.length > 1 ? 's' : ''}: ${done.map((entry) => entry.name).join(', ')}. The drafts are ready for your review.`);
    if (failed.length) parts.push(`${failed.length} job${failed.length > 1 ? 's' : ''} hit trouble — details are in the shift log.`);
    const text = parts.join(' ');
    sendEverywhere('autonomy:event', { speak: text, card: { title: 'NIGHT SHIFT — MORNING REPORT', body: text } });
    log.write({ type: 'night-shift', command: 'morning-report', response: text, source: 'night-shift' });
    if (settings.nightShiftFolder) {
      const stamp = new Date().toISOString().slice(0, 10);
      const body = `# Morning report — ${stamp}\n\n${pending.map((entry) => `- ${entry.ok ? '✓' : '✗'} ${entry.name} — ${entry.text}`).join('\n')}\n`;
      await documents.createTextFileAt(settings.nightShiftFolder, `${stamp} Morning report`, body, '.md').catch(() => {});
    }
    nightShift.markReported();
  } catch (error) {
    log.write({ type: 'night-shift', command: 'morning-report-error', response: error && error.message ? error.message : String(error), source: 'night-shift' });
  }
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
  // The parent's half of JR: PIN, birthdate, checklist, kid name — lives in
  // config's secrets store (never in settings.json, which the kid can reach).
  // PROFILE is the capability list every gated construction below consults;
  // computed once at boot from the checklist as it stood at launch, so a
  // mid-session checklist edit needs the relaunch jr:parent:controls reports.
  parentControls = JR ? new ParentControls(config) : null;
  PROFILE = profileFor(VARIANT, parentControls ? parentControls.getControls() : null);
  // A thunk, not a precomputed string, so a parent-panel edit to age/kidName
  // mid-session is picked up on the very next turn rather than frozen at
  // boot. Passed into AIService below so the content lock rides even a call
  // that forgets to thread context.jrPromptRules through itself (FAIL CLOSED
  // — see AIService's constructor/prompt()); main.js's own screen:describe
  // handler also builds the string explicitly from this same thunk.
  jrPromptRulesThunk = parentControls ? () => buildJrPromptRules({ age: parentControls.age(), kidName: parentControls.getKidName() }) : null;
  // IPC allowlist: every channel not named here throws (handle) or is
  // silently dropped (on) for the JR build. Installed before setupIpc() (and
  // before any of the gated service construction below registers nothing —
  // construction never touches ipcMain) so every channel setupIpc() adds is
  // covered. Standard builds are untouched: JR is false, nothing is wrapped.
  if (JR) {
    const ALLOWED = jrIpcAllowlist(PROFILE);
    const realHandle = ipcMain.handle.bind(ipcMain);
    const realOn = ipcMain.on.bind(ipcMain);
    ipcMain.handle = (channel, listener) => realHandle(channel, ALLOWED.has(channel)
      ? listener
      : async () => { throw new Error(`${channel} is not part of JARVIS JR.`); });
    ipcMain.on = (channel, listener) => realOn(channel, ALLOWED.has(channel) ? listener : () => {});
  }
  log = new ActivityLog(app.getPath('userData'));
  // The rolling 24-48h record of what was said, both sides, in plain text.
  // Pruned on every append, and once here at boot so a machine that sat idle
  // for a week does not keep last week's conversations waiting for a message.
  transcript = new Transcript(app.getPath('userData'));
  transcript.prune();
  licenseService = new LicenseService({ config });
  // Gated view: Pro flags read false until licensed. Explicit delegation, not
  // a subclass — ConfigStore keeps its private fields and its write paths.
  const gatedConfig = { getSettings: licensedSettings };
  // AutonomyService/FolderWatchService gate together on PROFILE.autonomy —
  // JR never constructs either (see core/variant.js's trailing always-off
  // block), so the camera-alert path below and the settings:save watcher
  // restart both null-check autonomy/folderWatch rather than assume them.
  autonomy = PROFILE.autonomy ? new AutonomyService({ config: gatedConfig, emit: sendEverywhere, log }) : null;
  currentSkin = config.getSettings().skin || 'classic';
  memory = new MemoryStore(app.getPath('userData'));
  tasks = new TaskStore(app.getPath('userData'));
  // Unconditional, like memory/tasks above — not gated on PROFILE.games. A
  // kid's own scoreboard is harmless to have sitting on disk even when a
  // parent has games switched off (or in the standard build, where it just
  // rides along unused); the ONE place "games off" actually withholds
  // anything is the IPC allowlist (core/variant.js's FEATURE_IPC.games) and
  // the router's own gate (core/router.js), both of which never touch this
  // instance when the flag is off. Simpler than a PROFILE.games-conditional
  // construction, and keeps the standard build byte-identical in behaviour.
  gameScores = new GameScores(app.getPath('userData'));
  tools = new ToolService({ config, shell, app, emit: sendEverywhere });
  documents = PROFILE.documents ? new DocumentService({ config, shell, emit: sendEverywhere }) : null;
  // getCameras/getAi are lazy getters: `cameras` isn't constructed until
  // below, and `ai` cannot be passed to its own registry before `new
  // AIService(...)` returns. Both closures resolve once the module-level
  // `let` bindings are assigned, without reordering construction.
  ai = new AIService(config, buildToolRegistry({ tools, tasks, memory, config, documents, getCameras: () => cameras, getAi: () => ai }), { profile: PROFILE, jrPromptRules: jrPromptRulesThunk });
  ollama = new OllamaService({ config, emit: sendEverywhere });
  // Go2RtcManager/CameraService gate together on PROFILE.cameras. cameras CAN
  // be true in JR (a parent-enabled checklist item) independently of
  // autonomy/defense, which are always off in JR — so the alert closure below
  // null-checks both rather than assume the always-on-in-standard case.
  if (PROFILE.cameras) {
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
          if (autonomy) autonomy.handleCameraAlert(payload);
          pushCameraAlertToPhones(payload);
          // Defense mode listens where the alert is born too. The service does
          // its own opt-in/armed/night checks and always announces before entry.
          if (defense) defense.handleCameraAlert(payload);
        }
      },
      notify: (title, body) => {
        if (Notification.isSupported()) new Notification({ title, body, icon: path.join(__dirname, 'assets', 'icon.png') }).show();
      },
      notifyGate: (alert) => (autonomy ? autonomy.notifyGate(alert) : true)
    });
    // Smart alerts: describe the frame with the local vision model when the
    // user has AI descriptions turned on. Failures fall back to generic text.
    cameras.describeFrame = async (jpegBase64, context) => {
      if (config.getSettings().cameraAiDescriptions !== true) return null;
      const described = await ai.describeCameraFrame(jpegBase64, context.name);
      return described.ok ? described.text : null;
    };
    if (isPro(currentLicenseState())) {
      cameras.init();
      camerasInitialized = true;
    } else if ((config.getSettings().cameraAccounts || []).length) {
      log.write({ type: 'license', command: 'cameras-init-skipped', response: 'Saved cameras stay dormant until JARVIS Pro is activated.', source: 'license' });
    }
  } else {
    go2rtc = null;
    cameras = null;
  }
  claudeBridge = PROFILE.claudeBridge ? new ClaudeBridge({
    config,
    transcript: createTranscript(app.getPath('userData')),
    log
  }) : null;
  // Slice 1 of JARVIS's "hands": reads the screen, clicks nothing. Shows the
  // same "viewing your screen" indicator the cloud-vision feature uses, since a
  // read is a privacy event even though it changes nothing on the PC. The
  // helper lives in scripts/ (kept out of the asar so it runs from disk).
  screenReader = PROFILE.screenRead ? new ScreenReader({
    scriptPath: path.join(__dirname, 'scripts', 'read-screen.ps1'),
    log,
    onViewing: (active) => sendEverywhere('screen:viewing', { active })
  }) : null;
  // Slice 2 of the hands: the session referee, backed by one persistent
  // drive-screen.ps1 helper per approved session. The voice route arrives in
  // its own commit — until then no plan can reach run(). Every stop path is
  // live already.
  hands = PROFILE.screenDrive ? new ScreenHands({
    driverFactory: () => new ScreenDriver({ scriptPath: path.join(__dirname, 'scripts', 'drive-screen.ps1'), log }),
    getSettings: licensedSettings,
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
  }) : null;
  // The router only ever reads settings (no writes, no secrets), so it takes
  // the gated view too: voice-routing into screen reading/driving respects
  // the license without the router knowing licenses exist.
  // The browser wall, seam 3: the stranger partition itself. Permissions are
  // refused unconditionally and downloads are cancelled before a byte lands —
  // both with an honest toast so the page's silence isn't mistaken for JARVIS's.
  const strangerSession = session.fromPartition(BROWSER_PARTITION);
  strangerSession.setPermissionRequestHandler((_webContents, kind, callback) => {
    callback(decidePermission());
    sendEverywhere('browser:notice', { message: `The page asked for ${kind} — refused, as designed.` });
  });
  strangerSession.on('will-download', (event) => {
    if (!shouldBlockDownload()) return;
    event.preventDefault();
    sendEverywhere('browser:notice', { message: "Downloads are switched off in JARVIS's browser for now." });
  });

  // Defense mode: the camera module's fullscreen posture. Same gated config
  // discipline as the router — the service checks the licence itself at its
  // single entry seam, so it must see the EFFECTIVE licence (gatedConfig
  // carries it), not the persisted one; every fetch it makes is
  // allowlist-checked. Raw config here once left defense dead on builds that
  // never activated a key, effective licence or not.
  defense = PROFILE.defense ? new DefenseService({ config: gatedConfig, ai, cameras, emit: sendEverywhere, log }) : null;
  if (defense) defense.start();
  router = new CommandRouter({
    config: gatedConfig, tools, documents, ai, memory, tasks, log, cameras,
    claude: claudeBridge, screen: screenReader, hands, defense,
    profile: PROFILE, jrAge: () => (parentControls ? parentControls.age() : 11)
  });
  // ScheduleStore/ScheduleService gate on PROFILE.schedules; NightShiftService
  // gates separately on PROFILE.nightShift (both are always off in JR, but
  // are independent flags in principle — see core/variant.js).
  scheduleStore = PROFILE.schedules ? new ScheduleStore(app.getPath('userData')) : null;
  nightShift = PROFILE.nightShift ? new NightShiftService({ userDataPath: app.getPath('userData'), config: gatedConfig, ai, documents }) : null;
  scheduleService = PROFILE.schedules ? new ScheduleService({ store: scheduleStore, config: gatedConfig, router, nightShift, emit: sendEverywhere, log }) : null;
  if (scheduleService) {
    scheduleService.start().catch((error) => {
      log.write({ type: 'schedule-error', command: 'boot-start', response: error && error.message ? error.message : String(error), source: 'schedule' });
    });
  }
  heartbeat = new HeartbeatService({
    config,
    // night-shift-failures reads nightShift directly with no null-check of
    // its own (core/heartbeat.js, out of this task's file list) — dropped
    // rather than fed a nightShift it would crash on the first tick.
    checks: buildDefaultChecks({ tasks, crashLog, nightShift }).filter((check) => check.name !== 'night-shift-failures' || nightShift),
    emit: sendEverywhere,
    log
  });
  heartbeat.start();
  powerMonitor.on('resume', () => {
    try {
      if (scheduleService) scheduleService.arm();
      maybeMorningReport();
    } catch (error) {
      log.write({ type: 'schedule-error', command: 'resume-arm', response: error && error.message ? error.message : String(error), source: 'schedule' });
    }
  });
  folderWatch = PROFILE.autonomy ? new FolderWatchService({
    config,
    emit: sendEverywhere,
    notify: (title, body) => {
      if (Notification.isSupported()) new Notification({ title, body, icon: path.join(__dirname, 'assets', 'icon.png') }).show();
    }
  }) : null;
  localVoice = new LocalVoiceService({
    voiceRoot: voiceDataRoot(),
    scriptPath: packagedScript('local_voice.py'),
    config,
    emit: sendEverywhere
  });
  // JARVIS's speaking voice. localVoice above is the opposite direction —
  // that one hears (Whisper), this one talks (Kokoro).
  voiceService = new VoiceService({
    getSettings: () => config.getSettings(),
    cacheDir: path.join(app.getPath('userData'), 'voice-cache'),
    onStatus: (status) => sendEverywhere('tts:status', status)
  });
  // MobileServer/MobileAuth gate on PROFILE.phone — always off in JR. A kid
  // reaching settings:save can still flip the mobileEnabled setting bit
  // (see task-6-report.md); syncMobileServer() itself now no-ops when
  // mobileServer/mobileAuth were never constructed, so that flip does
  // nothing rather than crashing on a null service.
  mobileAuth = PROFILE.phone ? new MobileAuth({ devices: loadMobileDevices() }) : null;
  mobileServer = PROFILE.phone ? new MobileServer({
    config, router, auth: mobileAuth, documents,
    transcribe: (buffer, mimeType) => localVoice.transcribe(buffer, mimeType),
    // The phone does no synthesis: the PC renders and streams it the audio, so
    // both surfaces come out of the same warm model in the same voice.
    synthesize: (text, options) => voiceService.synthesize(text, options),
    staticDir: path.join(__dirname, 'src', 'mobile'),
    orbsDir: path.join(__dirname, 'src', 'orbs'),
    onDevicesChanged: saveMobileDevices,
    // Lazy getter: `cameras` is constructed above (before mobileServer), but
    // this keeps the same defensive pattern used for buildToolRegistry's
    // getCameras — cameras may be reassigned or absent in some code paths.
    getCameras: () => cameras
  }) : null;
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
  // Loading ~326 MB of model takes a moment, so start it now rather than on the
  // first thing JARVIS says. Until it is ready every caller falls back to the
  // system voice, so he can talk from the first second either way.
  voiceService.start();
  if (folderWatch) folderWatch.start();
  setInterval(checkTaskReminders, 30000);
  setTimeout(() => maybeMorningReport(), 12000);
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
  voiceService?.stop();
  mobileServer?.stop();
  scheduleService?.stop();
  cameras?.shutdown();
});
app.on('window-all-closed', () => { if (isQuitting) app.quit(); });
