import type { LoadedSet, Printing, VariantSlug } from '~/domain/catalog';
import { indexOwnership, type OwnedCounts } from '~/domain/ownership';
import type { SetKey } from '~/domain/types';

import { notifyInventoryChanged } from './changes';
import { db, printingId, type OwnedPrinting, type SwuDatabase } from './db';

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

    await database.owned.put({
      id,
      setKey,
      base,
      num: printing.num,
      variant: printing.variant,
      count: value,
      updatedAt: now,
    });
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

  if (next === 0) {
    await database.owned.delete(id);
    notifyInventoryChanged(setKey);
    return 0;
  }

  await database.owned.put({
    id,
    setKey,
    base,
    num: printing.num,
    variant: printing.variant,
    count: next,
    updatedAt: now,
  });
  notifyInventoryChanged(setKey);
  return next;
}

/**
 * Empties one binder slot — every printing of that card.
 *
 * Returns what was removed so the action can be undone. A single keystroke that can wipe
 * a slot needs a way back; a confirmation prompt would be the obvious alternative, but it
 * would interrupt the pack-filing flow this shortcut exists to speed up.
 */
export async function clearSlot(
  setKey: SetKey,
  base: number,
  database: SwuDatabase = db,
): Promise<OwnedPrinting[]> {
  const removed = await database.transaction('rw', database.owned, async () => {
    const rows = await database.owned.where({ setKey, base }).toArray();
    if (rows.length) await database.owned.bulkDelete(rows.map((row) => row.id));
    return rows;
  });

  if (removed.length) notifyInventoryChanged(setKey);
  return removed;
}

/** Puts back rows captured by `clearSlot`, exactly as they were. */
export async function restorePrintings(
  rows: readonly OwnedPrinting[],
  database: SwuDatabase = db,
): Promise<void> {
  if (!rows.length) return;
  await database.owned.bulkPut([...rows]);
  for (const setKey of new Set(rows.map((row) => row.setKey))) notifyInventoryChanged(setKey);
}

/**
 * Tops a card's default printing up to a full playset, never reducing it.
 *
 * Uses the card's own quota rather than a flat 3, so a Leader or Base fills to 1 and
 * Swarming Vulture Droid fills to 15. Returns the resulting count.
 */
export async function fillPlayset(
  setKey: SetKey,
  base: number,
  printing: Printing,
  quota: number,
  database: SwuDatabase = db,
  now = Date.now(),
): Promise<number> {
  const id = printingId(setKey, printing.num);

  const next = await database.transaction('rw', database.owned, async () => {
    const existing = await database.owned.get(id);
    // Max rather than assignment: hitting this with spares on the slot must not delete
    // them. Reducing is what Shift+digit and Shift+Minus are for.
    const value = Math.max(existing?.count ?? 0, quota);
    if (value === existing?.count) return value;

    await database.owned.put({
      id,
      setKey,
      base,
      num: printing.num,
      variant: printing.variant,
      count: value,
      updatedAt: now,
    });
    return value;
  });

  notifyInventoryChanged(setKey);
  return next;
}
