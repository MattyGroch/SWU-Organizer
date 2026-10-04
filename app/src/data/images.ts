import { db, type SwuDatabase } from './db';

/**
 * Card image cache.
 *
 * The CDN only serves full-resolution art (~260 KB each; there is no thumbnail endpoint,
 * verified by probing). A binder spread shows 24 slots, so an uncached spread would pull
 * roughly 6 MB. Each image is therefore downscaled to binder-cell size once and kept in
 * IndexedDB, making every later view instant and offline-capable for roughly 3-4 MB per
 * set instead of 130 MB.
 */

/** Wide enough for a binder cell on a 2x display. */
const TARGET_WIDTH = 360;
const MAX_CONCURRENT_FETCHES = 4;

export type CachedImage = {
  /** The CDN URL, which is deterministic per printing. */
  url: string;
  blob: Blob;
  width: number;
  fetchedAt: number;
};

/** Downscale hook, injectable so the cache is testable without a canvas. */
export type Downscaler = (
  blob: Blob,
  targetWidth: number,
) => Promise<{ blob: Blob; width: number }>;

export async function downscaleWithCanvas(
  blob: Blob,
  targetWidth: number,
): Promise<{ blob: Blob; width: number }> {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
    return { blob, width: 0 };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    // Undecodable here but possibly fine in an <img>; keep the original rather than
    // losing the art entirely.
    return { blob, width: 0 };
  }

  try {
    // Leaders and Bases are landscape; scaling by width alone keeps either orientation.
    const scale = Math.min(1, targetWidth / bitmap.width);
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) return { blob, width: bitmap.width };

    context.drawImage(bitmap, 0, 0, width, height);

    // WebP encoding is not universal (older Safari). Fall back to JPEG, then to the
    // original — a bigger cached image is far better than no image.
    for (const type of ['image/webp', 'image/jpeg'] as const) {
      try {
        return { blob: await canvas.convertToBlob({ type, quality: 0.82 }), width };
      } catch {
        continue;
      }
    }
    return { blob, width: bitmap.width };
  } finally {
    bitmap.close();
  }
}

/** In-flight requests, so eight cells asking for one image make one network call. */
const inFlight = new Map<string, Promise<Blob | undefined>>();
let active = 0;
const waiting: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (active < MAX_CONCURRENT_FETCHES) {
    active += 1;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
  active += 1;
}

function releaseSlot(): void {
  active -= 1;
  waiting.shift()?.();
}

export type ImageCacheDeps = {
  database?: SwuDatabase;
  fetchFn?: typeof fetch;
  downscale?: Downscaler;
  now?: () => number;
};

/**
 * Returns the cached blob for a card image, fetching and storing it on first use.
 *
 * Resolves to `undefined` rather than throwing when the image is unavailable — a missing
 * image should degrade to the text layout, never break the binder.
 */
export async function getCardImage(
  url: string,
  deps: ImageCacheDeps = {},
): Promise<Blob | undefined> {
  const database = deps.database ?? db;

  const cached = await database.cardImages.get(url);
  if (cached) return cached.blob;

  const existing = inFlight.get(url);
  if (existing) return existing;

  const request = (async (): Promise<Blob | undefined> => {
    await acquireSlot();
    try {
      const fetchFn = deps.fetchFn ?? fetch;
      const response = await fetchFn(url);
      if (!response.ok) return undefined;

      const original = await response.blob();
      const downscale = deps.downscale ?? downscaleWithCanvas;
      const { blob, width } = await downscale(original, TARGET_WIDTH);

      await database.cardImages.put({
        url,
        blob,
        width,
        fetchedAt: deps.now?.() ?? Date.now(),
      });
      return blob;
    } catch {
      return undefined;
    } finally {
      releaseSlot();
      inFlight.delete(url);
    }
  })();

  inFlight.set(url, request);
  return request;
}

export async function cachedImageCount(database: SwuDatabase = db): Promise<number> {
  return database.cardImages.count();
}

export async function clearImageCache(database: SwuDatabase = db): Promise<void> {
  await database.cardImages.clear();
}

/**
 * Object URLs for cached blobs.
 *
 * Bounded, because every `createObjectURL` pins its blob in memory until revoked and the
 * binder can scroll past thousands of cards in a session.
 */
const MAX_OBJECT_URLS = 400;
const objectUrls = new Map<string, string>();

export function objectUrlFor(url: string, blob: Blob): string {
  const existing = objectUrls.get(url);
  if (existing) return existing;

  if (objectUrls.size >= MAX_OBJECT_URLS) {
    const oldest = objectUrls.keys().next();
    if (!oldest.done) {
      URL.revokeObjectURL(objectUrls.get(oldest.value)!);
      objectUrls.delete(oldest.value);
    }
  }

  const created = URL.createObjectURL(blob);
  objectUrls.set(url, created);
  return created;
}

export function releaseObjectUrls(): void {
  for (const url of objectUrls.values()) URL.revokeObjectURL(url);
  objectUrls.clear();
}
