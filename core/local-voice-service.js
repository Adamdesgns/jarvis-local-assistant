const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

// The env contract with scripts/local_voice.py — the ONLY channel besides
// stdin commands. JARVIS_ASSISTANT_NAME decides the wake mode over there:
// a Jarvis-sounding name keeps the pre-trained openwakeword path, anything
// else gets the VAD + whisper transcription path so the buyer's chosen name
// actually wakes him. Pure and exported so tests can pin the contract.
function buildServiceEnv(settings = {}) {
  return {
    JARVIS_WHISPER_MODEL: settings.localVoiceModel || 'small.en',
    JARVIS_WAKE_ENABLED: settings.wakeWordEnabled === false ? '0' : '1',
    JARVIS_ASSISTANT_NAME: String(settings.assistantName || 'JARVIS').trim() || 'JARVIS',
    JARVIS_WAKE_SENSITIVITY: String(Number.isFinite(settings.wakeSensitivity) ? settings.wakeSensitivity : 0.55)
  };
}

// Which settings changes require bouncing the python service. assistantName
// is here because the wake MODE depends on it; sensitivity because it is
// read once at spawn. Pure and exported for the same reason as above.
function shouldRestartVoice(previous = {}, updated = {}) {
  return ['wakeWordEnabled', 'localVoiceModel', 'assistantName', 'wakeSensitivity']
    .some((key) => previous[key] !== updated[key]);
}

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
    let child;
    try {
      child = spawn(this.pythonPath(), ['-u', this.scriptPath, '--service'], {
        cwd: this.voiceRoot,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env, ...buildServiceEnv(settings) }
      });
    } catch (error) {
      // Windows throws synchronously for some spawn failures (bad executable).
      this.status = { installed: true, running: false, wakeReady: false, message: `The voice engine could not start: ${error.message}` };
      this.emit('voice:status', this.getStatus());
      return this.getStatus();
    }
    this.process = child;
    this.status = { installed: true, running: true, wakeReady: false, message: 'Starting local voice' };

    // Watchdog: a healthy engine reports ready within seconds. If nothing
    // arrives, kill it and retry once instead of showing "starting" forever.
    clearTimeout(this.readyWatchdog);
    this.readyWatchdog = setTimeout(() => {
      if (this.process !== child || this.status.wakeReady || this.status.message !== 'Starting local voice') return;
      try { child.kill(); } catch {}
      this.process = null;
      if (!this.retriedStart) {
        this.retriedStart = true;
        this.status = { installed: true, running: false, wakeReady: false, message: 'Voice engine stalled — restarting it' };
        this.emit('voice:status', this.getStatus());
        this.start();
      } else {
        this.status = { installed: true, running: false, wakeReady: false, message: 'The voice engine did not start. Open Voice Diagnostics and select Repair Voice.' };
        this.emit('voice:status', this.getStatus());
      }
    }, 20000);

    child.on('error', (error) => {
      // Spawn failures emit 'error' with no 'exit'; without this handler the
      // service would report "starting" forever with no process behind it.
      clearTimeout(this.readyWatchdog);
      if (this.process === child) this.process = null;
      this.status = { installed: true, running: false, wakeReady: false, message: `The voice engine could not start: ${error.message}` };
      this.emit('voice:status', this.getStatus());
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this.#readLines(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => this.emit('voice:log', String(chunk).trim()));
    child.on('exit', (code) => {
      if (this.process === child) this.process = null;
      this.status = { installed: true, running: false, wakeReady: false, message: `Local voice stopped${code ? ` (${code})` : ''}` };
      this.emit('voice:status', this.getStatus());
      for (const pending of this.pending.values()) pending.reject(new Error('Local voice stopped unexpectedly.'));
      this.pending.clear();
    });
    return this.getStatus();
  }

  stop() {
    if (!this.process) return;
    clearTimeout(this.readyWatchdog);
    const child = this.process;
    try { this.#send({ type: 'shutdown' }); } catch {}
    setTimeout(() => { try { child.kill(); } catch {} }, 1500);
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
      clearTimeout(this.readyWatchdog);
      this.retriedStart = false;
      this.status = { installed: true, running: true, wakeReady: Boolean(message.wakeReady), message: message.message || 'Local voice ready' };
      this.emit('voice:status', this.getStatus());
    } else if (message.type === 'wake') {
      // The label is whatever he's called now, not a hardcoded product name.
      // transcript arrives only from transcribe-mode wakes — unused today,
      // it's the seed for tail-as-command and live captions later.
      const name = String(this.config.getSettings().assistantName || 'JARVIS');
      this.emit('wake:detected', { label: `HEY ${name.toUpperCase()}`, score: message.score, transcript: message.transcript || '' });
    } else if (message.type === 'result' || message.type === 'error') {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      try { fs.unlinkSync(pending.filePath); } catch {}
      if (message.type === 'error') pending.reject(new Error(message.message));
      else pending.resolve(String(message.text || '').trim());
    } else if (message.type === 'status') {
      this.status = { ...this.status, message: message.message || this.status.message };
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
        // The full contract, not just the whisper model: --diagnose needs the
        // assistant name to report the right wake MODE and check the right
        // model files for it.
        env: { ...process.env, ...buildServiceEnv(settings) }
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
          finish({ python: parsed.python, whisperModel: parsed.whisperModel, wakeMode: parsed.wakeMode || '', checks: parsed.checks || {} });
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

function buildDiagnosticReport(diagnostic = {}, { assistantName = 'JARVIS' } = {}) {
  const checks = diagnostic.checks || {};
  const value = (key) => {
    if (key === 'micPermission') return { ok: diagnostic.micPermission === 'granted', detail: diagnostic.micPermission || 'unknown' };
    if (key === 'installed') return { ok: Boolean(diagnostic.installed), detail: diagnostic.installed ? `Python ${diagnostic.python || ''}`.trim() : 'Run Install / Repair Local Voice' };
    if (key === 'running') return { ok: Boolean(diagnostic.running), detail: diagnostic.statusMessage || '' };
    if (key === 'wakeReady') return { ok: Boolean(diagnostic.wakeReady), detail: diagnostic.wakeReady ? `Say Hey ${assistantName}` : 'Wake word is off or still starting' };
    return { ok: Boolean(checks[key]?.ok), detail: String(checks[key]?.detail || 'Not checked') };
  };
  const lines = ['VOICE DIAGNOSTIC REPORT', `Generated: ${new Date().toLocaleString()}`, ''];
  for (const [key, label] of REPORT_ROWS) {
    const { ok, detail } = value(key);
    lines.push(`[${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
  }
  if (diagnostic.wakeMode) lines.push('', `Wake mode: ${diagnostic.wakeMode === 'openwakeword' ? 'pre-trained wake model' : 'listening by transcription'}`);
  if (diagnostic.whisperModel) lines.push('', `Speech model setting: ${diagnostic.whisperModel}`);
  return lines.join('\n');
}

module.exports = { LocalVoiceService, buildDiagnosticReport, buildServiceEnv, shouldRestartVoice, REPORT_ROWS };
