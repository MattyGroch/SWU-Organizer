#!/bin/sh
# Refresh compact price overlays, then serve static app. Re-sync on SWU_SYNC_INTERVAL_SEC (default 24h).
set -e

SWU_SYNC_INTERVAL_SEC="${SWU_SYNC_INTERVAL_SEC:-86400}"
export SWU_SETS_DIR="${SWU_SETS_DIR:-/usr/share/nginx/html/sets}"
export SWU_SETS_CONFIG="${SWU_SETS_CONFIG:-/app/scripts/sets.config.json}"

sync_prices() {
  node /app/scripts/fetch-prices.mjs || true
}

sync_prices

(
  while true; do
    sleep "$SWU_SYNC_INTERVAL_SEC"
    sync_prices
  done
) &

exec nginx -g "daemon off;"
