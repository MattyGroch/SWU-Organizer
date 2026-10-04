import { db, type SwuDatabase } from '~/data/db';
import { readSetOwnership } from '~/data/inventory';
import type { LoadedSet } from '~/domain/catalog';
import { heldVariants, parseCardKey } from '~/domain/deckBuild';
import type { DeckLibrary } from '~/domain/decks';
import type { VariantCounts } from '~/domain/ownership';
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
  database: SwuDatabase = db,
): Promise<SetRows[]> {
  const result: SetRows[] = [];
  for (const set of sets) {
    const ownership = await readSetOwnership(set.setKey, database);
    const owned = (setKey: string, base: number) =>
      setKey === set.setKey ? (ownership.get(base)?.byVariant ?? {}) : {};
    const held = new Map<number, VariantCounts>();
    for (const [key, variants] of heldVariants(library, owned)) {
      const { setKey, baseNumber } = parseCardKey(key);
      if (setKey === set.setKey) held.set(baseNumber, variants);
    }
    const rows = buildCardRows(set, ownership, filters, held);
    if (rows.length) result.push({ set, rows });
  }
  return result;
}
