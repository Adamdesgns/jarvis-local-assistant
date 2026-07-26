"""Free local wake-word and speech-to-text service for JARVIS.

Stdout is reserved for newline-delimited JSON events consumed by Electron.
Diagnostics go to stderr.

THE WAKE ENGINE HAS TWO MODES, chosen automatically from the assistant's name
(JARVIS_ASSISTANT_NAME):

  openwakeword — the name sounds like "Jarvis", so the pre-trained hey_jarvis
                 model applies: near-instant, very low CPU. The master build
                 lands here by default.
  transcribe   — any other name (the retail buyer picks one on first install).
                 openWakeWord can only listen for phrases it was TRAINED on,
                 and training needs 30-60 GPU-minutes per phrase — so instead,
                 Silero VAD gates a rolling buffer and each speech segment is
                 transcribed with a small whisper model, then matched against
                 "hey <name>" phonetically. Slower to fire (~1.5-2.5s after
                 the phrase) but works for ANY name.
"""

from __future__ import annotations

import argparse
import json
import os
import queue
import re
import sys
import threading
import time
from collections import deque
from pathlib import Path


def emit(event_type: str, **payload) -> None:
    print(json.dumps({"type": event_type, **payload}), flush=True)


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


# ── phonetic matching ──────────────────────────────────────────────────────
# skeleton-port-begin
# TWIN: core/onboarding.js skeleton()/nameHeardIn() — change both or the
# shared fixture (test/fixtures/wake-phrases.json, run via --selftest) fails.
# Whisper renders invented proper nouns phonetically ("Kori" arrives as
# "corey"), so wake matching compares consonant skeletons instead of spelling.


def _skeleton(word: str) -> str:
    folded = (word or "").lower()
    folded = re.sub(r"[^a-z]", "", folded)
    folded = folded.replace("ph", "f")
    folded = re.sub(r"[ckq]", "k", folded)
    folded = re.sub(r"[sz]", "s", folded)
    folded = re.sub(r"[iy]", "i", folded)
    folded = re.sub(r"(.)\1+", r"\1", folded)
    if not folded:
        return ""
    # Keep the first letter even if it's a vowel; drop vowels after it.
    return folded[0] + re.sub(r"[aeiou]", "", folded[1:])


# skeleton-port-end

# Greeting words a wake phrase may start with, compared as skeletons so
# whisper's spelling of them ("hay", "ok") folds in.
_GREETING_SKELETONS = {_skeleton(w) for w in ("hey", "hi", "ok", "okay", "yo")}


def _name_heard_at_start(transcript: str, name: str) -> bool:
    """The WAKE rule — stricter than onboarding's match-anywhere.

    The name's skeleton sequence must match starting at token 0, or at token 1
    when token 0 is a greeting. Without the position rule, "set the max value
    to ten" would wake an assistant named Max. VAD segments start at speech
    onset, so a genuine "Hey Max..." always has the name in the first two
    tokens.
    """
    heard = [s for s in (_skeleton(t) for t in (transcript or "").split()) if s]
    wanted = [s for s in (_skeleton(t) for t in (name or "").split()) if s]
    if not heard or not wanted:
        return False
    starts = [0]
    if heard[0] in _GREETING_SKELETONS:
        starts.append(1)
    for start in starts:
        if heard[start:start + len(wanted)] == wanted:
            return True
    return False


def _wake_mode(name: str) -> str:
    return "openwakeword" if _skeleton(name) == _skeleton("jarvis") else "transcribe"


def _assistant_name() -> str:
    return os.environ.get("JARVIS_ASSISTANT_NAME", "JARVIS").strip() or "JARVIS"


def _sensitivity() -> float:
    try:
        value = float(os.environ.get("JARVIS_WAKE_SENSITIVITY", "0.55"))
    except ValueError:
        value = 0.55
    return min(0.95, max(0.1, value))


def prepare_models() -> None:
    import openwakeword
    from faster_whisper import WhisperModel

    emit("status", message="Downloading the wake-word models")
    # hey_jarvis downloads unconditionally: one installer serves both editions
    # and the model is ~1.3 MB.
    openwakeword.utils.download_models(model_names=["hey_jarvis"])
    model_name = os.environ.get("JARVIS_WHISPER_MODEL", "small.en")
    emit("status", message=f"Downloading local speech model: {model_name}")
    WhisperModel(model_name, device="cpu", compute_type="int8")
    # The transcribe-mode wake pass runs on every detected speech segment all
    # day, so it gets the smallest usable model rather than the command one.
    wake_model = os.environ.get("JARVIS_WAKE_WHISPER_MODEL", "tiny.en")
    emit("status", message=f"Downloading wake speech model: {wake_model}")
    WhisperModel(wake_model, device="cpu", compute_type="int8")
    emit("ready", wakeReady=True, message="Local voice models are installed")


