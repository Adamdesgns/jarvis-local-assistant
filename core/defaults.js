const path = require('node:path');
const os = require('node:os');

function windowsHomeFolder(name) {
  return process.platform === 'win32'
    ? path.join(os.homedir(), name)
    : path.join(os.homedir(), name);
}

const DEFAULT_SETTINGS = {
  settingsVersion: 10,
  profileName: 'User',
  assistantName: 'JARVIS',
  // When the assistant was named on first run ('' = never asked). The stamp,
  // not the name, is what stops the retail naming screen from re-appearing —
  // and the v10 migration sets it for every EXISTING install, because a
  // machine that has been running JARVIS was named in spirit long ago.
  assistantNamedAt: '',
  aiMode: 'local',
  cloudProvider: 'anthropic',
  openaiModel: 'gpt-5-mini',
  anthropicModel: 'claude-sonnet-5',
  ollamaModel: 'qwen3:8b',
  ollamaUrl: 'http://127.0.0.1:11434',
  voiceEnabled: true,
  localVoiceEnabled: true,
  localVoiceModel: 'small.en',
  wakeWordEnabled: true,
  // 0.55 matches the threshold that was hardcoded in local_voice.py before
  // this setting was wired through — wiring it must not shift behavior.
  wakeSensitivity: 0.55,
  claudeBridgeEnabled: false,
  claudeBridgeSessionId: '',
  claudeCliPath: '',
  screenControlEnabled: false,
  screenControlAllowlist: ['explorer', 'notepad'],
  screenDriveEnabled: false,
  mobileEnabled: false,
  mobilePort: 27183,
  mobilePublicUrl: '',
  startWithWindows: false,
  minimizeToOrb: true,
  orbAlwaysOnTop: true,
  motionMode: 'cinematic',
  hiddenModules: ['performance', 'memory', 'activity', 'quick-commands', 'projects', 'file-explorer', 'document-viewer', 'cameras', 'night-shift', 'terminal', 'browser'],
  cameraAccounts: [],
  cameraAiDescriptions: true,
  cameraCloudVision: false,
  cameraVisionModel: 'gemma3:4b',
  // Defense mode: the situation-board posture. Auto-triggers are opt-in and
  // OFF by default — the mode never takes the screen without prior consent.
  defense: {
    countyZone: '',
    countyName: '',
    countyState: '',
    autoWeather: false,
    autoCamera: false,
    rssFeeds: []
  },
  autonomyEnabled: false,
  schedulesEnabled: false,
  autonomyRules: {
    speakDoorbell: false,
    nightMotionOnly: false,
    someoneHereCard: false,
    speakMotion: false
  },
  autonomyNightStart: 21,
  autonomyNightEnd: 7,
  skin: 'classic',
  orbSkin: 'original',
  orbColor: 'gold',
  windowGlass: 'glass',
  nightShiftEnabled: false,
  nightShiftStart: 0,
  nightShiftEnd: 6,
  nightShiftMaxJobs: 10,
  nightShiftMaxMinutes: 10,
  nightShiftCloudBudgetUsd: 0,
  nightShiftFolder: '',
  heartbeatEnabled: false,
  heartbeatMinutes: 30,
  // JARVIS Pro license state. Written only by ConfigStore.setLicenseState
  // from the main process — never through the renderer's settings:save path.
  license: {
    status: 'none',
    productName: '',
    customerName: '',
    activatedAt: '',
    instanceId: '',
    lastValidatedAt: ''
  },
  // How JARVIS speaks. 'kokoro' is the real voice (Kokoro-82M on the GPU);
  // 'system' pins him to the Windows SAPI voices, which is also where he falls
  // back automatically whenever Kokoro is unavailable.
  ttsEngine: 'kokoro',
  // bm_daniel: chosen by Adam by ear from the eight-voice audition bench. It is
  // the lowest-GRADED candidate, which is fine — the grades measure fidelity to
  // training data, not whether a voice suits JARVIS.
  kokoroVoice: 'bm_daniel',
  // Escape hatch. Every fp16 dtype on this GPU renders NaN-filled silence
  // while reporting success, so a machine whose GPU misbehaves needs a way to
  // be forced onto the (slower, reliable) CPU path.
  kokoroDevice: 'auto',
  // The Windows SAPI voice, used by the fallback path.
  voiceName: '',
  orbBounds: null,
  moduleLayout: {
    tasks: { x: 74, y: 8, w: 24, h: 58 },
    performance: { x: 2, y: 8, w: 22, h: 44 },
    memory: { x: 2, y: 54, w: 24, h: 36 },
    activity: { x: 74, y: 62, w: 24, h: 32 },
    'quick-commands': { x: 2, y: 54, w: 22, h: 38 },
    projects: { x: 74, y: 8, w: 24, h: 38 },
    'file-explorer': { x: 12, y: 6, w: 76, h: 78 },
    'document-viewer': { x: 18, y: 5, w: 64, h: 76 },
    cameras: { x: 26, y: 8, w: 46, h: 60 },
    'night-shift': { x: 38, y: 8, w: 24, h: 42 },
    terminal: { x: 28, y: 46, w: 44, h: 46 },
    browser: { x: 22, y: 8, w: 56, h: 72 }
  },
  searchRoots: [
    windowsHomeFolder('Documents'),
    windowsHomeFolder('Desktop'),
    windowsHomeFolder('Downloads')
  ],
  projects: {
    anvil: '',
    'the bench': '',
    adamscraft: ''
  },
  applications: {
    explorer: { command: 'explorer.exe', aliases: ['files', 'file explorer'] },
    chrome: { command: 'chrome.exe', aliases: ['google chrome', 'browser'] },
    'vs code': { command: 'code.cmd', aliases: ['visual studio code', 'code'] },
    terminal: { command: 'wt.exe', aliases: ['windows terminal'] },
    calculator: { command: 'calc.exe', aliases: ['calc'] },
    notepad: { command: 'notepad.exe', aliases: [] },
    claude: { command: 'claude.exe', aliases: ['claude desktop'] }
  },
  focusApps: ['chrome', 'vs code'],
  routines: {
    'start work': { apps: ['chrome'], folders: ['anvil'] }
  },
  personality: 'Witty, composed, loyal, and lightly sarcastic. Reads like a sharp human assistant with dry humor, never like a chatbot or movie script. Casual greetings get casual answers before any offer to help.'
};

module.exports = { DEFAULT_SETTINGS };
