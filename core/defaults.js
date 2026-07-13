const path = require('node:path');
const os = require('node:os');

function windowsHomeFolder(name) {
  return process.platform === 'win32'
    ? path.join(os.homedir(), name)
    : path.join(os.homedir(), name);
}

const DEFAULT_SETTINGS = {
  settingsVersion: 5,
  profileName: 'User',
  assistantName: 'JARVIS',
  aiMode: 'local',
  openaiModel: 'gpt-5-mini',
  ollamaModel: 'qwen3:8b',
  ollamaUrl: 'http://127.0.0.1:11434',
  voiceEnabled: true,
  localVoiceEnabled: true,
  localVoiceModel: 'small.en',
  wakeWordEnabled: true,
  wakeSensitivity: 0.58,
  startWithWindows: false,
  minimizeToOrb: true,
  orbAlwaysOnTop: true,
  motionMode: 'cinematic',
  hiddenModules: ['performance', 'memory', 'activity', 'quick-commands', 'projects', 'file-explorer', 'document-viewer'],
  moduleLayout: {
    tasks: { x: 74, y: 8, w: 24, h: 58 },
    performance: { x: 2, y: 8, w: 22, h: 44 },
    memory: { x: 2, y: 54, w: 24, h: 36 },
    activity: { x: 74, y: 62, w: 24, h: 32 },
    'quick-commands': { x: 2, y: 54, w: 22, h: 38 },
    projects: { x: 74, y: 8, w: 24, h: 38 },
    'file-explorer': { x: 12, y: 6, w: 76, h: 78 },
    'document-viewer': { x: 18, y: 5, w: 64, h: 76 }
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
  personality: 'Calm, concise, capable, lightly witty, and never theatrical at the expense of clarity.'
};

module.exports = { DEFAULT_SETTINGS };
