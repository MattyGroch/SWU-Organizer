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
  type?: string;
  rarity?: string;
  aspects: string[];
  /** Printings physically in the box. */
  inBox: VariantCounts;
  boxCount: number;
  /** Bulk-box copies out in built decks; they come back to the box. */
  inDecks: number;
};

/**
 * One row per card with copies whose home is the bulk box, in {@link compareBulkRows}
 * order — the box is one unsorted pile, so the list is the only index it has.
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
      ...(card?.type && { type: card.type }),
      ...(card?.rarity && { rarity: card.rarity }),
      aspects: card?.aspects ?? [],
      inBox,
      boxCount: sumVariants(inBox),
      inDecks: Math.min(sumVariants(out), sumVariants(bulk)),
    });
  }

  return rows.sort(compareBulkRows(setOrder));
}

/** Vigilance / Command / Aggression / Cunning; Heroism and Villainy are affiliations. */
const PRIMARY_ASPECTS = new Set(['Vigilance', 'Command', 'Aggression', 'Cunning']);

/**
 * The bulk list's sections, in order: leaders, bases, Legendaries, Rares, Specials, then
 * Commons and Uncommons together.
 */
function section(row: BulkRow): number {
  if (row.type === 'Leader') return 0;
  if (row.type === 'Base') return 1;
  switch (row.rarity) {
    case 'Legendary':
      return 2;
    case 'Rare':
      return 3;
    case 'Special':
      return 4;
    default:
      return 5;
  }
}

/**
 * Where a leader or base sits within its set: dual-aspect cards first, then single-aspect,
 * then those with no primary aspect; alphabetical by first aspect within each.
 */
function aspectKey(row: BulkRow): [number, string] {
  const primaries = [...new Set(row.aspects.filter((a) => PRIMARY_ASPECTS.has(a)))];
  if (primaries.length >= 2) return [0, primaries[0] ?? ''];
  if (primaries.length === 1) return [1, primaries[0] ?? ''];
  return [2, row.aspects[0] ?? ''];
}

/**
 * Sections first (see {@link section}), then set in release order (oldest first). Leaders
 * and bases then sort by aspect; everything else by card number.
 */
export function compareBulkRows(setOrder: readonly SetKey[]): (a: BulkRow, b: BulkRow) => number {
  const rank = (setKey: SetKey) => {
    const i = setOrder.indexOf(setKey);
    return i < 0 ? setOrder.length : i;
  };
  return (a, b) => {
    const bySection = section(a) - section(b);
    if (bySection) return bySection;
    const bySet = rank(a.setKey) - rank(b.setKey);
    if (bySet) return bySet;
    if (section(a) <= 1) {
      const [aGroup, aAspect] = aspectKey(a);
      const [bGroup, bAspect] = aspectKey(b);
      const byAspect = aGroup - bGroup || aAspect.localeCompare(bAspect);
      if (byAspect) return byAspect;
    }
    return a.base - b.base;
  };
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
