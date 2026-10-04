import { useLiveQuery } from 'dexie-react-hooks';

import type { SetManifestEntry } from '~/domain/catalog';
import type { SetKey } from '~/domain/types';

import { db, readMeta, writeMeta, type SwuDatabase } from './db';

/**
 * Sets kept out of the binder view.
 *
 * Some sets have no binder of their own — TS26 exists only as Twin Suns precon decks. Its
 * cards are still owned and still count everywhere else (decks, imports, backups); they
 * just have no pages to flip through.
 */

const HIDDEN_SETS_KEY = 'binder:hiddenSets';

/** Until the setting is first changed: TS26 is precon-only, so it starts hidden. */
export const DEFAULT_HIDDEN_SETS: readonly SetKey[] = ['TS26'];

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
