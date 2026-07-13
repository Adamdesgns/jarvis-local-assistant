const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

class LocalVoiceService {
  constructor({ voiceRoot, scriptPath, config, emit }) {
    this.voiceRoot = voiceRoot;
    this.scriptPath = scriptPath;
    this.config = config;
    this.emit = emit || (() => {});
    this.process = null;
    this.pending = new Map();
    this.buffer = '';
    this.status = { installed: false, running: false, wakeReady: false, message: 'Local voice not installed' };
  }

  pythonPath() {
    return process.platform === 'win32'
      ? path.join(this.voiceRoot, '.venv', 'Scripts', 'python.exe')
      : path.join(this.voiceRoot, '.venv', 'bin', 'python');
  }

  getStatus() {
    return { ...this.status, installed: fs.existsSync(this.pythonPath()) };
  }

  start() {
    if (this.process || !fs.existsSync(this.pythonPath())) {
      this.status.installed = fs.existsSync(this.pythonPath());
      return this.getStatus();
    }
    const settings = this.config.getSettings();
    this.process = spawn(this.pythonPath(), ['-u', this.scriptPath, '--service'], {
      cwd: this.voiceRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        JARVIS_WHISPER_MODEL: settings.localVoiceModel || 'small.en',
        JARVIS_WAKE_ENABLED: settings.wakeWordEnabled === false ? '0' : '1'
      }
    });
    this.status = { installed: true, running: true, wakeReady: false, message: 'Starting local voice' };
    this.process.stdout.setEncoding('utf8');
    this.process.stdout.on('data', (chunk) => this.#readLines(chunk));
    this.process.stderr.setEncoding('utf8');
    this.process.stderr.on('data', (chunk) => this.emit('voice:log', String(chunk).trim()));
    this.process.on('exit', (code) => {
      this.process = null;
      this.status = { installed: true, running: false, wakeReady: false, message: `Local voice stopped${code ? ` (${code})` : ''}` };
      this.emit('voice:status', this.getStatus());
      for (const pending of this.pending.values()) pending.reject(new Error('Local voice stopped unexpectedly.'));
      this.pending.clear();
    });
    return this.getStatus();
  }

  stop() {
    if (!this.process) return;
    this.#send({ type: 'shutdown' });
    setTimeout(() => this.process?.kill(), 1500);
  }

  #readLines(chunk) {
    this.buffer += chunk;
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      try { this.#handle(JSON.parse(line)); }
      catch { this.emit('voice:log', line); }
    }
  }

  #handle(message) {
    if (message.type === 'ready') {
      this.status = { installed: true, running: true, wakeReady: Boolean(message.wakeReady), message: message.message || 'Local voice ready' };
      this.emit('voice:status', this.getStatus());
    } else if (message.type === 'wake') {
      this.emit('wake:detected', { label: 'HEY JARVIS', score: message.score });
    } else if (message.type === 'result' || message.type === 'error') {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      try { fs.unlinkSync(pending.filePath); } catch {}
      if (message.type === 'error') pending.reject(new Error(message.message));
      else pending.resolve(String(message.text || '').trim());
    } else if (message.type === 'status') {
      this.emit('voice:status', { ...this.getStatus(), message: message.message });
    }
  }

  #send(message) {
    if (!this.process?.stdin?.writable) throw new Error('Local voice is not running.');
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async diagnose() {
    const base = {
      installed: fs.existsSync(this.pythonPath()),
      running: Boolean(this.process),
      wakeReady: Boolean(this.status.wakeReady),
      statusMessage: this.status.message,
      pythonPath: this.pythonPath(),
      python: '',
      whisperModel: '',
      checks: {}
    };
    if (!base.installed) return base;

    const settings = this.config.getSettings();
    return new Promise((resolve) => {
      const child = spawn(this.pythonPath(), ['-u', this.scriptPath, '--diagnose'], {
        cwd: this.voiceRoot,
        windowsHide: true,
        env: {
          ...process.env,
          JARVIS_WHISPER_MODEL: settings.localVoiceModel || 'small.en'
        }
      });
      let output = '';
      let settled = false;
      const finish = (extra) => {
        if (settled) return;
        settled = true;
        resolve({ ...base, ...extra });
      };
      const timeout = setTimeout(() => { child.kill(); finish({ statusMessage: 'The diagnostic check timed out.' }); }, 25000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.on('error', (error) => { clearTimeout(timeout); finish({ statusMessage: error.message }); });
      child.on('close', () => {
        clearTimeout(timeout);
        const line = output.split('\n').reverse().find((item) => item.includes('"diagnostic"'));
        try {
          const parsed = JSON.parse(line);
          finish({ python: parsed.python, whisperModel: parsed.whisperModel, checks: parsed.checks || {} });
        } catch {
          finish({ statusMessage: 'The diagnostic check returned no readable result.' });
        }
      });
    });
  }

  async transcribe(buffer, mimeType = 'audio/webm') {
    if (!this.process) this.start();
    if (!this.process) throw new Error('Install Local Voice from Settings first. No paid API is required.');
    const id = crypto.randomUUID();
    const extension = mimeType.includes('wav') ? 'wav' : mimeType.includes('mp4') ? 'mp4' : 'webm';
    const filePath = path.join(os.tmpdir(), `jarvis-${id}.${extension}`);
    fs.writeFileSync(filePath, buffer);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        try { fs.unlinkSync(filePath); } catch {}
        reject(new Error('Local transcription took too long.'));
      }, 90000);
      this.pending.set(id, {
        filePath,
        resolve: (value) => { clearTimeout(timeout); resolve(value); },
        reject: (error) => { clearTimeout(timeout); reject(error); }
      });
      this.#send({ type: 'transcribe', id, filePath });
    });
  }
}

const REPORT_ROWS = [
  ['micPermission', 'Microphone permission'],
  ['microphone', 'Microphone device'],
  ['installed', 'Python voice environment'],
  ['speechModel', 'Speech model'],
  ['wakeModel', 'Wake-word model'],
  ['running', 'Voice service running'],
  ['wakeReady', 'Wake word listening']
];

function buildDiagnosticReport(diagnostic = {}) {
  const checks = diagnostic.checks || {};
  const value = (key) => {
    if (key === 'micPermission') return { ok: diagnostic.micPermission === 'granted', detail: diagnostic.micPermission || 'unknown' };
    if (key === 'installed') return { ok: Boolean(diagnostic.installed), detail: diagnostic.installed ? `Python ${diagnostic.python || ''}`.trim() : 'Run Install / Repair Local Voice' };
    if (key === 'running') return { ok: Boolean(diagnostic.running), detail: diagnostic.statusMessage || '' };
    if (key === 'wakeReady') return { ok: Boolean(diagnostic.wakeReady), detail: diagnostic.wakeReady ? 'Say Hey Jarvis' : 'Wake word is off or still starting' };
    return { ok: Boolean(checks[key]?.ok), detail: String(checks[key]?.detail || 'Not checked') };
  };
  const lines = ['JARVIS VOICE DIAGNOSTIC REPORT', `Generated: ${new Date().toLocaleString()}`, ''];
  for (const [key, label] of REPORT_ROWS) {
    const { ok, detail } = value(key);
    lines.push(`[${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
  }
  if (diagnostic.whisperModel) lines.push('', `Speech model setting: ${diagnostic.whisperModel}`);
  return lines.join('\n');
}

module.exports = { LocalVoiceService, buildDiagnosticReport, REPORT_ROWS };
