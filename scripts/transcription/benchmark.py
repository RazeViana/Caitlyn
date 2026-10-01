"""@file benchmark.py
@description Measures offline worker HTTP latency using a supplied local speech fixture; emits no transcript text.
@module transcription_benchmark
"""

import argparse
import hashlib
import io
import json
import statistics
import threading
import time
import urllib.request
import wave
from http.server import ThreadingHTTPServer


def main():
    from faster_whisper.audio import decode_audio
    from server import load_model, make_handler

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("audio", help="Local speech fixture, at most 20 seconds")
    parser.add_argument("--expected-word", help="Optional smoke-test word; transcript text is never printed")
    args = parser.parse_args()
    audio = decode_audio(args.audio, sampling_rate=16000)
    if not 0 < len(audio) <= 16000 * 20:
        raise ValueError("Provide a speech fixture between zero and 20 seconds")
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes((audio * 32767).astype("<i2").tobytes())
    model, runtime = load_model()
    server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(model, runtime))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    timings = []
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{server.server_port}/health", timeout=3) as response:
            health = json.load(response)
        for _ in range(4):
            start = time.monotonic()
            request = urllib.request.Request(f"http://127.0.0.1:{server.server_port}/transcribe?language=en",
                                             output.getvalue(), {"Content-Type": "audio/wav"})
            with urllib.request.urlopen(request, timeout=60) as response:
                text = json.load(response)["text"]
            timings.append(round(time.monotonic() - start, 3))
            if not text or args.expected_word and args.expected_word.lower() not in text.lower():
                raise RuntimeError("Speech smoke test failed")
        print(json.dumps({"health": health, "audio_seconds": len(audio) / 16000, "request_seconds": timings,
                          "warm_median_seconds": statistics.median(timings[1:]),
                          "transcript_sha256": hashlib.sha256(text.encode()).hexdigest()}), flush=True)
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


if __name__ == "__main__":
    main()
