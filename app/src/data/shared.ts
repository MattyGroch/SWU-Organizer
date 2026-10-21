import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { createContext, useContext } from 'react';

import { parseDeckLibrary, type DeckLibrary } from '~/domain/decks';
import type { SetKey } from '~/domain/types';

import { manifestQuery, setQuery } from './catalog';
import type { OwnedPrinting } from './db';
import { payloadToOwned, type InventoryPayload } from './sync/inventory';

/**
 * Share links: someone else's collection, read-only, at `/share/<token>`.
 *
 * Shared data lives only in memory (React Query). It never goes near IndexedDB or the sync
 * engine, so viewing a share cannot touch the visitor's own collection.
 */

/** Someone else's collection, as the binder, bulk and stats views read it. */
export type SharedCollection = {
  token: string;
  owned: OwnedPrinting[];
  library: DeckLibrary;
  hiddenSets: Set<SetKey>;
};

export const SharedCollectionContext = createContext<SharedCollection | null>(null);

/** The share on screen, or `null` in your own collection. */
export function useSharedCollection(): SharedCollection | null {
  return useContext(SharedCollectionContext);
}

type SharedResponse = {
  sets: Record<string, { data: InventoryPayload }>;
  decks: unknown;
  hiddenSets: string[];
};

/** Thrown for a link that is unknown or has been turned off. */
export class ShareNotFoundError extends Error {
  constructor() {
    super('This share link is no longer active.');
  }
}

/**
 * The share behind a token, resolved through the catalog. Polled, so it stays live: the
 * owner's edits show up within a minute, or as soon as the tab regains focus.
 */
export function sharedQuery(client: QueryClient, token: string) {
  return queryOptions({
    queryKey: ['shared', token] as const,
    queryFn: async ({ signal }): Promise<SharedCollection> => {
      const response = await fetch(`/api/shared/${encodeURIComponent(token)}`, {
        signal,
        credentials: 'omit',
      });
      if (response.status === 404) throw new ShareNotFoundError();
      if (!response.ok) throw new Error(`Share request failed (${response.status})`);
      const body = (await response.json()) as SharedResponse;

      const entries = await client.ensureQueryData(manifestQuery());
      const owned: OwnedPrinting[] = [];
      await Promise.all(
        Object.entries(body.sets).map(async ([setKey, { data }]) => {
          const entry = entries.find((e) => e.key === setKey);
          if (!entry) return;
          const set = await client.ensureQueryData(setQuery(entry));
          // A printing this catalog doesn't know yet is left out, not fatal: it's a view.
          owned.push(...payloadToOwned(setKey, data, set).rows);
        }),
      );

      return {
        token,
        owned,
        library: parseDeckLibrary(JSON.stringify(body.decks ?? null)),
        hiddenSets: new Set(body.hiddenSets),
      };
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: (failures, error) => !(error instanceof ShareNotFoundError) && failures < 2,
  });
}

/* The owner's side: making, changing and stopping their own link. */

export type MyShare = { token: string; hiddenSets: string[] };

export function shareUrl(token: string): string {
  return `${window.location.origin}/share/${token}`;
}

async function shareRequest(method: string, path = '', body?: unknown): Promise<Response> {
  return fetch(`/api/share${path}`, {
    method,
    credentials: 'include',
    ...(body !== undefined && {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  });
}

/** Your link, or `null` when you aren't sharing. */
export async function fetchMyShare(): Promise<MyShare | null> {
  const response = await shareRequest('GET');
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Couldn't check your share link (${response.status}).`);
  return (await response.json()) as MyShare;
}

/** Makes your link, or replaces it with a new one (the old one stops working). */
export async function createMyShare(hiddenSets: Iterable<SetKey>): Promise<MyShare> {
  const response = await shareRequest('POST', '', { hiddenSets: [...hiddenSets].sort() });
  if (!response.ok) throw new Error(`Couldn't make a share link (${response.status}).`);
  return (await response.json()) as MyShare;
}

export async function revokeMyShare(): Promise<void> {
  const response = await shareRequest('DELETE');
  if (!response.ok) throw new Error(`Couldn't turn off your share link (${response.status}).`);
}

/**
 * Keeps the share's hidden sets in step with yours. Best effort: signed out, or not sharing,
 * it simply does nothing.
 */
export async function pushShareHiddenSets(hiddenSets: Iterable<SetKey>): Promise<void> {
  await shareRequest('PUT', '/settings', { hiddenSets: [...hiddenSets].sort() }).catch(() => {});
}
