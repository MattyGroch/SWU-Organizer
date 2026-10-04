import type { VariantSlug } from '~/domain/catalog';

/**
 * SW-Unlimited export column headers → the printing variant they describe.
 *
 * This mapping is the whole point of Phase 3. The legacy importer knew these exact column
 * names (`App.tsx:542-554`) and then summed every one of them into a single number:
 *
 *     for (const h of ALT_HEADERS) { ... totalCount += n }
 *
 * So an export recording 3 Normal, 1 Foil and 1 Hyperspace Foil became "5 copies", the
 * finish information was discarded, and the total was then clamped to the playset quota
 * on the way into storage. The variant data the user wants back was already in the file.
 */
const COLUMN_TO_VARIANT: Array<[string, VariantSlug]> = [
  ['normal', 'normal'],
  ['standard', 'normal'],
  ['foil', 'foil'],
  ['standardfoil', 'foil'],
  ['hyperspace', 'hyperspace'],
  ['foil&hyperspace', 'hyperspace-foil'],
  ['foilhyperspace', 'hyperspace-foil'],
  ['hyperspacefoil', 'hyperspace-foil'],
  ['showcase', 'showcase'],
  ['standardprestige', 'prestige'],
  ['prestige', 'prestige'],
  ['foilprestige', 'prestige-foil'],
  ['prestigefoil', 'prestige-foil'],
  ['serializedprestige', 'prestige-serialized'],
  ['prestigeserialized', 'prestige-serialized'],
  ['serialized', 'prestige-serialized'],
];

/**
 * Columns that record real cards but not a distinguishable printing in the catalog
 * (promos, event giveaways). They are counted as ordinary copies rather than dropped —
 * losing a card you own is worse than recording its finish imprecisely.
 */
const PROMO_COLUMNS = new Set([
  'organizedplay',
  'organizedplayfoil',
  'eventexclusive',
  'prereleasepromo',
  'promo',
]);

export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[\s_\-.]+/g, '');
}

const LOOKUP = new Map(COLUMN_TO_VARIANT);

export type ColumnMeaning =
  { kind: 'variant'; variant: VariantSlug } | { kind: 'promo' } | { kind: 'other' };

export function columnMeaning(header: string): ColumnMeaning {
  const key = normalizeHeader(header);
  const variant = LOOKUP.get(key);
  if (variant) return { kind: 'variant', variant };
  if (PROMO_COLUMNS.has(key)) return { kind: 'promo' };
  return { kind: 'other' };
}

/** True if any header in the row names a printing variant we understand. */
export function hasVariantColumns(headers: readonly string[]): boolean {
  return headers.some((h) => columnMeaning(h).kind === 'variant');
}
