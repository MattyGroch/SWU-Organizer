import type { Printing, VariantSlug } from '~/domain/catalog';
import {
  indexOwnership,
  ownedFor,
  pocketCounts,
  pocketRoom,
  type PocketRoom,
  type VariantCounts,
} from '~/domain/ownership';
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
import { heldFromBinder, readLibrary } from './spill';

/**
 * Edits made from the binder and list: they change a card's binder pocket and nothing
 * else. A pocket holds at most its playset, so there are no spares here — a copy that does
 * not fit goes in through Intake or the Bulk page. The one exception is a better printing
 * than the pocket's weakest copy: it goes in, and that copy moves to the bulk box.
 */

/** A card's rows as they were before an edit, so it can be undone. */
export type CardSnapshot = { setKey: SetKey; base: number; rows: OwnedPrinting[] };

async function readPocket(database: SwuDatabase, setKey: SetKey, base: number) {
  const rows = await database.owned.where({ setKey, base }).toArray();
  const held = heldFromBinder(await readLibrary(database), setKey, base);
  const pocket = pocketCounts(ownedFor(indexOwnership(rows), base), { binder: held, bulk: {} });
  return { rows, pocket: pocket.byVariant };
}

export type PocketAdd = PocketRoom & { before: CardSnapshot };

/**
 * Adds one copy of `printing` to the pocket if it fits. When the pocket is full and the copy
 * beats its weakest, that weakest copy moves to the bulk box (`upgrade`); when it doesn't,
 * nothing changes (`full`).
 */
export async function addToPocket(
  setKey: SetKey,
  base: number,
  printing: Printing,
  quota: number,
  database: SwuDatabase = db,
  now = Date.now(),
): Promise<PocketAdd> {
  const result = await database.transaction(
    'rw',
    database.owned,
    database.deckLibrary,
    async () => {
      const { rows, pocket } = await readPocket(database, setKey, base);
      const room = pocketRoom(pocket, quota, printing.variant);
      const before = { setKey, base, rows };
      if (room.kind === 'full') return { ...room, before };

      const id = printingId(setKey, printing.num);
      const existing = rows.find((row) => row.id === id);
      const changed = [
        withCount(
          existing ?? emptyOwnedRow(setKey, base, printing),
          (existing?.count ?? 0) + 1,
          now,
        ),
      ];
      if (room.kind === 'upgrade') {
        const bumped = rows.find((row) => row.variant === room.replaces)!;
        changed.push({ ...bumped, bulk: (bumped.bulk ?? 0) + 1, updatedAt: now });
      }
      await database.owned.bulkPut(changed);
      return { ...room, before };
    },
  );

  if (result.kind !== 'full') notifyInventoryChanged(setKey);
  return result;
}

/** Adds one copy of `printing` straight to the bulk box, leaving the pocket as it is. */
export async function addToBulk(
  setKey: SetKey,
  base: number,
  printing: Printing,
  database: SwuDatabase = db,
  now = Date.now(),
): Promise<void> {
  await database.transaction('rw', database.owned, async () => {
    const existing = await database.owned.get(printingId(setKey, printing.num));
    const row = existing ?? emptyOwnedRow(setKey, base, printing);
    const bulk = Math.min(row.bulk ?? 0, row.count) + 1;
    await database.owned.put({ ...row, count: row.count + 1, bulk, updatedAt: now });
  });
  notifyInventoryChanged(setKey);
}

/** Removes one copy of `variant` from the pocket. Bulk and deck copies are never touched. */
export async function removeFromPocket(
  setKey: SetKey,
  base: number,
  variant: VariantSlug,
  database: SwuDatabase = db,
  now = Date.now(),
): Promise<boolean> {
  const removed = await database.transaction(
    'rw',
    database.owned,
    database.deckLibrary,
    async () => {
      const { rows, pocket } = await readPocket(database, setKey, base);
      const row = rows.find((r) => r.variant === variant);
      if (!row || !(pocket[variant] ?? 0)) return false;
      if (row.count === 1) await database.owned.delete(row.id);
      else await database.owned.put(withCount(row, row.count - 1, now));
      return true;
    },
  );

  if (removed) notifyInventoryChanged(setKey);
  return removed;
}

/**
 * Tops the pocket up to its playset with `printing`, never reducing anything. Returns how
 * many copies went in.
 */
export async function fillPocket(
  setKey: SetKey,
  base: number,
  printing: Printing,
  quota: number,
  database: SwuDatabase = db,
  now = Date.now(),
): Promise<number> {
  const added = await database.transaction('rw', database.owned, database.deckLibrary, async () => {
    const { rows, pocket } = await readPocket(database, setKey, base);
    const room = quota - Object.values(pocket).reduce((sum, n) => sum + (n ?? 0), 0);
    if (room <= 0) return 0;
    const existing = rows.find((row) => row.id === printingId(setKey, printing.num));
    await database.owned.put(
      withCount(
        existing ?? emptyOwnedRow(setKey, base, printing),
        (existing?.count ?? 0) + room,
        now,
      ),
    );
    return room;
  });

  if (added) notifyInventoryChanged(setKey);
  return added;
}

/**
 * Empties the pocket: every copy whose home is the binder and is not out in a deck. Bulk
 * copies and deck copies stay. Returns the card as it was, for undo, and how many copies
 * left.
 */
export async function clearPocket(
  setKey: SetKey,
  base: number,
  database: SwuDatabase = db,
  now = Date.now(),
): Promise<{ removed: number; before: CardSnapshot }> {
  const result = await database.transaction(
    'rw',
    database.owned,
    database.deckLibrary,
    async () => {
      const { rows, pocket } = await readPocket(database, setKey, base);
      const left: VariantCounts = { ...pocket };
      let removed = 0;
      for (const row of rows) {
        const take = Math.min(left[row.variant] ?? 0, row.count);
        if (!take) continue;
        left[row.variant] = (left[row.variant] ?? 0) - take;
        removed += take;
        if (take === row.count) await database.owned.delete(row.id);
        else await database.owned.put(withCount(row, row.count - take, now));
      }
      return { removed, before: { setKey, base, rows } };
    },
  );

  if (result.removed) notifyInventoryChanged(setKey);
  return result;
}

/** Puts a card's rows back exactly as a snapshot recorded them. */
export async function restoreCard(
  { setKey, base, rows }: CardSnapshot,
  database: SwuDatabase = db,
): Promise<void> {
  await database.transaction('rw', database.owned, async () => {
    await database.owned.where({ setKey, base }).delete();
    if (rows.length) await database.owned.bulkPut(rows);
  });
  notifyInventoryChanged(setKey);
}
