# @file Dockerfile
# @description Builds the disposable local media-probe and restricted gateway image.
# @module mediaSandbox

FROM node:24-alpine@sha256:50c8e8ca1d27439048670df5883f32d57cf81cff6233222c893fd0d9884cbd81
RUN apk add --no-cache python3 py3-pip ffmpeg \
    && python3 -m venv /opt/extractor
COPY requirements.txt /opt/requirements.txt
RUN /opt/extractor/bin/pip install --no-cache-dir --require-hashes -r /opt/requirements.txt \
    && mkdir /ipc && chown node:node /ipc
COPY gateway.ts worker.ts xPostWorker.ts xMetadata.py socialXPost.ts socialFxPost.ts /opt/probe/
USER node
WORKDIR /tmp
CMD ["node", "/opt/probe/worker.ts"]