class VoiceService:
    def __init__(self) -> None:
        self.running = True
        self.audio_queue: queue.Queue = queue.Queue(maxsize=40)
        self.wake_model = None
        self.whisper_model = None
        self.wake_whisper = None
        self.wake_ready = False
        self.last_wake = 0.0
        self.assistant_name = _assistant_name()
        self.sensitivity = _sensitivity()
        self.wake_mode = _wake_mode(self.assistant_name)
        self.vad = None
        self._wake_pass_busy = False

    def initialize_wake(self) -> None:
        try:
            import numpy as np
            import sounddevice as sd

            if self.wake_mode == "openwakeword":
                import openwakeword
                from openwakeword.model import Model

                try:
                    openwakeword.utils.download_models(model_names=["hey_jarvis"])
                except TypeError:
                    openwakeword.utils.download_models()
                self.wake_model = Model(wakeword_models=["hey_jarvis"], inference_framework="onnx")
            else:
                # Silero VAD ships inside the openwakeword package with its
                # own wrapper class — it handles the LSTM state and
                # normalization; we just feed int16 blocks.
                from openwakeword.vad import VAD

                self.vad = VAD()

            def callback(indata, frames, time_info, status):
                del frames, time_info
                if status:
                    log(str(status))
                try:
                    self.audio_queue.put_nowait(np.array(indata[:, 0], dtype=np.int16, copy=True))
                except queue.Full:
                    pass

            self.stream = sd.InputStream(
                samplerate=16000,
                channels=1,
                dtype="int16",
                blocksize=1280,
                callback=callback,
            )
            self.stream.start()
            self.wake_ready = True
            emit("ready", wakeReady=True, wakeMode=self.wake_mode, message=f"Say Hey {self.assistant_name}")
        except Exception as exc:
            self.wake_ready = False
            emit("ready", wakeReady=False, wakeMode=self.wake_mode,
                 message=f"Push-to-talk ready; wake word needs attention: {exc}")

    # ── openwakeword mode ──────────────────────────────────────────────────

    def wake_loop(self) -> None:
        while self.running:
            try:
                frame = self.audio_queue.get(timeout=0.25)
            except queue.Empty:
                continue
            if self.wake_model is None:
                continue
            try:
                scores = self.wake_model.predict(frame)
                # max over ALL loaded models — we control the loaded list, and
                # the old '"jarvis" in key' filter silently zeroed any custom
                # model whose key didn't contain the word.
                score = max((float(value) for value in scores.values()), default=0.0)
                now = time.monotonic()
                if score >= self.sensitivity and now - self.last_wake > 2.2:
                    self.last_wake = now
                    emit("wake", score=round(score, 3))
            except Exception as exc:
                log(f"Wake detection error: {exc}")

    # ── transcribe mode ────────────────────────────────────────────────────

    def get_wake_whisper(self):
        if self.wake_whisper is None:
            from faster_whisper import WhisperModel

            wanted = os.environ.get("JARVIS_WAKE_WHISPER_MODEL", "tiny.en")
            try:
                self.wake_whisper = WhisperModel(wanted, device="cpu", compute_type="int8")
            except Exception as exc:
                # Upgraded installs may not have re-run the installer, so
                # tiny.en may be missing and we may be offline. The command
                # model is already cached — wake degrades to slower, never to
                # broken.
                fallback = os.environ.get("JARVIS_WHISPER_MODEL", "small.en")
                emit("status", message=f"Wake speech model {wanted} unavailable ({exc}); using {fallback}")
                self.wake_whisper = WhisperModel(fallback, device="cpu", compute_type="int8")
        return self.wake_whisper

    def _run_wake_pass(self, blocks) -> None:
        import numpy as np

        try:
            audio = np.concatenate(blocks).astype(np.float32) / 32768.0
            model = self.get_wake_whisper()
            segments, _info = model.transcribe(
                audio,
                beam_size=1,
                language="en",
                vad_filter=False,
                condition_on_previous_text=False,
                without_timestamps=True,
            )
            text = " ".join(segment.text.strip() for segment in segments).strip()
            # JARVIS_WAKE_DEBUG=1: log every segment's transcript to stderr so
            # "why didn't it wake" is answerable in the field. Stderr only —
            # stdout is the JSON protocol, and quiet-by-default is the privacy
            # posture (a always-on log of everything said in the room is not).
            if os.environ.get("JARVIS_WAKE_DEBUG") == "1":
                log(f"wake-debug heard: {text!r} → match={_name_heard_at_start(text, self.assistant_name)}")
            now = time.monotonic()
            if text and _name_heard_at_start(text, self.assistant_name) and now - self.last_wake > 2.2:
                self.last_wake = now
                # transcript rides along for free: today's renderer ignores
                # it, and it is the seed for tail-as-command and live
                # captions later.
                emit("wake", score=1.0, transcript=text)
        except Exception as exc:
            log(f"Wake transcription error: {exc}")
        finally:
            self._wake_pass_busy = False

    def transcribe_wake_loop(self) -> None:
        """VAD-gated segmenter. Each 80ms block is scored by Silero; a run of
        speech becomes a segment; each segment gets one whisper pass.

        Tuning (in 80ms blocks): pre-roll 8 (~0.64s) so the first syllable is
        not clipped; end after 9 silent blocks (~0.72s pause); cap at 50
        (4.0s) so a monologue can't grow an unbounded transcription; drop
        segments under 5 speech blocks (~0.4s) — a cough is not a phrase.
        """
        PRE_ROLL = 8
        END_SILENCE = 9
        MAX_BLOCKS = 50
        MIN_SPEECH = 5
        VAD_THRESHOLD = 0.5

        pre_roll: deque = deque(maxlen=PRE_ROLL)
        capturing: list = []
        speech_blocks = 0
        silent_blocks = 0

        while self.running:
            try:
                frame = self.audio_queue.get(timeout=0.25)
            except queue.Empty:
                continue
            if self.vad is None:
                continue
            try:
                # 1280 samples / frame_size 640 = 2 Silero chunks per block.
                speech = float(self.vad.predict(frame, frame_size=640)) >= VAD_THRESHOLD
            except Exception as exc:
                log(f"VAD error: {exc}")
                continue

            if not capturing:
                pre_roll.append(frame)
                if speech:
                    capturing = list(pre_roll)
                    speech_blocks = 1
                    silent_blocks = 0
                continue

            capturing.append(frame)
            if speech:
                speech_blocks += 1
                silent_blocks = 0
            else:
                silent_blocks += 1

            if silent_blocks >= END_SILENCE or len(capturing) >= MAX_BLOCKS:
                segment = capturing
                capturing = []
                pre_roll.clear()
                try:
                    self.vad.reset_states()
                except Exception:
                    pass
                if speech_blocks >= MIN_SPEECH and not self._wake_pass_busy:
                    # Never queue passes: if one is still running, this
                    # segment is dropped. A backlog of transcriptions is how
                    # a noisy room becomes a hot CPU.
                    self._wake_pass_busy = True
                    threading.Thread(target=self._run_wake_pass, args=(segment,), daemon=True).start()
                speech_blocks = 0
                silent_blocks = 0

    # ── command transcription (unchanged) ──────────────────────────────────

    def get_whisper(self):
        if self.whisper_model is None:
            from faster_whisper import WhisperModel

            model_name = os.environ.get("JARVIS_WHISPER_MODEL", "small.en")
            emit("status", message=f"Loading free local speech model: {model_name}")
            self.whisper_model = WhisperModel(model_name, device="cpu", compute_type="int8")
        return self.whisper_model

    def transcribe(self, request_id: str, file_path: str) -> None:
        try:
            model = self.get_whisper()
            segments, _info = model.transcribe(
                file_path,
                beam_size=3,
                language="en",
                vad_filter=True,
                condition_on_previous_text=False,
            )
            text = " ".join(segment.text.strip() for segment in segments).strip()
            emit("result", id=request_id, text=text)
        except Exception as exc:
            emit("error", id=request_id, message=f"Local transcription failed: {exc}")

    def run(self) -> None:
        if os.environ.get("JARVIS_WAKE_ENABLED", "1") == "1":
            self.initialize_wake()
            target = self.wake_loop if self.wake_mode == "openwakeword" else self.transcribe_wake_loop
            threading.Thread(target=target, daemon=True).start()
        else:
            emit("ready", wakeReady=False, message="Push-to-talk ready; wake word is disabled")
        for line in sys.stdin:
            if not self.running:
                break
            try:
                command = json.loads(line)
            except json.JSONDecodeError:
                continue
            if command.get("type") == "shutdown":
                self.running = False
                break
            if command.get("type") == "transcribe":
                threading.Thread(
                    target=self.transcribe,
                    args=(command.get("id", ""), command.get("filePath", "")),
                    daemon=True,
                ).start()
        try:
            self.stream.stop()
            self.stream.close()
        except Exception:
            pass


