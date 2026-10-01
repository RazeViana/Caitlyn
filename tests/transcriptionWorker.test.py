"""@file transcriptionWorker.test.py
@description Checks local HTTP audio validation and inference routing without downloading a model.
@module transcriptionWorker.test
"""

import importlib.util
import io
import json
from pathlib import Path
import threading
import unittest
import urllib.error
import urllib.request
import wave
from http.server import ThreadingHTTPServer
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location("worker", Path(__file__).parents[1] / "scripts/transcription/server.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


def audio():
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(bytes(32000))
    return output.getvalue()


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.calls = []

        def transcribe(data, **kwargs):
            self.calls.append((data.read(), kwargs))
            return iter([SimpleNamespace(text=" Spoken words ")]), None

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), worker.make_handler(SimpleNamespace(transcribe=transcribe)))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = "http://127.0.0.1:" + str(self.server.server_port)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, payload, language="en", content_type="audio/wav"):
        req = urllib.request.Request(self.base + "/transcribe?language=" + language, payload, {"Content-Type": content_type})
        return urllib.request.urlopen(req, timeout=3)

    def test_transcription_stays_in_memory_and_uses_language_and_vad(self):
        with self.request(audio()) as response:
            self.assertEqual(json.load(response), {"text": "Spoken words"})
        self.assertEqual(self.calls[0][0], audio())
        self.assertEqual(self.calls[0][1]["language"], "en")
        self.assertTrue(self.calls[0][1]["vad_filter"])
        self.assertFalse(self.calls[0][1]["condition_on_previous_text"])

    def test_invalid_audio_language_and_type_never_reach_model(self):
        for payload, language, content_type in [(b"invalid" * 100, "en", "audio/wav"), (audio(), "../../en", "audio/wav"), (audio(), "en", "text/plain"), (b"x" * 700_001, "en", "audio/wav")]:
            with self.assertRaises(urllib.error.HTTPError):
                self.request(payload, language, content_type)
        self.assertEqual(self.calls, [])

    def test_health_does_not_run_inference(self):
        with urllib.request.urlopen(self.base + "/health", timeout=3) as response:
            self.assertEqual(json.load(response), {"ready": True})
        self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main()
