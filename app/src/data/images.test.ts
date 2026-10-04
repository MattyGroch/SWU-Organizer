import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SwuDatabase } from './db';
import { cachedImageCount, clearImageCache, getCardImage, type Downscaler } from './images';

/** Stands in for the canvas pipeline, which jsdom has no OffscreenCanvas for. */
const fakeDownscale: Downscaler = async (blob) => ({
  blob: new Blob([`small:${blob.size}`], { type: 'image/webp' }),
  width: 360,
});

/**
 * Minimal stand-in for a fetch Response.
 *
 * `new Response(blob)` cannot be constructed here — jsdom's Blob and undici's Response
 * disagree about `stream()`. Only `ok` and `blob()` are used, so a stub is both
 * sufficient and more honest about the contract.
 */
function imageResponse(bytes = 260_000) {
  const blob = new Blob(['x'.repeat(bytes)], { type: 'image/jpeg' });
  return { ok: true, blob: async () => blob } as unknown as Response;
}

function missingResponse() {
  return { ok: false, blob: async () => new Blob([]) } as unknown as Response;
}

let database: SwuDatabase;

beforeEach(async () => {
  database = new SwuDatabase(`test-${crypto.randomUUID()}`);
  await database.open();
});

describe('getCardImage', () => {
  it('fetches, downscales and stores on first use', async () => {
    const fetchFn = vi.fn(async () => imageResponse());

    const blob = await getCardImage('https://cdn/SOR/001.png', {
      database,
      fetchFn: fetchFn as unknown as typeof fetch,
      downscale: fakeDownscale,
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(blob).toBeInstanceOf(Blob);
    // Stored at a fraction of the 260 KB the CDN serves.
    expect(blob!.size).toBeLessThan(1000);
    expect(await cachedImageCount(database)).toBe(1);
  });

  it('serves the cached copy without hitting the network again', async () => {
    const fetchFn = vi.fn(async () => imageResponse());
    const deps = {
      database,
      fetchFn: fetchFn as unknown as typeof fetch,
      downscale: fakeDownscale,
    };

    await getCardImage('https://cdn/SOR/001.png', deps);
    await getCardImage('https://cdn/SOR/001.png', deps);

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent requests for the same image into one fetch', async () => {
    const fetchFn = vi.fn(async () => imageResponse());
    const deps = {
      database,
      fetchFn: fetchFn as unknown as typeof fetch,
      downscale: fakeDownscale,
    };

    // Eight cells can ask for one image in the same tick.
    await Promise.all(Array.from({ length: 8 }, () => getCardImage('https://cdn/x.png', deps)));

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('returns undefined for a missing image rather than throwing', async () => {
    const result = await getCardImage('https://cdn/missing.png', {
      database,
      fetchFn: (async () => missingResponse()) as unknown as typeof fetch,
      downscale: fakeDownscale,
    });

    // A foil printing's URL 404s; the cell must fall back to text, not break the binder.
    expect(result).toBeUndefined();
    expect(await cachedImageCount(database)).toBe(0);
  });

  it('returns undefined when the network fails', async () => {
    const result = await getCardImage('https://cdn/x.png', {
      database,
      fetchFn: (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch,
      downscale: fakeDownscale,
    });
    expect(result).toBeUndefined();
  });

  it('keeps different printings separate', async () => {
    const deps = {
      database,
      fetchFn: (async () => imageResponse()) as unknown as typeof fetch,
      downscale: fakeDownscale,
    };

    await getCardImage('https://cdn/SOR/001.png', deps);
    await getCardImage('https://cdn/SOR/269.png', deps);

    expect(await cachedImageCount(database)).toBe(2);
  });
});

describe('clearImageCache', () => {
  it('empties the cache', async () => {
    await getCardImage('https://cdn/x.png', {
      database,
      fetchFn: (async () => imageResponse()) as unknown as typeof fetch,
      downscale: fakeDownscale,
    });
    expect(await cachedImageCount(database)).toBe(1);

    await clearImageCache(database);
    expect(await cachedImageCount(database)).toBe(0);
  });
});