def diagnose() -> None:
    """Print one JSON line describing what is installed and what is missing."""
    name = _assistant_name()
    mode = _wake_mode(name)
    checks: dict = {}
    for module in ("numpy", "sounddevice", "openwakeword", "faster_whisper"):
        try:
            __import__(module)
            checks[module] = {"ok": True, "detail": "Installed"}
        except Exception as exc:
            checks[module] = {"ok": False, "detail": str(exc)}

    # The wake check is mode-aware: openwakeword mode needs the hey_jarvis
    # files; transcribe mode needs Silero VAD plus a wake whisper model
    # (tiny.en preferred, small.en fallback keeps it working).
    try:
        import openwakeword

        models_dir = Path(openwakeword.__file__).parent / "resources" / "models"
        if mode == "openwakeword":
            found = sorted(p.name for p in models_dir.glob("hey_jarvis*"))
            checks["wakeModel"] = {
                "ok": bool(found),
                "detail": ", ".join(found) if found else "The hey_jarvis model files are not downloaded yet",
            }
        else:
            vad_ok = (models_dir / "silero_vad.onnx").exists()
            wake_model = os.environ.get("JARVIS_WAKE_WHISPER_MODEL", "tiny.en")
            tiny_ok = _whisper_cached(wake_model)
            small_ok = _whisper_cached(os.environ.get("JARVIS_WHISPER_MODEL", "small.en"))
            ok = vad_ok and (tiny_ok or small_ok)
            if not vad_ok:
                detail = "Silero VAD is missing from the openwakeword package"
            elif tiny_ok:
                detail = f"Listening for “Hey {name}” via {wake_model}"
            elif small_ok:
                detail = f"{wake_model} is not downloaded; falling back to the main speech model (slower wake)"
            else:
                detail = "No wake speech model is downloaded yet"
            checks["wakeModel"] = {"ok": ok, "detail": detail}
    except Exception as exc:
        checks["wakeModel"] = {"ok": False, "detail": str(exc)}

    model_name = os.environ.get("JARVIS_WHISPER_MODEL", "small.en")
    try:
        cached = _whisper_cached(model_name)
        checks["speechModel"] = {
            "ok": cached,
            "detail": f"{model_name} is ready" if cached else f"The {model_name} speech model is not downloaded yet",
        }
    except Exception as exc:
        checks["speechModel"] = {"ok": False, "detail": str(exc)}

    try:
        import sounddevice as sd

        devices = [d for d in sd.query_devices() if d.get("max_input_channels", 0) > 0]
        default_name = ""
        try:
            default_index = sd.default.device[0]
            if default_index is not None and int(default_index) >= 0:
                default_name = sd.query_devices(int(default_index))["name"]
        except Exception:
            pass
        checks["microphone"] = {
            "ok": bool(devices),
            "detail": default_name or (devices[0]["name"] if devices else "Windows reports no microphone"),
        }
    except Exception as exc:
        checks["microphone"] = {"ok": False, "detail": str(exc)}

    emit("diagnostic", python=sys.version.split()[0], whisperModel=model_name,
         assistantName=name, wakeMode=mode, checks=checks)


