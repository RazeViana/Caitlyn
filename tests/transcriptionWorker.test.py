"""@file transcriptionWorker.test.py
@description Checks local HTTP audio validation and inference routing without downloading a model.
@module transcriptionWorker.test
"""

import importlib.util
import http.client
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
        for payload, language, content_type in [(b"invalid" * 100, "en", "audio/wav"), (audio(), "../../en", "audio/wav"), (audio(), "en", "text/plain")]:
            with self.assertRaises(urllib.error.HTTPError):
                self.request(payload, language, content_type)
        # Reject oversized requests at the headers, without racing a large body against socket closure.
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        try:
            connection.putrequest("POST", "/transcribe")
            connection.putheader("Content-Type", "audio/wav")
            connection.putheader("Content-Length", "700001")
            connection.endheaders()
            self.assertEqual(connection.getresponse().status, 400)
        finally:
            connection.close()
        self.assertEqual(self.calls, [])

    def test_health_does_not_run_inference(self):
        with urllib.request.urlopen(self.base + "/health", timeout=3) as response:
            self.assertEqual(json.load(response), {"ready": True})
        self.assertEqual(self.calls, [])

    def test_scores_and_timing_are_retained_without_extra_text_in_metadata(self):
        segment = SimpleNamespace(text="Test words", start=0.0, end=0.5, avg_logprob=-0.2, no_speech_prob=0.01)
        model = SimpleNamespace(transcribe=lambda *_args, **_kwargs: (iter([segment]), SimpleNamespace(language="en", duration=1.0)))
        server = ThreadingHTTPServer(("127.0.0.1", 0), worker.make_handler(model))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            request = urllib.request.Request(f"http://127.0.0.1:{server.server_port}/transcribe", audio(), {"Content-Type": "audio/wav"})
            with urllib.request.urlopen(request, timeout=3) as response:
                result = json.load(response)
            self.assertEqual(result["text"], "Test words")
            self.assertEqual(result["recognition"]["model"], "base.en")
            self.assertEqual(result["recognition"]["segments"][0]["averageLogProbability"], -0.2)
            self.assertNotIn("Test words", json.dumps(result["recognition"]))
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


class DeviceTests(unittest.TestCase):
    def test_cpu_default_and_pascal_compatible_gpu_preserve_offline_loading(self):
        calls = []
        model = object()

        def factory(path, **options):
            calls.append((path, options))
            return model

        for environment, device, precision in [({}, "cpu", "int8"),
                ({"TRANSCRIPTION_DEVICE": "cuda"}, "cuda", "int8_float32")]:
            loaded, runtime = worker.load_model(environment, factory, lambda _device, _index: {precision})
            self.assertIs(loaded, model)
            self.assertEqual(runtime, {"device": device, "compute_type": precision})
            self.assertEqual(calls[-1][0], "/models/whisper")
            self.assertEqual(calls[-1][1]["device"], device)
            self.assertTrue(calls[-1][1]["local_files_only"])
            self.assertEqual(calls[-1][1]["num_workers"], 1)

    def test_bad_device_or_unsupported_precision_does_not_silently_use_cpu(self):
        for settings in [{"TRANSCRIPTION_DEVICE": "remote"},
                         {"TRANSCRIPTION_COMPUTE_TYPE": "unknown"},
                         {"TRANSCRIPTION_CPU_THREADS": "0"},
                         {"TRANSCRIPTION_CPU_THREADS": "33"}]:
            with self.assertRaises(ValueError):
                worker.model_options(settings)
        with self.assertRaises(RuntimeError):
            worker.load_model({"TRANSCRIPTION_DEVICE": "cuda", "TRANSCRIPTION_COMPUTE_TYPE": "float16"},
                              lambda *_args, **_kwargs: self.fail("Model loaded with unsupported precision"),
                              lambda _device, _index: {"int8_float32", "float32"})

    def test_health_reports_the_selected_backend_without_loading_another_model(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), worker.make_handler(
            object(), {"device": "cuda", "compute_type": "int8_float32"}))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{server.server_port}/health", timeout=3) as response:
                self.assertEqual(json.load(response), {"ready": True, "device": "cuda", "compute_type": "int8_float32"})
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == "__main__":
    unittest.main()
