import { cardKey, heldByHome } from '~/domain/deckBuild';
import { parseDeckLibrary, type DeckLibrary } from '~/domain/decks';
import { spillToBulk, type VariantCounts } from '~/domain/ownership';
import type { SetKey } from '~/domain/types';

import type { OwnedPrinting, SwuDatabase } from './db';

export type QuotaOf = (setKey: SetKey, base: number) => number;

export async function readLibrary(database: SwuDatabase): Promise<DeckLibrary> {
  return parseDeckLibrary((await database.deckLibrary.get('library'))?.json ?? null);
}

/** What built decks hold of a card's binder copies: out of its pocket for now. */
export function heldFromBinder(library: DeckLibrary, setKey: SetKey, base: number): VariantCounts {
  return heldByHome(library).get(cardKey(setKey, base))?.binder ?? {};
}

/**
 * Keeps only the best playset in each card's binder pocket, sending the weakest extras to
 * the bulk box — after Intake adds copies, or a deck brings its copies home to a pocket
 * that filled up while they were out. Returns how many copies moved. Call it inside a
 * transaction over `owned` and `deckLibrary`.
 */
export async function spillCards(
  database: SwuDatabase,
  cards: Iterable<{ setKey: SetKey; base: number }>,
  quotaOf: QuotaOf,
  now: number,
): Promise<number> {
  const library = await readLibrary(database);
  let moved = 0;
  for (const { setKey, base } of cards) {
    const rows = await database.owned.where({ setKey, base }).toArray();
    const held = heldFromBinder(library, setKey, base);
    const changed: OwnedPrinting[] = [];
    spillToBulk(rows, quotaOf(setKey, base), held).forEach((row, i) => {
      const n = (row.bulk ?? 0) - (rows[i]!.bulk ?? 0);
      if (!n) return;
      moved += n;
      changed.push({ ...row, updatedAt: now });
    });
    if (changed.length) await database.owned.bulkPut(changed);
  }
  return moved;
}
