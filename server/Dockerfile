# Build context is the repository root (see docker-compose.yml)
FROM node:20-bookworm-slim

WORKDIR /app

COPY server/package.json ./server/package.json

# better-sqlite3 needs to compile a native addon
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && npm --prefix server install --omit=dev \
    && apt-get purge -y python3 make g++ \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

COPY server ./server
COPY public ./public

ENV PORT=3000
EXPOSE 3000

WORKDIR /app/server
CMD ["node", "server.js"]
