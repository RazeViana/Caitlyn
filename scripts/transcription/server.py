"""Local, memory-only English voice transcription service.

@file server.py
@description Serves a preloaded faster-whisper model without cloud inference or audio storage.
@module transcription_server
"""

import io
import json
import os
import re
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

MAX_BYTES = 700_000


def model_options(environment=None):
    environment = os.environ if environment is None else environment
    device = environment.get("TRANSCRIPTION_DEVICE", "cpu")
    if device not in ("cpu", "cuda"):
        raise ValueError("TRANSCRIPTION_DEVICE must be cpu or cuda")
    compute_type = environment.get("TRANSCRIPTION_COMPUTE_TYPE") or (
        "int8_float32" if device == "cuda" else "int8"
    )
    if compute_type not in ("int8", "int8_float32", "int8_float16", "float16", "float32"):
        raise ValueError("TRANSCRIPTION_COMPUTE_TYPE is not supported")
    cpu_threads = int(environment.get("TRANSCRIPTION_CPU_THREADS", "2"))
    if not 1 <= cpu_threads <= 32:
        raise ValueError("TRANSCRIPTION_CPU_THREADS must be between 1 and 32")
    return {"device": device, "compute_type": compute_type, "cpu_threads": cpu_threads,
            "device_index": 0, "num_workers": 1, "local_files_only": True}


def load_model(environment=None, model_factory=None, supported_types=None):
    options = model_options(environment)
    if model_factory is None:
        from faster_whisper import WhisperModel
        model_factory = WhisperModel
    if supported_types is None:
        from ctranslate2 import get_supported_compute_types
        supported_types = get_supported_compute_types
    if options["compute_type"] not in supported_types(options["device"], options["device_index"]):
        raise RuntimeError("Selected transcription compute type is unavailable on this device")
    model = model_factory("/models/whisper", **options)
    return model, {"device": options["device"], "compute_type": options["compute_type"]}


def validate_audio(audio):
    with wave.open(io.BytesIO(audio), "rb") as wav:
        if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) != (1, 2, 16000):
            raise ValueError("Expected 16 kHz mono PCM16 WAV")
        if not 0 < wav.getnframes() <= 16000 * 21:
            raise ValueError("Audio exceeds the chunk duration limit")
        if len(wav.readframes(wav.getnframes())) != wav.getnframes() * 2:
            raise ValueError("Truncated audio")


def make_handler(model, runtime=None):
    inference = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def respond(self, status, result):
            body = json.dumps(result).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)
            self.close_connection = True

        def do_GET(self):
            if self.path == "/health":
                self.respond(200, {"ready": True, **(runtime or {})})
            else:
                self.respond(404, {"ready": False})

        def do_POST(self):
            self.connection.settimeout(10)
            path = urlsplit(self.path)
            if path.path != "/transcribe":
                self.respond(404, {"error": "Unknown route"})
                return
            if self.headers.get("Content-Type") != "audio/wav" or self.headers.get("Transfer-Encoding"):
                self.respond(415, {"error": "Expected a WAV body with Content-Length"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                language = parse_qs(path.query).get("language", ["en"])[0]
                if not re.fullmatch(r"auto|[a-z]{2,3}", language):
                    raise ValueError("Invalid language")
                if not 44 < length <= MAX_BYTES:
                    raise ValueError("Invalid audio size")
            except ValueError:
                self.respond(400, {"error": "Invalid audio request"})
                return
            if not inference.acquire(blocking=False):
                self.respond(503, {"error": "Worker is busy"})
                return
            try:
                audio = self.rfile.read(length)
                if len(audio) != length:
                    raise ValueError("Incomplete audio")
                validate_audio(audio)
                segments, _info = model.transcribe(
                    io.BytesIO(audio), language=None if language == "auto" else language,
                    vad_filter=True, beam_size=5, condition_on_previous_text=False,
                )
                text = " ".join(segment.text.strip() for segment in segments).strip()
                self.respond(200, {"text": text})
            except (ValueError, wave.Error, EOFError):
                self.respond(400, {"error": "Invalid audio"})
            except (BrokenPipeError, ConnectionResetError, TimeoutError):
                pass
            except Exception:
                self.respond(500, {"error": "Local inference failed"})
            finally:
                inference.release()

    return Handler


def main():
    model, runtime = load_model()
    server = ThreadingHTTPServer(("0.0.0.0", 8095), make_handler(model, runtime))
    print(f"Local transcription worker ready on {runtime['device']} ({runtime['compute_type']}); "
          "audio and transcript access logging disabled.", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
