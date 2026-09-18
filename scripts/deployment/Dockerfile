# @file Dockerfile
# @description Builds separate compiled bot and trusted Docker broker images for AMD64 deployment.
# @module deploymentContainer

FROM node:24-alpine@sha256:83f1c388c31fb2e51f7cbd4dea949b96260798c98f206e8e4696bc93bd964e3a AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig*.json ./
COPY scripts ./scripts
COPY types ./types
COPY commands ./commands
COPY core ./core
COPY events ./events
COPY handlers ./handlers
COPY jobs ./jobs
COPY messages ./messages
COPY main.ts ./
RUN npm run typecheck && npm run build && npx --no-install tsc -p scripts/deployment/tsconfig.json

FROM node:24-alpine@sha256:83f1c388c31fb2e51f7cbd4dea949b96260798c98f206e8e4696bc93bd964e3a AS bot
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY --chmod=644 scripts/deployment/checkRelease.mjs ./scripts/deployment/
RUN chmod 644 /app/package.json /app/package-lock.json \
    && chmod 755 /app/scripts /app/scripts/deployment
USER node
RUN node --input-type=module -e "await import('./dist/core/environment.js')"
CMD ["node", "dist/main.js"]

FROM bot AS broker
USER root
RUN apk add --no-cache docker-cli
COPY --chmod=644 scripts/deployment/startBroker.mjs scripts/deployment/brokerHealth.mjs ./scripts/deployment/
RUN chmod 755 /app/scripts /app/scripts/deployment
ENV HOME=/tmp
USER node
RUN node --check scripts/deployment/startBroker.mjs \
    && node --input-type=module -e "await import('./dist/scripts/socialWorker/runner.js')"
CMD ["node", "scripts/deployment/startBroker.mjs"]
