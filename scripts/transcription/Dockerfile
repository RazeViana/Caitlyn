# @file Dockerfile
# @description Packages an English speech model for offline NVIDIA GPU inference with an explicit CPU target.
# @module transcriptionContainer
FROM python:3.11-slim@sha256:e41613d42d4891e4930f79523f93f81bbc7632584ec65e36ab055f41a800b41e AS common
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
ARG WHISPER_MODEL=base.en
ARG WHISPER_MODEL_REVISION=3d3d5dee26484f91867d81cb899cfcf72b96be6c
RUN python -c 'import os; from faster_whisper.utils import download_model; download_model(os.environ["WHISPER_MODEL"], revision=os.environ["WHISPER_MODEL_REVISION"], output_dir="/models/whisper")'
COPY --chmod=644 server.py ./
ENV TRANSCRIPTION_MODEL_ID=${WHISPER_MODEL}
ENV HF_HUB_OFFLINE=1 HF_DATASETS_OFFLINE=1 PYTHONDONTWRITEBYTECODE=1 TRANSCRIPTION_CPU_THREADS=2
USER 65534:65534
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD python -c 'import urllib.request; urllib.request.urlopen("http://127.0.0.1:8095/health", timeout=3)'
CMD ["python", "server.py"]

# CPU is available explicitly with --target cpu. The default final stage uses the GPU.
FROM common AS cpu

FROM common AS cuda
USER root
COPY requirements-cuda.txt ./
RUN pip install --no-cache-dir -r requirements-cuda.txt
ENV LD_LIBRARY_PATH=/usr/local/lib/python3.11/site-packages/nvidia/cublas/lib:/usr/local/lib/python3.11/site-packages/nvidia/cudnn/lib
ENV TRANSCRIPTION_DEVICE=cuda TRANSCRIPTION_COMPUTE_TYPE=int8_float32 CUDA_CACHE_DISABLE=1 NVIDIA_DRIVER_CAPABILITIES=compute,utility
USER 65534:65534
