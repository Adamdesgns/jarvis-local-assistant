# A real voice: Kokoro-82M on desktop AND phone — design (2026-07-26)

Approved by Adam 2026-07-26 ("build it"). Replaces the Windows SAPI voices that
`speechSynthesis` has been using since day one on both surfaces.

## Why Kokoro and not Piper

Adam's first instinct was Piper; the research inverted it. Piper is **GPLv3**
and Kokoro is **Apache 2.0** — for a product being sold, the permissive one is
the neural TTS, not the lightweight one. Kokoro also sounds better: Piper is
routinely described as "audibly synthetic" next to it.

| | Quality | Licence | Size | Needs |
|---|---|---|---|---|
| **Kokoro-82M** | best for its size | **Apache 2.0** | 86–92 MB (q8) | CPU only |
| Piper | audibly synthetic vs Kokoro | GPLv3 | ~60 MB | CPU only |
| Chatterbox | best overall | MIT | 2,980 MB / 7.5 GB RAM | a real GPU |
| Supertonic 3 | weaker than Kokoro | MIT | 99M params | CPU only |

Chatterbox wins every listening test and is still ruled out: an independent
on-device benchmark measured **44 seconds to first audio on CPU**. JARVIS ships
to strangers' laptops, most without a usable GPU. A voice assistant that takes
44 seconds to answer is not a voice assistant.

The clincher is `kokoro-js`: one npm package, dependencies `@huggingface/transformers`
and `phonemizer`, **no Python**. It runs in Node (`device: "cpu"`) and in a
browser (WASM) — one library, both surfaces, one voice.

## ⚠ The licence flag — unresolved, and it is not a Piper argument

Kokoro's weights are Apache 2.0 and `kokoro-js` is Apache 2.0, but `phonemizer`
is **espeak-ng compiled to WASM, and espeak-ng is GPLv3**. hexgrad/kokoro
issue #247 raised exactly this in August 2025 and **no maintainer ever replied**.
It is open, not settled.

This does not send us back to Piper — Piper uses espeak-ng too *and* is itself
GPLv3, so it is strictly worse on this axis. Three exits, deliberately deferred
until Adam has picked a voice, because the choice costs nothing today and the
answer may differ once we know whether the voice is even worth shipping:

1. **Comply.** espeak-ng stays a separate WASM module; ship its source offer.
2. **Swap the phonemizer** for a pure-JS rule-based G2P. No GPL, slightly worse
   pronunciation on unusual words.
3. **Drop to Supertonic** (MIT end to end, weaker voice).

Nobody here is a lawyer. This is a flag, not advice. It is cheap now and
expensive after money changes hands.

## Measured on Adam's machine — the numbers that overrode the plan

Everything below was measured, not assumed. Three of these findings contradicted
the original design and one of them nearly shipped silence.

**1. The CPU is too slow.** The published Kokoro figure is RTF ~0.45. On this
i7-240H it measured **p50 RTF 1.23, p90 1.91** — slower than real time. Above
RTF 1.0 sentence-streaming cannot work at all: playback drains the buffer faster
than synthesis refills it, so long replies stutter.

**2. The GPU fixes it — but only in the renderer.** The machine has an RTX 5060
sitting idle. Electron is Chromium, so the renderer has WebGPU, and Kokoro runs
there at **RTF 0.15** — eleven times faster than the CPU path. Two gotchas:
onnxruntime-node has no WebGPU, so the synthesis must NOT run in the main
process; and Chromium picks the integrated GPU by default on an Optimus laptop
(RTF 0.50 on the Intel iGPU vs 0.15 on the RTX), so `force_high_performance_gpu`
is required.

**3. Every fp16 dtype is silently broken on this GPU.** `fp16` and `q4f16` both
benchmark at the same RTF as fp32 and both emit tens of thousands of **NaN
samples followed by pure zeros** — correct-length WAVs containing no sound.
An earlier version of the audition bench rendered all eight voices in fp16 and
produced eight perfectly-sized silent files. Nothing about duration, file size or
absence of errors revealed it.

| device / dtype | RTF | peak | NaN | verdict |
|---|---|---|---|---|
| **webgpu / fp32** | **0.15** | 0.71 | 0 | the only fast *and* real config |
| webgpu / fp16 | 0.16 | 0.00 | 65,529 | silent |
| webgpu / q4f16 | 0.15 | 0.00 | 55,194 | silent |
| wasm / fp32 | 1.67 | 0.70 | 0 | valid, too slow |
| wasm / q8 | 1.76 | 0.71 | 0 | valid, too slow |
| node-cpu / q8 | 2.11 | — | — | valid, worst of all |

**fp32 it is — 326 MB, not the 92 MB originally planned.** The small
quantizations are not a size/quality trade here; they are broken.

**Every render is now amplitude-checked.** `inspect()` in the bench (and in the
service) computes peak and RMS and rejects anything with NaN, peak ≤ 0.05 or
RMS ≤ 0.005. File size proves nothing — full-length silence weighs exactly what
full-length speech weighs. Claude cannot hear the output, so validity is
established by arithmetic or not at all.

## The voice — Adam's ears, not Claude's

Claude has no audio and cannot judge any of these. Same wall as the battle-rap
reel. The bench exists because the pick is physically not Claude's to make.

Kokoro's British males are the model's thin spot — the accent JARVIS wants comes
from its least-trained voices:

These are Kokoro's own **overall** grades, read from the model's metadata. An
earlier draft of this spec quoted the *target quality* column from VOICES.md
instead, which flattered every voice by roughly one grade.

| Voice | Overall grade | Accent |
|---|---|---|
| `am_michael` | C+ | American |
| `am_puck` | C+ | American |
| `am_fenrir` | C+ | American |
| `bm_george` | C | British |
| `bm_fable` | C | British |
| `bm_daniel` | D | British |
| `bm_lewis` | D+ | British |
| `af_bella` | A- | American, female — reference only |

The American C+s have *hours* of training data behind them; the British C/Ds have
tens of minutes. The accent JARVIS wants comes from the model's weakest voices,
and whether that trade is worth it is Adam's call with his ears. `af_bella` (A-)
is rendered alongside them purely as a ceiling reference — it is what the model
sounds like at its best, not an option for a JARVIS voice.

`scripts/voice-bench/` renders one identical line across all eight through the
**exact shipping path** (fp32 / WebGPU), amplitude-checks each result, and drops
the WAVs in `OneDrive\JARVIS Promo\voice-bench\` for phone review. The winner
becomes the default; the rest stay selectable in Settings.

## Architecture: the PC is the voice box, and the GPU is in the renderer

One engine, loaded once, serving both surfaces. **The phone sounds identical to
the desktop because the phone does no synthesis at all** — the PC renders and
streams it the audio.

The measurement above forces one structural decision: **synthesis runs in a
renderer, not in the main process.** onnxruntime-node has no WebGPU backend, so
main-process synthesis is stuck on the CPU at RTF 1.2+. A renderer gets the RTX
and RTF 0.15.

**`src/voice-worker.html`** (new) — a hidden `BrowserWindow` created at startup
with `show:false`, `backgroundThrottling:false`, and **`nodeIntegration:false`**.
That last flag is load-bearing and counter-intuitive: transformers.js selects the
onnxruntime-**node** backend the moment it detects a node process, which silently
costs the GPU. The worker window has no node access and talks over IPC only.

A dedicated window rather than the main window because JARVIS minimises to the
orb and hides its main window; the voice must keep working when it does.

**`core/voice-service.js`** (new) — the main-process coordinator. Owns the worker
window's lifecycle, queues requests, serves both the desktop and the phone from
the one warm model, and holds the disk cache for fixed lines (the greeting,
"all systems online") keyed by voice + text hash. Pure decision functions
(`cacheKeyFor`, `shouldFallback`, `isAudioUsable`) sit at module top and are
unit-tested without ever loading a model.

**Warmup is not optional.** The first render after load pays GPU shader
compilation: measured **4.1s cold vs 0.70s warm** for the same 4.6s line. The
worker therefore burns one throwaway render *before* announcing readiness, so
the first thing JARVIS says after launch is not the slow one.

**Streaming.** kokoro-js ships `stream()` and a `TextSplitterStream`, so the
sentence splitter does not need writing — sentence one plays while the rest
renders. At RTF 0.15 there is ~6x headroom, so playback never catches synthesis.

**Desktop.** Renderer asks main over IPC, gets a WAV, plays it. Played audio is
also immune to the Chromium occlusion/pause bug that `startSpeechWatchdog`
(renderer.js) exists to fight, so the Kokoro path sidesteps it entirely. The
watchdog stays for the fallback path, which still needs it.

**Phone.** `core/mobile-server.js` gains **`POST /tts`** returning the same WAV
from the same warm model, behind the existing mobile-auth path — no new auth
surface. `src/mobile/mobile.js` `speak()` plays that instead of calling
`speechSynthesis`.

**Fallback, three tiers.** WebGPU → CPU (wasm/fp32, RTF ~1.7, degraded but real)
→ `speechSynthesis`. A machine with no usable GPU still talks; a machine with no
model still talks. **A failed render must fall back, never play.** Since an fp16
NaN render produces confident silence rather than an error, `isAudioUsable()`
gates every buffer before it reaches a speaker.

## Shipping the model

fp32 is **326 MB** — too big to bundle comfortably into an installer that is
currently ~100 MB, and `asar: true` cannot hold it anyway.

**Download on first run**, following the `core/ollama-service.js` progress
pattern that already exists for local AI models, into
`%LOCALAPPDATA%\jarvis-kokoro\`. JARVIS already asks buyers to fetch a local
model for local AI mode, so the flow is familiar rather than novel. Until the
download completes, the voice falls back to `speechSynthesis` — the app talks
from the first second either way.

## Settings

`settingsVersion` 8 → 9. New keys, added to the allowlist in `core/config-store.js`:

- `ttsEngine`: `'kokoro' | 'system'` (default `'kokoro'`)
- `kokoroVoice`: voice id (default set once Adam picks)
- `kokoroDevice`: `'auto' | 'webgpu' | 'wasm'` (default `'auto'`; escape hatch
  for a machine whose GPU produces NaN, since that failure is silent)

The existing `voiceName` key stays and keeps meaning "the system voice", used by
the fallback path. The Settings picker lists Kokoro voices with their grades, and
`auditionVoice()` speaks through whichever engine is selected.

`src/mobile/sw.js` cache bumps **v7 → v8** so installed phones don't keep serving
the old page.

## Out of scope

- Voice cloning of any kind, Adam's or anyone else's. Stock voices only.
- Pro-gating. Ships free; wrapping it in a licence check later is a one-line
  change if Adam decides it belongs behind the paywall.
- GPU acceleration. CPU is fast enough at this model size.
