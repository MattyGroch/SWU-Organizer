import Dexie, { type EntityTable } from 'dexie';

import type { VariantSlug } from '~/domain/catalog';
import type { SetKey } from '~/domain/types';

/**
 * One row per printing you own, with an uncapped count.
 *
 * A row per printing — rather than one JSON blob per set — is the point of moving off
 * localStorage. The hot path during a pack-opening session is "+1 to one printing", and
 * that now writes a single small record. The legacy app re-canonicalized and
 * re-serialized the entire set's inventory synchronously on every `+` keypress.
 *
 * `count` is deliberately NOT clamped to the playset quota. The legacy
 * `canonicalizeInventory` did `Math.min(total, quota)`, so importing a 4th copy of a
 * common stored 3 and silently discarded the rest. What you own and what fits in the
 * binder are different questions; the binder count is derived.
 */
export type OwnedPrinting = {
  /** `${setKey}:${num}` — stable and unique across sets. */
  id: string;
  setKey: SetKey;
  /** Canonical card number; the binder slot this printing files into. */
  base: number;
  /** Printing number as the catalog spells it, e.g. "059", "059F", "1152". */
  num: string;
  variant: VariantSlug;
  count: number;
  updatedAt: number;
};

/** Saved decks and precon ownership, kept as one record so it syncs atomically. */
export type DeckLibraryRow = {
  id: 'library';
  json: string;
  updatedAt: number;
};

export type MetaRow = {
  key: string;
  value: string;
};

/** Downscaled card art, keyed by its CDN URL. See `images.ts` for why it is cached. */
export type CardImageRow = {
  url: string;
  blob: Blob;
  width: number;
  fetchedAt: number;
};

/**
 * A group of cards waiting to be added to the collection, reviewed before they count.
 *
 * `deck` batches come from "Add to collection" on a saved deck: committing adds the cards
 * and marks that deck built with them in its box. `scan` batches are for the scanner.
 */
export type IntakeBatch = {
  id: string;
  kind: 'deck' | 'scan';
  label: string;
  deckId?: string;
  createdAt: number;
};

/** One printing in a batch. A card split across variants is several lines. */
export type IntakeLine = {
  id: string;
  batchId: string;
  setKey: SetKey;
  base: number;
  num: string;
  variant: VariantSlug;
  count: number;
  /** Insertion order, so lines keep their place as they are edited. */
  order: number;
  /**
   * A removal, not an addition: `count` copies of this printing leave the collection when
   * the batch is committed — the weaker copy a better scan displaced from its pocket.
   */
  swapOut?: true;
};

export function printingId(setKey: SetKey, num: string): string {
  return `${setKey}:${num}`;
}

export class SwuDatabase extends Dexie {
  owned!: EntityTable<OwnedPrinting, 'id'>;
  deckLibrary!: EntityTable<DeckLibraryRow, 'id'>;
  meta!: EntityTable<MetaRow, 'key'>;
  cardImages!: EntityTable<CardImageRow, 'url'>;
  intakeBatches!: EntityTable<IntakeBatch, 'id'>;
  intakeLines!: EntityTable<IntakeLine, 'id'>;

  constructor(name = 'swu-organizer') {
    super(name);
    this.version(1).stores({
      // `[setKey+base]` powers the binder's per-slot lookups; `setKey` powers set totals.
      owned: 'id, setKey, base, variant, [setKey+base]',
      deckLibrary: 'id',
      meta: 'key',
    });

    // Image cache added separately so an existing collection is never rebuilt to get it.
    this.version(2).stores({
      cardImages: 'url, fetchedAt',
    });

    // The intake queue: additive, so existing data is untouched by the upgrade.
    this.version(3).stores({
      intakeBatches: 'id, createdAt, deckId',
      intakeLines: 'id, batchId',
    });
  }
}

export const db = new SwuDatabase();

export const META_KEYS = {
  /** Set once the one-time localStorage import has run, so it never runs twice. */
  localStorageMigration: 'migration:localStorage',
} as const;

export async function readMeta(database: SwuDatabase, key: string): Promise<string | undefined> {
  return (await database.meta.get(key))?.value;
}

export async function writeMeta(database: SwuDatabase, key: string, value: string): Promise<void> {
  await database.meta.put({ key, value });
}
