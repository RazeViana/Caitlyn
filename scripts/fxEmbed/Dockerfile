# @file Dockerfile
# @description Builds FxEmbed's pinned source and locked dependencies inside a separate local container.
# @module fxEmbedContainer

FROM node:24.19.0-bookworm-slim@sha256:be8929e08ae137e81b5e1edba02259e6c4cb2f5ad655092bb9f56b97e41c4536
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/atmosphere/package.json ./packages/atmosphere/package.json
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY src ./src
COPY i18n ./i18n
COPY packages/atmosphere ./packages/atmosphere
COPY branding.example.json entry.mjs service.mjs bootstrap.mjs build.mjs wrangler.toml LICENSE ./
RUN npm run build:atmosphere && node build.mjs
ENV SSL_CERT_FILE=/app/ca-certificates.pem WRANGLER_SEND_METRICS=false WRANGLER_LOG_PATH=/tmp/wrangler.log XDG_CONFIG_HOME=/tmp/config
USER node
CMD ["node", "/app/bootstrap.mjs"]
