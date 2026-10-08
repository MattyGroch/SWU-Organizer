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

/**
 * Which promo picture each binder pocket shows: purely cosmetic.
 *
 * A card's promos (`ASHOP-014`, `P26-14`, `P26-228`) are one printing to the collection —
 * they differ by an event badge, sometimes by art — so which one you own is not recorded.
 * This only picks the picture. Keyed `SET:base`, so a choice never follows a card's art
 * number if the catalog ever renames it: an unknown number just falls back.
 */
const PROMO_ART_KEY = 'binder:promoArt';

export type PromoArtChoices = Readonly<Record<string, string>>;

export const promoArtKey = (setKey: SetKey, base: number) => `${setKey}:${base}`;

export async function readPromoArt(database: SwuDatabase = db): Promise<PromoArtChoices> {
  const raw = await readMeta(database, PROMO_ART_KEY);
  try {
    const parsed: unknown = raw === undefined ? {} : JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as PromoArtChoices)
      : {};
  } catch {
    return {};
  }
}

/** Sets the picture for one card; `undefined` goes back to the default. */
export async function writePromoArt(
  setKey: SetKey,
  base: number,
  num: string | undefined,
  database: SwuDatabase = db,
): Promise<void> {
  await database.transaction('rw', database.meta, async () => {
    const next: Record<string, string> = { ...(await readPromoArt(database)) };
    if (num === undefined) delete next[promoArtKey(setKey, base)];
    else next[promoArtKey(setKey, base)] = num;
    await writeMeta(database, PROMO_ART_KEY, JSON.stringify(next));
  });
}

/** `undefined` while the first read is in flight. */
export function usePromoArt(): PromoArtChoices | undefined {
  return useLiveQuery(() => readPromoArt(), []);
}
