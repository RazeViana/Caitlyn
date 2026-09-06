# syntax=docker/dockerfile:1
FROM node:24-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig*.json ./
COPY scripts/cleanDist.mjs ./scripts/cleanDist.mjs
COPY types ./types
COPY commands ./commands
COPY core ./core
COPY events ./events
COPY handlers ./handlers
COPY jobs ./jobs
COPY messages ./messages
COPY main.ts ./

RUN npm run typecheck && npm run build

FROM node:24-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

CMD ["node", "dist/main.js"]
