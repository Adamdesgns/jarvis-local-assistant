"""Free local wake-word and speech-to-text service for JARVIS.

Stdout is reserved for newline-delimited JSON events consumed by Electron.
Diagnostics go to stderr.
"""

from __future__ import annotations

import argparse
import json
import os
import queue
import sys
import threading
import time
from pathlib import Path


def emit(event_type: str, **payload) -> None:
    print(json.dumps({"type": event_type, **payload}), flush=True)


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def prepare_models() -> None:
    import openwakeword
    from faster_whisper import WhisperModel

    emit("status", message="Downloading the free Hey Jarvis wake-word model")
    openwakeword.utils.download_models(model_names=["hey_jarvis"])
    model_name = os.environ.get("JARVIS_WHISPER_MODEL", "small.en")
    emit("status", message=f"Downloading local speech model: {model_name}")
    WhisperModel(model_name, device="cpu", compute_type="int8")
    emit("ready", wakeReady=True, message="Local voice models are installed")


class VoiceService:
    def __init__(self) -> None:
        self.running = True
        self.audio_queue: queue.Queue = queue.Queue(maxsize=40)
        self.wake_model = None
        self.whisper_model = None
        self.wake_ready = False
        self.last_wake = 0.0

    def initialize_wake(self) -> None:
        try:
            import numpy as np
            import openwakeword
            import sounddevice as sd
            from openwakeword.model import Model

            try:
                openwakeword.utils.download_models(model_names=["hey_jarvis"])
            except TypeError:
                openwakeword.utils.download_models()
            self.wake_model = Model(wakeword_models=["hey_jarvis"], inference_framework="onnx")

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
            emit("ready", wakeReady=True, message="Say Hey Jarvis")
        except Exception as exc:
            self.wake_ready = False
            emit("ready", wakeReady=False, message=f"Push-to-talk ready; wake word needs attention: {exc}")

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
                score = max((float(value) for key, value in scores.items() if "jarvis" in key.lower()), default=0.0)
                now = time.monotonic()
                if score >= 0.55 and now - self.last_wake > 2.2:
                    self.last_wake = now
                    emit("wake", score=round(score, 3))
            except Exception as exc:
                log(f"Wake detection error: {exc}")

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
            threading.Thread(target=self.wake_loop, daemon=True).start()
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
    checks: dict = {}
    for module in ("numpy", "sounddevice", "openwakeword", "faster_whisper"):
        try:
            __import__(module)
            checks[module] = {"ok": True, "detail": "Installed"}
        except Exception as exc:
            checks[module] = {"ok": False, "detail": str(exc)}

    try:
        import openwakeword

        models_dir = Path(openwakeword.__file__).parent / "resources" / "models"
        found = sorted(p.name for p in models_dir.glob("hey_jarvis*"))
        checks["wakeModel"] = {
            "ok": bool(found),
            "detail": ", ".join(found) if found else "The hey_jarvis model files are not downloaded yet",
        }
    except Exception as exc:
        checks["wakeModel"] = {"ok": False, "detail": str(exc)}

    model_name = os.environ.get("JARVIS_WHISPER_MODEL", "small.en")
    try:
        from huggingface_hub.constants import HF_HUB_CACHE

        repo = Path(HF_HUB_CACHE) / f"models--Systran--faster-whisper-{model_name}"
        cached = repo.exists() and any(repo.rglob("model.bin"))
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

    emit("diagnostic", python=sys.version.split()[0], whisperModel=model_name, checks=checks)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prepare", action="store_true")
    parser.add_argument("--service", action="store_true")
    parser.add_argument("--diagnose", action="store_true")
    args = parser.parse_args()
    if args.prepare:
        prepare_models()
    elif args.service:
        VoiceService().run()
    elif args.diagnose:
        diagnose()
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
