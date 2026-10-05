import Dexie, { type EntityTable } from 'dexie';

import type { VariantSlug } from '~/domain/catalog';
import type { StackFate } from '~/domain/putAway';
import type { SetKey } from '~/domain/types';

import { storageHealth, watchStorage } from './storageHealth';

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
  /** Every copy owned, wherever it is. */
  count: number;
  /**
   * How many of `count` live in the bulk box rather than the binder; never more than
   * `count`, and absent when none do. Stored, not derived: the box never refills the
   * binder, so which copies sit where cannot be worked out from totals.
   */
  bulk?: number;
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
};

/**
 * A physical stack of scanned cards, in the order they were scanned, kept so the stack can
 * be put away without reading card numbers (see `domain/putAway.ts`).
 *
 * Scans land in the open stack — the newest one not yet closed. Committing the scan batch,
 * or starting to put the stack away, closes it: later scans start a new stack, and the
 * steps already walked stay valid. A stack outlives its batch until it is put away.
 */
export type StackRow = {
  id: string;
  label: string;
  createdAt: number;
  closedAt?: number;
  /** Sorters in use, chosen when putting away starts. */
  sorters?: number;
  /** Steps of the put-away plan already done. */
  step: number;
};

/** One physical card in a stack: the scan order is `seq`, one row per copy. */
export type StackCardRow = {
  id: string;
  stackId: string;
  seq: number;
  setKey: SetKey;
  base: number;
  num: string;
  variant: VariantSlug;
  fate: StackFate;
  swapOut?: { num: string; variant: VariantSlug };
};

export function printingId(setKey: SetKey, num: string): string {
  return `${setKey}:${num}`;
}

/** A row for a printing not owned yet, ready for `withCount`. */
export function emptyOwnedRow(
  setKey: SetKey,
  base: number,
  printing: { num: string; variant: VariantSlug },
): OwnedPrinting {
  return {
    id: printingId(setKey, printing.num),
    setKey,
    base,
    num: printing.num,
    variant: printing.variant,
    count: 0,
    updatedAt: 0,
  };
}

/**
 * `row` at a new total. Copies added go to the binder; copies removed leave the binder
 * first, and the bulk count only drops once the binder has none left.
 */
export function withCount(row: OwnedPrinting, count: number, now: number): OwnedPrinting {
  const { bulk, ...rest } = row;
  const kept = Math.min(bulk ?? 0, count);
  return kept > 0
    ? { ...rest, count, bulk: kept, updatedAt: now }
    : { ...rest, count, updatedAt: now };
}

export class SwuDatabase extends Dexie {
  owned!: EntityTable<OwnedPrinting, 'id'>;
  deckLibrary!: EntityTable<DeckLibraryRow, 'id'>;
  meta!: EntityTable<MetaRow, 'key'>;
  cardImages!: EntityTable<CardImageRow, 'url'>;
  intakeBatches!: EntityTable<IntakeBatch, 'id'>;
  intakeLines!: EntityTable<IntakeLine, 'id'>;
  stacks!: EntityTable<StackRow, 'id'>;
  stackCards!: EntityTable<StackCardRow, 'id'>;

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

    // Scanned stacks, card by card in scan order: additive like the intake queue.
    this.version(4).stores({
      stacks: 'id, createdAt',
      stackCards: 'id, stackId',
    });
  }
}

export const db = new SwuDatabase();
// Every request is watched, so storage that stops answering says so (see storageHealth).
db.use(watchStorage(storageHealth));

export async function readMeta(database: SwuDatabase, key: string): Promise<string | undefined> {
  return (await database.meta.get(key))?.value;
}

export async function writeMeta(database: SwuDatabase, key: string, value: string): Promise<void> {
  await database.meta.put({ key, value });
}