def _whisper_cached(model_name: str) -> bool:
    try:
        from huggingface_hub.constants import HF_HUB_CACHE

        repo = Path(HF_HUB_CACHE) / f"models--Systran--faster-whisper-{model_name}"
        return repo.exists() and any(repo.rglob("model.bin"))
    except Exception:
        return False


def selftest(fixture_path: str) -> int:
    """Run the wake matcher against the shared fixture. The same file pins the
    JS twin (core/onboarding.js) — if the ports drift, this fails."""
    with open(fixture_path, "r", encoding="utf-8") as handle:
        cases = json.load(handle)
    failures = []
    for case in cases:
        got = _name_heard_at_start(case.get("transcript", ""), case.get("name", ""))
        if got != bool(case.get("expectWake")):
            failures.append({"name": case.get("name"), "transcript": case.get("transcript"),
                             "expected": bool(case.get("expectWake")), "got": got})
    emit("selftest", passed=len(cases) - len(failures), failed=len(failures), failures=failures)
    return 1 if failures else 0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prepare", action="store_true")
    parser.add_argument("--service", action="store_true")
    parser.add_argument("--diagnose", action="store_true")
    parser.add_argument("--selftest", metavar="FIXTURE")
    args = parser.parse_args()
    if args.prepare:
        prepare_models()
    elif args.service:
        VoiceService().run()
    elif args.diagnose:
        diagnose()
    elif args.selftest:
        sys.exit(selftest(args.selftest))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
