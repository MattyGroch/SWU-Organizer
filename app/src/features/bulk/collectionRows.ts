import { db, type SwuDatabase } from '~/data/db';
import { readSetOwnership } from '~/data/inventory';
import type { CatalogCard, LoadedSet } from '~/domain/catalog';
import { heldInSet } from '~/domain/deckBuild';
import type { DeckLibrary } from '~/domain/decks';
import { buildCardRows, type CardRow, type Filters } from '~/features/binder/cardRows';

export type SetRows = { set: LoadedSet; rows: CardRow[] };

/**
 * The binder table's rows for many sets at once, under one set of filters — what a
 * whole-collection bulk edit acts on. Built exactly like the table's own rows, so "Fill
 * every Legendary" here means the same cards it means on any one binder page.
 */
export async function collectionRows(
  sets: readonly LoadedSet[],
  filters: Filters,
  library: DeckLibrary,
  quotaOf: (card: CatalogCard) => number,
  database: SwuDatabase = db,
): Promise<SetRows[]> {
  const result: SetRows[] = [];
  for (const set of sets) {
    const ownership = await readSetOwnership(set.setKey, database);
    const rows = buildCardRows(set, ownership, filters, heldInSet(library, set.setKey), quotaOf);
    if (rows.length) result.push({ set, rows });
  }
  return result;
}
