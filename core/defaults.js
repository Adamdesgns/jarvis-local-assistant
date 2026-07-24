const path = require('node:path');
const os = require('node:os');

function windowsHomeFolder(name) {
  return process.platform === 'win32'
    ? path.join(os.homedir(), name)
    : path.join(os.homedir(), name);
}

const DEFAULT_SETTINGS = {
  settingsVersion: 6,
  profileName: 'User',
  assistantName: 'JARVIS',
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
  wakeSensitivity: 0.58,
  claudeBridgeEnabled: false,
  claudeBridgeSessionId: '',
  claudeCliPath: '',
  screenControlEnabled: false,
  screenControlAllowlist: ['explorer', 'chrome'],
  mobileEnabled: false,
  mobilePort: 27183,
  mobilePublicUrl: '',
  startWithWindows: false,
  minimizeToOrb: true,
  orbAlwaysOnTop: true,
  motionMode: 'cinematic',
  hiddenModules: ['performance', 'memory', 'activity', 'quick-commands', 'projects', 'file-explorer', 'document-viewer', 'cameras'],
  cameraAccounts: [],
  cameraAiDescriptions: true,
  cameraCloudVision: false,
  cameraVisionModel: 'gemma3:4b',
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
    cameras: { x: 26, y: 8, w: 46, h: 60 }
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
