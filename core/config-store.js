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
  result.license = { ...clone(defaults.license || {}), ...((saved || {}).license || {}) };
  result.defense = { ...clone(defaults.defense || {}), ...((saved || {}).defense || {}) };
  if (Number(saved?.settingsVersion || 0) < 5) {
    result.hiddenModules = [...new Set([...(result.hiddenModules || []), 'document-viewer'])];
  }
  if (Number(saved?.settingsVersion || 0) < 6) {
    result.hiddenModules = [...new Set([...(result.hiddenModules || []), 'cameras'])];
  }
  if (Number(saved?.settingsVersion || 0) < 7) {
    // v1 of screen driving: Explorer + Notepad only. Installs that saved the
    // old ['explorer', 'chrome'] default get pulled back — Chrome waits for
    // v2. screen-guard's V1_DRIVE_APPS clamps this in code as well; this
    // migration just keeps settings.json honest about what is possible.
    result.screenControlAllowlist = ['explorer', 'notepad'];
  }
  // v8 introduces the JARVIS Pro license object — and deliberately flips
  // nothing else. Pro flags a user already saved (from testing, or from a
  // pre-Pro build) stay in the file exactly as they were; the runtime seams
  // refuse to run them until a license is active, and the PRO settings tab
  // explains why. Activating lights everything back up with no reconfiguring.
  result.settingsVersion = 8;
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
      'skin', 'voiceName', 'orbBounds', 'mobileEnabled', 'mobilePort', 'mobilePublicUrl',
      // Ask-Claude bridge: these existed in defaults but were never in this
      // allowlist, so the Settings toggle and the stored conversation id were
      // silently dropped by updateSettings. Persist them.
      'claudeBridgeEnabled', 'claudeBridgeSessionId', 'claudeCliPath',
      // Screen reading (JARVIS's "hands", slice 1) — off by default.
      'screenControlEnabled', 'screenControlAllowlist',
      // Screen driving (slice 2) — its own switch, off by default, so reading
      // can be on while the hands stay off.
      'screenDriveEnabled',
      // The look: orb soul/color picker, window glass. These applied live but
      // silently reset on save until test/settings-persistence.test.js began
      // asserting every key the settings dialog sends actually persists.
      'orbSkin', 'orbColor', 'windowGlass',
      // Night Shift, heartbeat, and the Defense Mode setup (county, feeds,
      // auto-triggers) — same silent-reset bug, same guard.
      'nightShiftEnabled', 'nightShiftStart', 'nightShiftEnd', 'nightShiftMaxJobs',
      'nightShiftMaxMinutes', 'nightShiftCloudBudgetUsd', 'nightShiftFolder',
      'heartbeatEnabled', 'heartbeatMinutes', 'defense'
      // 'license' is intentionally NOT in this list: settings:save is
      // renderer-reachable, and license state must only ever be written by
      // the main-process LicenseService through setLicenseState below.
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

  // The only write path for JARVIS Pro license state (see the allowlist note
  // in updateSettings). Unknown fields are dropped so a wayward payload can
  // never smuggle arbitrary settings through this side door.
  setLicenseState(state) {
    const fields = ['status', 'productName', 'customerName', 'activatedAt', 'instanceId', 'lastValidatedAt'];
    const next = {};
    for (const field of fields) {
      next[field] = String(state?.[field] ?? '');
    }
    if (!next.status) next.status = 'none';
    this.data.settings.license = next;
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
