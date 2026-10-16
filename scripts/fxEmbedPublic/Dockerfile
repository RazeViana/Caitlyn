# @file Dockerfile
# @description Adds a public preview entry point to an immutable Caitlyn FxEmbed image without installing packages.
# @module publicFxContainer

ARG FXEMBED_BASE=ghcr.io/razeviana/caitlyn-fxembed@sha256:3a63e24a17043d63696eb199bb275836b89094e1fcef4dd493cc6e3a424bb9e5
FROM ${FXEMBED_BASE}
USER root
ARG FXEMBED_PUBLIC_ORIGIN
COPY --chmod=644 entry.mjs /app/public-entry.mjs
COPY --chmod=644 service.mjs /app/public-service.mjs
COPY --chmod=644 routing.mjs /app/public-routing.mjs
COPY --chmod=644 build.mjs /app/public-build.mjs
COPY --chmod=644 bootstrap.mjs /app/public-bootstrap.mjs
RUN sed -i 's|"./routing.mjs"|"./public-routing.mjs"|' /app/public-service.mjs \
    && FXEMBED_PUBLIC_ORIGIN="$FXEMBED_PUBLIC_ORIGIN" node /app/public-build.mjs
USER node
CMD ["node", "/app/public-bootstrap.mjs"]
