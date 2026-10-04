import { queryOptions, type QueryClient } from '@tanstack/react-query';

import {
  parsePriceTable,
  parseSetCatalog,
  parseSetManifest,
  toLoadedSet,
  type LoadedSet,
  type SetManifestEntry,
} from '~/domain/catalog';
import { fetchPreconCatalog } from '~/domain/precons';
import type { SetKey } from '~/domain/types';

/**
 * Set-catalog loading.
 *
 * Replaces three legacy mechanisms at once:
 *   - `createLoadCommitGate()`, a hand-rolled token system for discarding stale loads;
 *   - `parsedCacheRef`, a mutable ref used as a cache and then read from inside `useMemo`
 *     calls that declared unrelated dependencies;
 *   - a `load()` effect that awaited `Promise.all` over EVERY set before the binder could
 *     render, so first paint waited on ~1.6 MB of JSON across 22 requests.
 *
 * Here each set is its own query. The active set is what a route awaits; the rest resolve
 * lazily in the background, and cancellation/staleness is the query client's problem.
 */

const SETS_BASE = '/sets';

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Request failed (${response.status}): ${url}`);
  return response.json();
}

export function manifestQuery() {
  return queryOptions({
    queryKey: ['manifest'] as const,
    queryFn: async ({ signal }) =>
      parseSetManifest(await fetchJson(`${SETS_BASE}/manifest.json`, signal)),
    // The catalog only changes when CI opens a data PR; no need to re-check during a session.
    staleTime: Infinity,
  });
}

/**
 * Prices are a separate overlay from the card catalog, refreshed on its own schedule by
 * the Docker entrypoint. A missing or unreadable overlay is not an error — the set still
 * loads, just without valuations.
 */
async function fetchPrices(file: string, signal?: AbortSignal) {
  try {
    const url = `${SETS_BASE}/${file.replace(/\.json$/, '.prices.json')}`;
    return parsePriceTable(await fetchJson(url, signal));
  } catch {
    return new Map<string, number>();
  }
}

export function setQuery(entry: SetManifestEntry) {
  return queryOptions({
    queryKey: ['set', entry.key] as const,
    queryFn: async ({ signal }): Promise<LoadedSet> => {
      const [catalogPayload, prices] = await Promise.all([
        fetchJson(`${SETS_BASE}/${entry.file}`, signal),
        fetchPrices(entry.file, signal),
      ]);
      const catalog = parseSetCatalog(catalogPayload);
      return toLoadedSet({ ...catalog, label: entry.label ?? catalog.label }, prices);
    },
    staleTime: Infinity,
  });
}

/** Precon decklists, used so owned starter decks count toward the collection. */
export function preconQuery() {
  return queryOptions({
    queryKey: ['precons'] as const,
    queryFn: () => fetchPreconCatalog((input) => fetch(input)),
    staleTime: Infinity,
  });
}

/** The newest set is the last manifest entry — `discover-sets.mjs` writes release order. */
export function newestSetKey(entries: SetManifestEntry[]): SetKey | undefined {
  return entries[entries.length - 1]?.key;
}

/**
 * Warms every non-active set in the background.
 *
 * Cross-set features (search suggestions, deck check, the scanner) need all sets
 * eventually, but nothing should block first paint on them — which is exactly the
 * mistake the legacy `load()` made.
 */
export function prefetchOtherSets(
  client: QueryClient,
  entries: SetManifestEntry[],
  activeSetKey: SetKey,
): void {
  for (const entry of entries) {
    if (entry.key === activeSetKey) continue;
    void client.prefetchQuery(setQuery(entry));
  }
}

/** Sets already resolved in the cache, for features that span the whole collection. */
export function loadedSets(
  client: QueryClient,
  entries: SetManifestEntry[],
): Map<SetKey, LoadedSet> {
  const sets = new Map<SetKey, LoadedSet>();
  for (const entry of entries) {
    const set = client.getQueryData(setQuery(entry).queryKey);
    if (set) sets.set(entry.key, set);
  }
  return sets;
}
