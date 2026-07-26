// JARVIS's real voice: Kokoro-82M, rendered on the GPU, serving both the
// desktop and the phone from one warm model.
//
// The whole shape of this file is forced by one measurement: onnxruntime-node
// has no WebGPU backend, so synthesis in the main process is stuck on the CPU
// at RTF 1.2+ (slower than real time, which makes streaming impossible). A
// renderer gets WebGPU and runs at RTF 0.15. So the model lives in a hidden
// window and this service is the coordinator that owns it.
//
// See docs/superpowers/specs/2026-07-26-kokoro-voice-design.md.

const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { BrowserWindow, ipcMain, app } = require('electron');

const MODEL_ID = 'onnx-community/Kokoro-82M-ONNX';

// fp32 is not a preference, it is the only option that works. fp16 and q4f16
// benchmark identically and emit tens of thousands of NaN samples followed by
// pure zeros — full-length audio containing no sound, with no error raised.
const DTYPE = 'fp32';

// A single synthesis should never take this long. If it does, the GPU is wedged
// or the worker died mid-request; fail over to the system voice rather than
// leaving the caller waiting forever on a promise that will not settle.
const REQUEST_TIMEOUT_MS = 30000;

// ---------------------------------------------------------------------------
// Pure decision functions — unit-tested in test/voice-service.test.js without
// ever loading a model or opening a window.
// ---------------------------------------------------------------------------

// Fixed lines (the greeting, "all systems online") are spoken constantly and
// never change. Key on voice too: the same words in a different voice are a
// different sound file.
function cacheKeyFor(voice, text) {
  const normalized = String(text || '').trim().replace(/\s+/g, ' ').toLowerCase();
  return `${voice}-${crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 16)}`;
}

// The failure that matters here is silent, not loud: a broken render returns a
// correctly-sized buffer full of NaN or zeros and raises nothing. Nobody on this
// project can hear the output, so "did it work" is decided by arithmetic.
//
// Thresholds: real speech from this model measures peak 0.69-0.92 and RMS
// 0.073-0.119. Anything below peak 0.05 / RMS 0.005 is silence with a header.
function isAudioUsable(stats) {
  if (!stats) return false;
  const { peak = 0, rms = 0, nan = 0, samples = 0 } = stats;
  if (!samples) return false;
  if (nan > 0) return false;
  return peak > 0.05 && rms > 0.005;
}

// Kokoro is the voice; the system voice is the safety net. Fall back whenever
// Kokoro cannot be trusted to produce sound — not just when it errors.
function shouldFallback({ engine, workerReady, modelReady, lastError } = {}) {
  if (engine === 'system') return true;
  if (!workerReady || !modelReady) return true;
  return Boolean(lastError);
}

