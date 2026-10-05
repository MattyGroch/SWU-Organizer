import { useLiveQuery } from 'dexie-react-hooks';

import type { SetManifestEntry } from '~/domain/catalog';
import type { SetKey } from '~/domain/types';

import { db, readMeta, writeMeta, type SwuDatabase } from './db';

/**
 * Sets kept out of the binder view.
 *
 * Some sets have no binder of their own — TS26 exists only as Twin Suns precon decks, IBH
 * only as the Intro Battle: Hoth box. Their cards are still owned and still count everywhere
 * else (decks, imports, backups); they just have no pages to flip through.
 */

const HIDDEN_SETS_KEY = 'binder:hiddenSets';

/** Until the setting is first changed: TS26 and IBH are precon-only, so they start hidden. */
export const DEFAULT_HIDDEN_SETS: readonly SetKey[] = ['IBH', 'TS26'];

export async function readHiddenSets(database: SwuDatabase = db): Promise<Set<SetKey>> {
  const raw = await readMeta(database, HIDDEN_SETS_KEY);
  if (raw === undefined) return new Set(DEFAULT_HIDDEN_SETS);
  try {
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string') : []);
  } catch {
    return new Set(DEFAULT_HIDDEN_SETS);
  }
}

export async function writeHiddenSets(
  hidden: Iterable<SetKey>,
  database: SwuDatabase = db,
): Promise<void> {
  await writeMeta(database, HIDDEN_SETS_KEY, JSON.stringify([...hidden].sort()));
}

/** `undefined` while the first read is in flight. */
export function useHiddenSets(): Set<SetKey> | undefined {
  return useLiveQuery(() => readHiddenSets(), []);
}

/** The manifest entries that get a binder, in manifest order. */
export function binderEntries(
  entries: readonly SetManifestEntry[],
  hidden: ReadonlySet<SetKey>,
): SetManifestEntry[] {
  const visible = entries.filter((entry) => !hidden.has(entry.key));
  // Never hide everything — with no binder left, show them all rather than nothing.
  return visible.length ? visible : [...entries];
}

const LEADER_BASE_COPIES_KEY = 'binder:leaderBaseCopies';

export type LeaderBaseCopies = 1 | 2;

/** Two, so a Leader or Base pulled for a deck leaves a copy in its pocket. */
export const DEFAULT_LEADER_BASE_COPIES: LeaderBaseCopies = 2;

/** How many copies of each Leader and Base the binder holds; the rest live in bulk. */
export async function readLeaderBaseCopies(database: SwuDatabase = db): Promise<LeaderBaseCopies> {
  const raw = await readMeta(database, LEADER_BASE_COPIES_KEY);
  return raw === '1' ? 1 : raw === '2' ? 2 : DEFAULT_LEADER_BASE_COPIES;
}

export async function writeLeaderBaseCopies(
  copies: LeaderBaseCopies,
  database: SwuDatabase = db,
): Promise<void> {
  await writeMeta(database, LEADER_BASE_COPIES_KEY, String(copies));
}

/** The default until the first read lands. */
export function useLeaderBaseCopies(): LeaderBaseCopies {
  return useLiveQuery(() => readLeaderBaseCopies(), []) ?? DEFAULT_LEADER_BASE_COPIES;
}
