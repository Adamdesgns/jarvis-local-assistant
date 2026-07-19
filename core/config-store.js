const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_SETTINGS } = require('./defaults');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeSettings(defaults, saved) {
  const result = { ...clone(defaults), ...(saved || {}) };
  result.projects = { ...clone(defaults.projects), ...((saved || {}).projects || {}) };
  result.applications = { ...clone(defaults.applications), ...((saved || {}).applications || {}) };
  result.moduleLayout = { ...clone(defaults.moduleLayout), ...((saved || {}).moduleLayout || {}) };
  result.routines = { ...clone(defaults.routines || {}), ...((saved || {}).routines || {}) };
  result.autonomyRules = { ...clone(defaults.autonomyRules || {}), ...((saved || {}).autonomyRules || {}) };
  if (Number(saved?.settingsVersion || 0) < 5) {
    result.hiddenModules = [...new Set([...(result.hiddenModules || []), 'document-viewer'])];
  }
  if (Number(saved?.settingsVersion || 0) < 6) {
    result.hiddenModules = [...new Set([...(result.hiddenModules || []), 'cameras'])];
  }
  result.settingsVersion = 6;
  result.cameraAccounts = Array.isArray(result.cameraAccounts) ? result.cameraAccounts : [];
  if (!['local', 'cloud', 'auto'].includes(result.aiMode)) result.aiMode = 'local';
  // Never allow a stale V1 address to redirect the private local Ollama connection.
  result.ollamaUrl = 'http://127.0.0.1:11434';
  delete result.transcriptionModel;
  return result;
}

class ConfigStore {
  constructor(userDataPath, safeStorage = null) {
    this.directory = userDataPath;
    this.filePath = path.join(userDataPath, 'settings.json');
    this.safeStorage = safeStorage;
    this.data = this.#load();
    // Picovoice is no longer used. OpenAI remains optional and encrypted locally.
    delete this.data.secrets.picovoiceKey;
    this.#persist();
  }

  #load() {
    try {
      const saved = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      return {
        settings: mergeSettings(DEFAULT_SETTINGS, saved.settings),
        secrets: saved.secrets || {}
      };
    } catch {
      return { settings: clone(DEFAULT_SETTINGS), secrets: {} };
    }
  }

  #persist() {
    fs.mkdirSync(this.directory, { recursive: true });
    const temp = `${this.filePath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(temp, this.filePath);
  }

  publicSettings() {
    return clone(this.data.settings);
  }

  getSettings() {
    return clone(this.data.settings);
  }

  updateSettings(patch) {
    const allowed = [
      'profileName', 'assistantName', 'aiMode', 'ollamaModel', 'ollamaUrl', 'openaiModel',
      'cloudProvider', 'anthropicModel',
      'voiceEnabled', 'localVoiceEnabled', 'localVoiceModel', 'wakeWordEnabled',
      'wakeSensitivity', 'startWithWindows', 'minimizeToOrb', 'orbAlwaysOnTop',
      'motionMode', 'hiddenModules', 'moduleLayout', 'searchRoots', 'projects',
      'focusApps', 'personality', 'pinnedFolders', 'recentFiles', 'watchedFolders', 'routines',
      'cameraAccounts', 'cameraAiDescriptions', 'cameraCloudVision', 'cameraVisionModel',
      'autonomyEnabled', 'schedulesEnabled', 'autonomyRules', 'autonomyNightStart', 'autonomyNightEnd',
      'skin', 'voiceName', 'orbBounds', 'mobileEnabled', 'mobilePort'
    ];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        this.data.settings[key] = patch[key];
      }
    }
    this.data.settings = mergeSettings(DEFAULT_SETTINGS, this.data.settings);
    this.#persist();
    return this.publicSettings();
  }

  setSecret(name, value) {
    if (!value) {
      delete this.data.secrets[name];
      this.#persist();
      return;
    }

    if (name === 'openaiKey' && !this.safeStorage?.isEncryptionAvailable()) {
      throw new Error('Windows secure storage is unavailable, so JARVIS did not save the API key.');
    }
    if (this.safeStorage?.isEncryptionAvailable()) {
      this.data.secrets[name] = {
        encrypted: true,
        value: this.safeStorage.encryptString(value).toString('base64')
      };
    } else {
      this.data.secrets[name] = { encrypted: false, value };
    }
    this.#persist();
  }

  getSecret(name) {
    const entry = this.data.secrets[name];
    if (!entry?.value) return '';
    try {
      if (entry.encrypted && this.safeStorage?.isEncryptionAvailable()) {
        return this.safeStorage.decryptString(Buffer.from(entry.value, 'base64'));
      }
      return entry.encrypted ? '' : entry.value;
    } catch {
      return '';
    }
  }
}

module.exports = { ConfigStore, mergeSettings };
