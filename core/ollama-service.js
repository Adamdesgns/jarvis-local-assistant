const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

class OllamaService {
  constructor({ config, emit }) {
    this.config = config;
    this.emit = emit;
    this.connection = null;
  }

  announce(payload) {
    this.emit('ollama:status', payload);
    return payload;
  }

  executable() {
    if (process.platform !== 'win32') return 'ollama';
    const local = process.env.LOCALAPPDATA || '';
    const candidates = [
      path.join(local, 'Programs', 'Ollama', 'ollama.exe'),
      path.join(local, 'Ollama', 'ollama.exe'),
      'ollama.exe'
    ];
    return candidates.find((candidate) => candidate === 'ollama.exe' || fs.existsSync(candidate));
  }

  async request(endpoint, options = {}, timeoutMs = 5000) {
    const settings = this.config.getSettings();
    const baseUrl = String(settings.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(`${baseUrl}${endpoint}`, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  async serverStatus() {
    try {
      const response = await this.request('/api/tags');
      if (!response.ok) return { online: false, models: [] };
      const payload = await response.json();
      return { online: true, models: payload.models || [] };
    } catch {
      return { online: false, models: [] };
    }
  }

  startServer() {
    try {
      const child = spawn(this.executable(), ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
      child.on('error', () => {});
      child.unref();
      return true;
    } catch {
      return false;
    }
  }

  async waitForServer() {
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const status = await this.serverStatus();
      if (status.online) return status;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return { online: false, models: [] };
  }

  hasModel(models, requested) {
    const wanted = String(requested).toLowerCase();
    return models.some((item) => String(item.name || item.model || '').toLowerCase() === wanted);
  }

  usableModel(models) {
    return models.find((item) => !/embed/i.test(String(item.name || item.model || ''))) || models[0] || null;
  }

  async pullModel(model) {
    const response = await this.request('/api/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: true })
    }, 60 * 60 * 1000);
    if (!response.ok || !response.body) throw new Error(`Model download returned ${response.status}.`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const item = JSON.parse(line);
        if (item.error) throw new Error(item.error);
        const percent = item.total ? Math.max(0, Math.min(100, Math.round((item.completed / item.total) * 100))) : null;
        this.announce({
          state: 'downloading', ready: false, percent,
          message: percent === null ? String(item.status || 'Preparing local model…') : `Downloading ${model} — ${percent}%`
        });
      }
    }
  }

  async connect() {
    if (this.connection) return this.connection;
    this.connection = this._connect().finally(() => { this.connection = null; });
    return this.connection;
  }

  async _connect() {
    const model = this.config.getSettings().ollamaModel || 'qwen3:8b';
    this.announce({ state: 'connecting', ready: false, message: 'Connecting to the local brain…' });
    let status = await this.serverStatus();
    if (!status.online) {
      this.announce({ state: 'starting', ready: false, message: 'Starting Ollama…' });
      this.startServer();
      status = await this.waitForServer();
    }
    if (!status.online) {
      return this.announce({ state: 'needs-install', ready: false, message: 'Ollama could not be started. Install Ollama, then select Connect again.' });
    }
    let selectedModel = model;
    if (!this.hasModel(status.models, model) && status.models.length) {
      const installed = this.usableModel(status.models);
      selectedModel = String(installed.name || installed.model);
      this.config.updateSettings({ ollamaModel: selectedModel, ollamaUrl: 'http://127.0.0.1:11434' });
      this.announce({ state: 'connecting', ready: false, message: `Using your installed Ollama model: ${selectedModel}` });
    } else if (!this.hasModel(status.models, model)) {
      try {
        this.announce({ state: 'downloading', ready: false, percent: 0, message: `Preparing to download ${model}…` });
        await this.pullModel(model);
      } catch (error) {
        return this.announce({ state: 'error', ready: false, message: `Ollama setup failed: ${error.message}` });
      }
    }
    return this.announce({ state: 'online', ready: true, percent: 100, model: selectedModel, message: `${selectedModel} is connected and ready.` });
  }
}

module.exports = { OllamaService };
