# syntax=docker/dockerfile:1
FROM node:20-alpine

WORKDIR /app

# Install prod‑only deps
COPY package*.json ./
RUN npm ci --omit=dev

# Copy the bot
COPY . .

# ↓ Run the slash‑command deploy script *every* container start,
#   then launch the bot.
CMD ["sh", "-c", "npm run deploy && npm start"]
