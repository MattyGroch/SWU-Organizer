# ---------- build stage ----------
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---------- runtime stage (nginx + Node for price sync) ----------
FROM node:20-alpine
RUN apk add --no-cache nginx wget

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

COPY --from=build /app/dist /usr/share/nginx/html
COPY scripts/fetch-prices.mjs /app/scripts/fetch-prices.mjs
COPY scripts/sets.config.json /app/scripts/sets.config.json
COPY scripts/sets.discover-overrides.json /app/scripts/sets.discover-overrides.json

ENV SWU_SETS_DIR=/usr/share/nginx/html/sets \
    SWU_SETS_CONFIG=/app/scripts/sets.config.json \
    SWU_SYNC_INTERVAL_SEC=86400

EXPOSE 8080
LABEL org.opencontainers.image.title="SWU Organizer" \
      org.opencontainers.image.description="Organize Star Wars: Unlimited binders; search, visualize, and track inventory." \
      org.opencontainers.image.source="https://github.com/MattyGroch/SWU-Organizer" \
      org.opencontainers.image.licenses="PolyForm-Noncommercial-1.0.0"

ENTRYPOINT ["/entrypoint.sh"]
HEALTHCHECK CMD wget -qO- http://localhost:8080/ >/dev/null 2>&1 || exit 1
