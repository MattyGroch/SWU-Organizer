#!/bin/sh
# Refresh the per-printing price overlays, then serve the app. Prices re-sync every
# SWU_SYNC_INTERVAL_SEC (default 24h) without a new image; the card catalog itself only
# changes with a rebuild, from data committed by CI.
set -e

SWU_SYNC_INTERVAL_SEC="${SWU_SYNC_INTERVAL_SEC:-86400}"
export SWU_CATALOG_DIR="${SWU_CATALOG_DIR:-/usr/share/nginx/html/sets}"
export SWU_SETS_CONFIG="${SWU_SETS_CONFIG:-/app/scripts/sets.config.json}"

sync_prices() {
  # A failed refresh keeps serving the prices baked into the image.
  node /app/scripts/fetch-catalog-prices.mjs || true
}

sync_prices

(
  while true; do
    sleep "$SWU_SYNC_INTERVAL_SEC"
    sync_prices
  done
) &

exec nginx -g "daemon off;"
