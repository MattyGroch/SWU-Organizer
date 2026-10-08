import type { VariantSlug } from '~/domain/catalog';
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
import { spillCards } from './spill';

type ScannedPrinting = { setKey: SetKey; base: number; num: string; variant: VariantSlug };

/**
 * Where an added copy belongs: its binder pocket, the bulk box (the pocket already holds
 * a playset at least as good), or the pocket in place of a weaker copy, which goes to bulk.
 */
export type QuickFate =
  | { kind: 'binder' }
  | { kind: 'bulk' }
  | { kind: 'swap'; swapOut: { num: string; variant: VariantSlug } };

/** What `quickAdd` did, so `undoQuickAdd` can put the card back as it was. */
export type QuickAdded = {
  printing: ScannedPrinting;
  fate: QuickFate;
  before: OwnedPrinting[];
  after: OwnedPrinting[];
};

const byId = (rows: readonly OwnedPrinting[]) => new Map(rows.map((r) => [r.id, r]));

/**
 * Adds one copy straight to the collection, skipping Intake, and settles its pocket the
 * way committing a batch does: the binder keeps the best `quota` copies (less those out in
 * built decks) and the weakest extra goes to the bulk box. Which copy moved says where the
 * new one goes.
 */
export async function quickAdd(
  printing: ScannedPrinting,
  quota: number,
  database: SwuDatabase = db,
  now = Date.now(),
): Promise<QuickAdded> {
  const { setKey, base } = printing;
  const result = await database.transaction(
    'rw',
    database.owned,
    database.deckLibrary,
    async () => {
      const before = await database.owned.where({ setKey, base }).toArray();
      const existing = before.find((r) => r.id === printingId(setKey, printing.num));
      const row = existing ?? emptyOwnedRow(setKey, base, printing);
      await database.owned.put(withCount(row, row.count + 1, now));
      await spillCards(database, [{ setKey, base }], () => quota, now);
      const after = await database.owned.where({ setKey, base }).toArray();
      return { before, after };
    },
  );
  notifyInventoryChanged(setKey);
  return { printing, fate: fateOf(printing, result.before, result.after), ...result };
}

/** The copy whose bulk count grew is the one for the box. */
function fateOf(
  printing: ScannedPrinting,
  before: readonly OwnedPrinting[],
  after: readonly OwnedPrinting[],
): QuickFate {
  const was = byId(before);
  const grew = after.filter((r) => (r.bulk ?? 0) > (was.get(r.id)?.bulk ?? 0));
  if (grew.some((r) => r.num === printing.num)) return { kind: 'bulk' };
  const out = grew[0];
  return out
    ? { kind: 'swap', swapOut: { num: out.num, variant: out.variant } }
    : { kind: 'binder' };
}

/**
 * Takes back a `quickAdd`. When nothing else has touched the card since, its rows go back
 * exactly as they were, swap and all. Otherwise one copy of the printing comes off, from
 * where that add put it, and nothing else moves: the later changes are left alone.
 */
export async function undoQuickAdd(
  added: QuickAdded,
  database: SwuDatabase = db,
  now = Date.now(),
): Promise<void> {
  const { setKey, base, num } = added.printing;
  await database.transaction('rw', database.owned, async () => {
    const current = await database.owned.where({ setKey, base }).toArray();
    if (sameRows(current, added.after)) {
      await database.owned.where({ setKey, base }).delete();
      await database.owned.bulkPut(added.before.map((r) => ({ ...r, updatedAt: now })));
      return;
    }
    const row = current.find((r) => r.num === num);
    if (!row) return;
    if (row.count <= 1) {
      await database.owned.delete(row.id);
      return;
    }
    const fromBulk = added.fate.kind === 'bulk' && (row.bulk ?? 0) > 0;
    const next = withCount(row, row.count - 1, now);
    await database.owned.put(fromBulk ? withBulk(next, (row.bulk ?? 0) - 1) : next);
  });
  notifyInventoryChanged(setKey);
}

function withBulk(row: OwnedPrinting, bulk: number): OwnedPrinting {
  const { bulk: _, ...rest } = row;
  return bulk > 0 ? { ...rest, bulk } : rest;
}

function sameRows(a: readonly OwnedPrinting[], b: readonly OwnedPrinting[]): boolean {
  if (a.length !== b.length) return false;
  const other = byId(b);
  return a.every((r) => {
    const o = other.get(r.id);
    return o && o.count === r.count && (o.bulk ?? 0) === (r.bulk ?? 0);
  });
}
