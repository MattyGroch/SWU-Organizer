/**
 * Service worker: makes the installed app open, and scan, without a connection.
 *
 * - Pages: network first, so a deploy shows up on the next load; the cached shell when
 *   offline.
 * - Hashed build assets (/assets/): cache first — a hash never changes its content.
 * - Data (/sets, /precons, /scan-data, /fonts, /icons): network first too, falling back to
 *   the cache when offline or after DATA_TIMEOUT_MS. Never stale-while-revalidate: the
 *   scan index is two files that must match, and a background refresh could leave one
 *   new and one old. Online this costs little — nginx answers unchanged files with 304.
 * - Never touched: /api (sync is live data) and /card-art (the app keeps its own
 *   downscaled copies in IndexedDB).
 *
 * The build replaces BUILD_ID and PRECACHE (see the swManifest plugin in vite.config.ts);
 * a new BUILD_ID makes a new cache and drops the old ones.
 */
const BUILD_ID = '__BUILD_ID__';
const PRECACHE = /** @type {string[]} */ (JSON.parse('__PRECACHE__'));

const SHELL = `shell-${BUILD_ID}`;
const DATA = 'data-v1';
const DATA_PREFIXES = ['/sets/', '/precons/', '/scan-data/', '/fonts/', '/icons/'];
/** On a poor connection, give up on the network and use the cache after this long. */
const DATA_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(['/', ...PRECACHE]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('shell-') && key !== SHELL)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/card-art/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request));
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, SHELL));
  } else if (DATA_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    event.respondWith(networkFirstData(request));
  }
});

/** Every route is the same single page: fall back to the cached shell for any of them. */
async function networkFirstPage(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL);
      await cache.put('/', response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match('/', { cacheName: SHELL });
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request, { cacheName });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkFirstData(request) {
  const cache = await caches.open(DATA);
  const network = fetch(request).then(async (response) => {
    if (response.ok) await cache.put(request, response.clone());
    return response;
  });
  // Served from the cache instead, a failed download is expected, not an error to log.
  network.catch(() => {});
  try {
    return await withTimeout(network, DATA_TIMEOUT_MS);
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    // Timed out with nothing cached: keep waiting for the same download.
    if (error instanceof TimeoutError) return network;
    throw error;
  }
}

class TimeoutError extends Error {}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
