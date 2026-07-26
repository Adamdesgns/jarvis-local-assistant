// The voice worker: loads Kokoro on the GPU and renders speech on request.
//
// Runs in a hidden window because WebGPU only exists in a renderer. Talks to
// core/voice-service.js over the narrow bridge in preload-voice.js.

// The model file lives in node_modules; the web build is the one that can use
// WebGPU (the node build cannot).
import { KokoroTTS } from '../node_modules/kokoro-js/dist/kokoro.web.js';

const MODEL_ID = 'onnx-community/Kokoro-82M-ONNX';

let tts = null;

// Speed proves nothing about correctness here. On this GPU every fp16-based
// dtype renders at a healthy RTF while emitting tens of thousands of NaN
// samples followed by pure zeros — audio of the right length containing no
// sound, with no error thrown. Nobody on this project can hear the output, so
// every buffer is measured before it is trusted.
function inspect(audio) {
  const data = audio.audio;
  let nan = 0;
  let peak = 0;
  let sum = 0;
  let counted = 0;
  for (let i = 0; i < data.length; i += 1) {
    const value = data[i];
    if (Number.isNaN(value)) { nan += 1; continue; }
    const magnitude = Math.abs(value);
    if (magnitude > peak) peak = magnitude;
    sum += value * value;
    counted += 1;
  }
  return {
    nan,
    peak,
    rms: counted ? Math.sqrt(sum / counted) : 0,
    samples: data.length,
    seconds: data.length / audio.sampling_rate
  };
}

async function load() {
  const adapter = navigator.gpu
    ? await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null)
    : null;

  // WebGPU runs ~11x faster than the CPU path here (RTF 0.15 vs 1.7+). Below
  // real time the CPU path cannot keep a stream fed, so it is a genuine
  // degraded mode — real audio, just slow — not an equal alternative.
  const device = adapter ? 'webgpu' : 'wasm';
  window.voiceWorker.ready({ device, gpu: adapter?.info?.vendor || '' });

  try {
    // fp32 everywhere: it is the only dtype that produces real audio on the
    // GPU, and it works on the CPU path too, so one download serves both.
    tts = await KokoroTTS.from_pretrained(MODEL_ID, { dtype: 'fp32', device });

    // Burn one throwaway render before announcing readiness. The first call
    // pays GPU shader compilation — measured at RTF 0.9 cold versus 0.10 warm,
    // which is the difference between JARVIS answering instantly and stalling
    // on the first thing he says after launch. The result is discarded.
    try {
      await tts.generate('Systems online.', { voice: 'bm_daniel' });
    } catch { /* a failed warmup is not a failed load — let the real call report */ }

    window.voiceWorker.model({ ready: true, device });
  } catch (error) {
    window.voiceWorker.model({ ready: false, error: String(error?.message || error) });
  }
}

window.voiceWorker.onSynthesize(async ({ id, text, voice }) => {
  if (!tts) {
    window.voiceWorker.result({ id, ok: false, error: 'model not loaded' });
    return;
  }
  try {
    const started = performance.now();
    const audio = await tts.generate(text, { voice });
    const ms = performance.now() - started;
    const stats = inspect(audio);

    // The buffer goes back even when the stats are bad — voice-service.js owns
    // the accept/reject decision so the rule lives in one place and can be
    // unit-tested without a GPU.
    window.voiceWorker.result({ id, ok: true, wav: audio.toWav(), stats, ms });
  } catch (error) {
    window.voiceWorker.result({ id, ok: false, error: String(error?.message || error) });
  }
});

window.voiceWorker.onVoices(({ id }) => {
  if (!tts) {
    window.voiceWorker.result({ id, ok: false, voices: [] });
    return;
  }
  // Grades come from the model's own metadata rather than a hardcoded table,
  // so the Settings picker cannot drift out of step with the model.
  const voices = Object.entries(tts.voices).map(([voiceId, meta]) => ({
    id: voiceId,
    name: meta.name,
    language: meta.language,
    gender: meta.gender,
    grade: meta.overallGrade
  }));
  window.voiceWorker.result({ id, ok: true, voices });
});

load();
