import type { LoadedSet, Printing, VariantSlug } from '~/domain/catalog';
import { indexOwnership, type OwnedCounts } from '~/domain/ownership';
import type { SetKey } from '~/domain/types';

import { notifyInventoryChanged } from './changes';
import {
  db,
  emptyOwnedRow,
  printingId,
  withCount,
  type OwnedPrinting,
  type SwuDatabase,
} from './db';

/**
 * Reads and writes for owned printings.
 *
 * Every mutation touches exactly one row. The legacy app's equivalent re-canonicalized
 * the entire set inventory, JSON-stringified it, and wrote it to localStorage
 * synchronously on every single quantity change — on the main thread, during the
 * pack-opening hot path.
 */

/** The printing a bare `+` applies to: Normal if the card has one, else its first. */
export function defaultPrinting(set: LoadedSet, base: number): Printing | undefined {
  const printings = set.printingsByBase.get(base);
  return printings?.find((p) => p.variant === 'normal') ?? printings?.[0];
}

export function printingFor(
  set: LoadedSet,
  base: number,
  variant: VariantSlug,
): Printing | undefined {
  return set.printingsByBase.get(base)?.find((p) => p.variant === variant);
}

export async function readSetRows(
  setKey: SetKey,
  database: SwuDatabase = db,
): Promise<OwnedPrinting[]> {
  return database.owned.where('setKey').equals(setKey).toArray();
}

export async function readSetOwnership(
  setKey: SetKey,
  database: SwuDatabase = db,
): Promise<Map<number, OwnedCounts>> {
  return indexOwnership(await readSetRows(setKey, database));
}

/**
 * Adjusts one printing by `delta`, returning the resulting count.
 *
 * Counts are floored at zero but never capped: what you own and what fits in the binder
 * are separate questions, and the binder count is derived. A row that reaches zero is
 * deleted so the table stays proportional to the collection rather than the catalog.
 */
export async function adjustPrinting(
  setKey: SetKey,
  base: number,
  printing: Printing,
  delta: number,
  database: SwuDatabase = db,
  now = Date.now(),
): Promise<number> {
  const id = printingId(setKey, printing.num);

  const next = await database.transaction('rw', database.owned, async () => {
    const existing = await database.owned.get(id);
    const value = Math.max(0, (existing?.count ?? 0) + delta);

    if (value === 0) {
      if (existing) await database.owned.delete(id);
      return 0;
    }

    await database.owned.put(
      withCount(existing ?? emptyOwnedRow(setKey, base, printing), value, now),
    );
    return value;
  });

  notifyInventoryChanged(setKey);
  return next;
}

export async function setPrintingCount(
  setKey: SetKey,
  base: number,
  printing: Printing,
  count: number,
  database: SwuDatabase = db,
  now = Date.now(),
): Promise<number> {
  const id = printingId(setKey, printing.num);
  const next = Math.max(0, Math.floor(count));

  await database.transaction('rw', database.owned, async () => {
    const existing = await database.owned.get(id);
    if (next === 0) await database.owned.delete(id);
    else {
      await database.owned.put(
        withCount(existing ?? emptyOwnedRow(setKey, base, printing), next, now),
      );
    }
  });
  notifyInventoryChanged(setKey);
  return next;
}