// Strip the markdown JARVIS's brain sometimes emits. Spoken asterisks are the
// fastest way to make a good voice sound broken.
function speakableText(message) {
  return String(message || '')
    .replace(/[*#•`_]/g, ' ')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------

class VoiceService {
  constructor({ getSettings, cacheDir, onStatus } = {}) {
    this.getSettings = getSettings || (() => ({}));
    this.onStatus = onStatus || (() => {});
    this.cacheDir = cacheDir || path.join(app.getPath('userData'), 'voice-cache');

    this.window = null;
    this.workerReady = false;
    this.modelReady = false;
    this.lastError = '';
    this.pending = new Map();
    this.nextId = 1;
    this.queue = Promise.resolve();
    this.registered = false;
  }

  status() {
    return {
      workerReady: this.workerReady,
      modelReady: this.modelReady,
      lastError: this.lastError,
      device: this.device || '',
      voice: this.getSettings().kokoroVoice || ''
    };
  }

  #announce() {
    this.onStatus(this.status());
  }

  #registerIpc() {
    if (this.registered) return;
    this.registered = true;

    // The worker reports readiness, model-load progress, and results here.
    ipcMain.on('voice-worker:ready', (_event, info) => {
      this.workerReady = true;
      this.device = info?.device || '';
      this.#announce();
    });

    ipcMain.on('voice-worker:model', (_event, info) => {
      this.modelReady = Boolean(info?.ready);
      if (info?.error) this.lastError = info.error;
      if (info?.ready) this.lastError = '';
      this.#announce();
    });

    ipcMain.on('voice-worker:result', (_event, payload) => {
      const entry = this.pending.get(payload?.id);
      if (!entry) return;
      this.pending.delete(payload.id);
      clearTimeout(entry.timer);
      entry.resolve(payload);
    });
  }

  start() {
    if (this.window && !this.window.isDestroyed()) return;
    this.#registerIpc();
    fs.mkdirSync(this.cacheDir, { recursive: true });

    this.window = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload-voice.js'),
        contextIsolation: true,
        // Load-bearing and counter-intuitive: transformers.js switches to the
        // onnxruntime-NODE backend the moment it detects a node process, and
        // that backend has no WebGPU. Turning node on here would silently cost
        // the GPU and drop synthesis back below real time.
        nodeIntegration: false,
        // A hidden window is a background window. Without this, Chromium
        // throttles it and synthesis stalls whenever JARVIS is minimised to
        // the orb — which is exactly when he still needs to talk.
        backgroundThrottling: false,
        // Own partition so the ~326 MB model cache persists across restarts
        // and stays out of the app's normal session.
        partition: 'persist:jarvis-voice'
      }
    });

    // A crashed worker must not take the voice down permanently — mark it dead
    // so shouldFallback() sends callers to the system voice, and rebuild on the
    // next request rather than looping here.
    this.window.webContents.on('render-process-gone', (_event, details) => {
      this.workerReady = false;
      this.modelReady = false;
      this.lastError = `voice worker stopped (${details?.reason || 'unknown'})`;
      for (const [, entry] of this.pending) {
        clearTimeout(entry.timer);
        entry.resolve({ ok: false, error: this.lastError });
      }
      this.pending.clear();
      this.#announce();
    });

    this.window.loadFile(path.join(__dirname, '..', 'src', 'voice-worker.html'));
  }

  #send(kind, payload) {
    return new Promise((resolve) => {
      if (!this.window || this.window.isDestroyed()) {
        return resolve({ ok: false, error: 'voice worker not running' });
      }
      const id = this.nextId += 1;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.lastError = 'voice synthesis timed out';
        this.#announce();
        resolve({ ok: false, error: this.lastError });
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, timer });
      this.window.webContents.send(kind, { id, ...payload });
    });
  }

  #cacheFile(key) {
    return path.join(this.cacheDir, `${key}.wav`);
  }

  // Synthesize `text`, returning a WAV buffer. Callers get { ok:false } rather
  // than an exception when Kokoro is unavailable — every caller has a system
  // voice to fall back to, and a thrown error would just become silence.
  async synthesize(text, { voice: requestedVoice } = {}) {
    const settings = this.getSettings();
    const voice = requestedVoice || settings.kokoroVoice || 'bm_daniel';
    const spoken = speakableText(text);
    if (!spoken) return { ok: false, error: 'nothing to say' };

    if (shouldFallback({
      engine: settings.ttsEngine,
      workerReady: this.workerReady,
      modelReady: this.modelReady,
      lastError: this.lastError
    })) {
      return { ok: false, error: this.lastError || 'kokoro unavailable', fallback: true };
    }

    const key = cacheKeyFor(voice, spoken);
    const cached = this.#cacheFile(key);
    try {
      if (fs.existsSync(cached)) return { ok: true, wav: fs.readFileSync(cached), cached: true, voice };
    } catch { /* a bad cache entry must never break speech */ }

    // Serialize: two concurrent GPU renders contend and both get slower. The
    // queue is per-service, so the phone and the desktop share one lane.
    const run = this.queue.then(() => this.#send('voice-worker:synthesize', { text: spoken, voice }));
    this.queue = run.catch(() => {});
    const result = await run;

    if (!result?.ok) {
      this.lastError = result?.error || 'synthesis failed';
      this.#announce();
      return { ok: false, error: this.lastError, fallback: true };
    }

    // The gate. A render that reports success but contains no sound is the
    // documented failure mode of every fp16 dtype on this GPU, so success is
    // not taken on trust.
    if (!isAudioUsable(result.stats)) {
      this.lastError = 'synthesis produced no usable audio';
      this.#announce();
      return { ok: false, error: this.lastError, fallback: true };
    }

    const wav = Buffer.from(result.wav);
    try {
      fs.writeFileSync(this.#cacheFile(key), wav);
    } catch { /* cache is an optimisation, not a requirement */ }

    return { ok: true, wav, voice, ms: result.ms, cached: false };
  }

  async listVoices() {
    if (!this.workerReady) return { ok: false, voices: [] };
    const result = await this.#send('voice-worker:voices', {});
    return { ok: Boolean(result?.ok), voices: result?.voices || [] };
  }

  stop() {
    for (const [, entry] of this.pending) clearTimeout(entry.timer);
    this.pending.clear();
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
    this.workerReady = false;
    this.modelReady = false;
  }
}

module.exports = {
  VoiceService,
  cacheKeyFor,
  isAudioUsable,
  shouldFallback,
  speakableText,
  MODEL_ID,
  DTYPE
};
