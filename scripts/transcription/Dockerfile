# @file Dockerfile
# @description Packages an English speech model at build time for offline CPU inference.
# @module transcriptionContainer
FROM python:3.11-slim@sha256:e41613d42d4891e4930f79523f93f81bbc7632584ec65e36ab055f41a800b41e
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
ARG WHISPER_MODEL=base.en
ARG WHISPER_MODEL_REVISION=3d3d5dee26484f91867d81cb899cfcf72b96be6c
RUN python -c 'import os; from faster_whisper.utils import download_model; download_model(os.environ["WHISPER_MODEL"], revision=os.environ["WHISPER_MODEL_REVISION"], output_dir="/models/whisper")'
COPY --chmod=644 server.py ./
ENV HF_HUB_OFFLINE=1 HF_DATASETS_OFFLINE=1 PYTHONDONTWRITEBYTECODE=1 TRANSCRIPTION_CPU_THREADS=2
USER 65534:65534
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD python -c 'import urllib.request; urllib.request.urlopen("http://127.0.0.1:8095/health", timeout=3)'
CMD ["python", "server.py"]
