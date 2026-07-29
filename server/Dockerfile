# ---------- build stage ----------
# Using bookworm-slim (Debian, glibc) because better-sqlite3 publishes
# prebuilt linux-x64 binaries for glibc but NOT for Alpine's musl. On Alpine
# we'd have to compile from source (python3/make/g++), which has been flaky
# in Portainer builds. Debian pulls the prebuild and skips native compile.
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

# ---------- runtime ----------
FROM node:20-bookworm-slim
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends wget \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/schema.sql ./dist/schema.sql

EXPOSE 3001
HEALTHCHECK CMD wget -qO- http://localhost:3001/api/health >/dev/null 2>&1 || exit 1
CMD ["node", "dist/index.js"]
