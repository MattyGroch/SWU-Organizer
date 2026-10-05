import { VARIANTS, variantLabel, type LoadedSet } from '~/domain/catalog';
import type { OwnedPrinting } from '~/data/db';
import { cardKey, heldByHome, parseCardKey } from '~/domain/deckBuild';
import type { DeckLibrary } from '~/domain/decks';
import {
  NO_HOMES,
  addVariants,
  subtractVariants,
  sumVariants,
  type VariantCounts,
} from '~/domain/ownership';
import type { SetKey } from '~/domain/types';

export type BulkRow = {
  setKey: SetKey;
  base: number;
  name: string;
  subtitle?: string;
  /** Printings physically in the box. */
  inBox: VariantCounts;
  boxCount: number;
  /** Bulk-box copies out in built decks; they come back to the box. */
  inDecks: number;
};

/**
 * One row per card with copies whose home is the bulk box, in set order then card number —
 * the box is one unsorted pile, so the list is the only index it has.
 */
export function buildBulkRows(
  owned: readonly Pick<OwnedPrinting, 'setKey' | 'base' | 'variant' | 'count' | 'bulk'>[],
  library: DeckLibrary,
  sets: ReadonlyMap<SetKey, LoadedSet>,
  setOrder: readonly SetKey[],
): BulkRow[] {
  const homes = new Map<string, VariantCounts>();
  for (const row of owned) {
    const bulk = Math.min(row.bulk ?? 0, row.count);
    if (bulk <= 0) continue;
    const key = cardKey(row.setKey, row.base);
    homes.set(key, addVariants(homes.get(key) ?? {}, { [row.variant]: bulk }));
  }

  const held = heldByHome(library);
  const rows: BulkRow[] = [];
  for (const [key, bulk] of homes) {
    const { setKey, baseNumber: base } = parseCardKey(key);
    const out = (held.get(key) ?? NO_HOMES).bulk;
    const inBox = subtractVariants(bulk, out);
    const card = sets.get(setKey)?.cardsByBase.get(base);
    rows.push({
      setKey,
      base,
      name: card?.name ?? `#${base}`,
      ...(card?.subtitle && { subtitle: card.subtitle }),
      inBox,
      boxCount: sumVariants(inBox),
      inDecks: Math.min(sumVariants(out), sumVariants(bulk)),
    });
  }

  const rank = (setKey: SetKey) => {
    const i = setOrder.indexOf(setKey);
    return i < 0 ? setOrder.length : i;
  };
  return rows.sort((a, b) => rank(a.setKey) - rank(b.setKey) || a.base - b.base);
}

/** "3 Normal · 1 Hyperspace". */
export function printingsLabel(printings: VariantCounts): string {
  return VARIANTS.filter((v) => (printings[v] ?? 0) > 0)
    .map((v) => `${printings[v]} ${variantLabel(v)}`)
    .join(' · ');
}

export function matchesBulkSearch(row: BulkRow, query: string): boolean {
  const text = query.trim().toLowerCase();
  if (!text) return true;
  return `${row.name} ${row.subtitle ?? ''} ${row.setKey} ${row.base}`.toLowerCase().includes(text);
}
