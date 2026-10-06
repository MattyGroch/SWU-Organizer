# SWU Organizer — the web app (app/), served by nginx.
# The sync API is a separate image built from server/ (see docker-compose.yml).

# ---------- build: the app ----------
# Runs on the build machine's own platform: dist/ is static files, the same for every
# target. Building it per platform made CI build arm64 under QEMU, ~5 min instead of ~35s.
FROM --platform=$BUILDPLATFORM node:20-alpine AS build
WORKDIR /build/app
COPY app/package*.json ./
RUN npm ci
COPY app/ ./
# Type-checks (app and tests), then bundles to dist/.
RUN npm run build

# ---------- runtime: nginx, plus Node for the daily price refresh ----------
FROM node:20-alpine
RUN apk add --no-cache nginx wget

# Alpine nginx includes conf.d at root context; server{} must live in http.d (inside http{}).
COPY docker/nginx.conf /etc/nginx/http.d/default.conf
COPY docker/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

COPY --from=build /build/app/dist /usr/share/nginx/html
# Files keep the build host's permissions. A host with a strict umask (photonOS root uses
# 0027) leaves them unreadable to nginx's non-root workers, which then answer 403 for
# everything copied from app/public — catalogs, precons, fonts. Normalise them here.
RUN chmod -R a+rX /usr/share/nginx/html
# Fail the build, not the deploy, if the nginx config is broken.
RUN mkdir -p /run/nginx && nginx -t
COPY scripts/fetch-catalog-prices.mjs /app/scripts/fetch-catalog-prices.mjs
COPY scripts/lib /app/scripts/lib
COPY scripts/sets.config.json /app/scripts/sets.config.json

ENV SWU_CATALOG_DIR=/usr/share/nginx/html/sets \
    SWU_SETS_CONFIG=/app/scripts/sets.config.json \
    SWU_SYNC_INTERVAL_SEC=86400

EXPOSE 8080
LABEL org.opencontainers.image.title="SWU Organizer" \
      org.opencontainers.image.description="Track a Star Wars: Unlimited collection binder by binder, printing by printing; build decks from it." \
      org.opencontainers.image.source="https://github.com/MattyGroch/SWU-Organizer" \
      org.opencontainers.image.licenses="PolyForm-Noncommercial-1.0.0"

ENTRYPOINT ["/entrypoint.sh"]
HEALTHCHECK CMD wget -qO- http://localhost:8080/ >/dev/null 2>&1 || exit 1
