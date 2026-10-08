import type { CatalogCard, LoadedSet } from '~/domain/catalog';
import {
  NO_HOMES,
  binderCount,
  boxCounts,
  cardValue,
  collectionStatus,
  neededCount,
  ownedFor,
  pocketCounts,
  quotaForCard,
  sumVariants,
  type CollectionStatus,
  type Homes,
  type OwnedCounts,
} from '~/domain/ownership';

/**
 * Builds the single row list that both the Inventory and Missing tables project from.
 *
 * Pure, so filtering and the collection totals are testable without rendering. The legacy
 * version was three chained `useMemo`s inside App.tsx that each recomputed over every
 * card, plus a fourth for the status counts.
 */

export const ALL_ASPECTS = [
  'Vigilance',
  'Command',
  'Aggression',
  'Cunning',
  'Heroism',
  'Villainy',
  'NEUTRAL',
] as const;

export const ALL_RARITIES = ['Common', 'Uncommon', 'Rare', 'Legendary', 'Special'] as const;
export const ALL_TYPES = ['Leader', 'Base', 'Unit', 'Event', 'Upgrade'] as const;
export const ALL_STATUSES = ['complete', 'partial', 'none'] as const;

/** Shared by the Status filter chips and the table's Status column, so the two always agree. */
export const STATUS_LABEL = {
  complete: 'Complete playset',
  partial: 'In progress',
  none: 'Not collected',
} as const satisfies Record<CollectionStatus, string>;

export const STATUS_GLYPH = {
  complete: '✓',
  partial: '!',
  none: '✕',
} as const satisfies Record<CollectionStatus, string>;

export type Filters = {
  aspect: string[];
  rarity: string[];
  type: string[];
  status: CollectionStatus[];
  /** Free-text filter applied to name and subtitle. */
  text: string;
  /** Hide cards whose binder slot is short only because copies are out in built decks. */
  hideInDecks: boolean;
};

export const EMPTY_FILTERS: Filters = {
  aspect: [],
  rarity: [],
  type: [],
  status: [],
  text: '',
  hideInDecks: false,
};

export type CardRow = {
  base: number;
  name: string;
  subtitle?: string;
  type?: string;
  rarity?: string;
  unique?: boolean;
  aspects: string[];
  quota: number;
  /** Every copy owned, across printings: binder, bulk box and decks. */
  total: number;
  /** Copies in the binder pocket right now, up to the playset. */
  inBinder: number;
  /** Copies in the bulk box right now. */
  inBulk: number;
  /** Copies pulled into built decks, from the binder or the bulk box. */
  inDecks: number;
  /** Copies out in decks that the binder pocket is missing — the binder's ⇢ badge. */
  pocketInDecks: number;
  needed: number;
  status: CollectionStatus;
  counts: OwnedCounts;
  /** Value of the copies owned, each printing at its own price. */
  value: number;
  /** What the copies still needed would cost at the Normal printing's price. */
  missingCost: number;
};

function matchesFilters(card: CatalogCard, status: CollectionStatus, filters: Filters): boolean {
  if (filters.aspect.length) {
    const labels = card.aspects.length ? card.aspects : ['NEUTRAL'];
    if (!labels.some((a) => filters.aspect.includes(a))) return false;
  }
  if (filters.rarity.length && !filters.rarity.includes(card.rarity ?? '')) return false;
  if (filters.type.length && !filters.type.includes(card.type ?? '')) return false;
  if (filters.status.length && !filters.status.includes(status)) return false;

  const text = filters.text.trim().toLowerCase();
  if (text) {
    const haystack = `${card.name} ${card.subtitle ?? ''}`.toLowerCase();
    if (!haystack.includes(text)) return false;
  }

  return true;
}

export function buildCardRows(
  set: LoadedSet,
  ownership: ReadonlyMap<number, OwnedCounts>,
  filters: Filters,
  heldByBase: ReadonlyMap<number, Homes> = new Map(),
  quotaOf: (card: CatalogCard) => number = quotaForCard,
): CardRow[] {
  const rows: CardRow[] = [];

  for (const card of set.cardsByBase.values()) {
    const counts = ownedFor(ownership, card.base);
    const quota = quotaOf(card);
    // Status, like "needed", follows everything owned — a card out in a deck or in the bulk
    // box is not one to buy. The Binder column and its ⇠ badge show where the copies are.
    const held = heldByBase.get(card.base) ?? NO_HOMES;
    const inDecks = sumVariants(held.binder) + sumVariants(held.bulk);
    const inBinder = binderCount(pocketCounts(counts, held).total, quota);
    const status = collectionStatus(counts.total, quota);
    if (!matchesFilters(card, status, filters)) continue;
    if (filters.hideInDecks && inDecks > 0 && counts.total >= quota) continue;

    const normal = card.printings.find((p) => p.variant === 'normal') ?? card.printings[0];
    const unitPrice = (normal && set.prices.get(normal.num)) ?? 0;
    const needed = neededCount(counts.total, quota);

    rows.push({
      base: card.base,
      name: card.name,
      subtitle: card.subtitle,
      type: card.type,
      rarity: card.rarity,
      unique: card.unique,
      aspects: card.aspects,
      quota,
      total: counts.total,
      inBinder,
      inDecks,
      // As on the binder cell: once the pocket is full again, more out in decks are bound
      // for the bulk box when they come back, so they don't count against it.
      pocketInDecks: Math.min(sumVariants(held.binder), quota - inBinder),
      inBulk: sumVariants(boxCounts(counts, held)),
      needed,
      status,
      counts,
      value: cardValue(counts, card, set.prices),
      missingCost: needed * unitPrice,
    });
  }

  return rows.sort((a, b) => a.base - b.base);
}

export type CollectionTotals = {
  cards: number;
  complete: number;
  partial: number;
  missing: number;
  /** Value of everything owned. */
  value: number;
  /** Cost to finish every playset in the current filter. */
  missingCost: number;
  /** Copies in the bulk box. */
  inBulk: number;
};

export function collectionTotals(rows: readonly CardRow[]): CollectionTotals {
  const totals: CollectionTotals = {
    cards: rows.length,
    complete: 0,
    partial: 0,
    missing: 0,
    value: 0,
    missingCost: 0,
    inBulk: 0,
  };

  for (const row of rows) {
    if (row.status === 'complete') totals.complete += 1;
    else if (row.status === 'partial') totals.partial += 1;
    else totals.missing += 1;

    totals.value += row.value;
    totals.missingCost += row.missingCost;
    totals.inBulk += row.inBulk;
  }

  return totals;
}

export function hasActiveFilters(filters: Filters): boolean {
  return (
    filters.aspect.length > 0 ||
    filters.rarity.length > 0 ||
    filters.type.length > 0 ||
    filters.status.length > 0 ||
    filters.hideInDecks ||
    filters.text.trim() !== ''
  );
}

/** `3 Vader - Dark Lord (SOR)` — the paste format TCGplayer's mass-entry box accepts. */
export function formatMissingLine(row: CardRow, setKey: string, quantity: number): string {
  const name = row.subtitle ? `${row.name} - ${row.subtitle}` : row.name;
  return `${quantity} ${name} (${setKey})`;
}

/** What the copy buttons would put on the clipboard for these rows — shown on the buttons. */
export function missingListSummary(rows: readonly CardRow[]): { cards: number; copies: number } {
  let cards = 0;
  let copies = 0;
  for (const row of rows) {
    if (row.needed <= 0) continue;
    cards += 1;
    copies += row.needed;
  }
  return { cards, copies };
}

export function missingListText(
  rows: readonly CardRow[],
  setKey: string,
  mode: 'fullNeeded' | 'oneEach',
): string {
  return rows
    .filter((row) => row.needed > 0)
    .map((row) => formatMissingLine(row, setKey, mode === 'oneEach' ? 1 : row.needed))
    .join('\n');
}

/** How many filters are on: each chip, the text box and Hide in decks count one. */
export function activeFilterCount(filters: Filters): number {
  return (
    filters.aspect.length +
    filters.rarity.length +
    filters.type.length +
    filters.status.length +
    (filters.text.trim() ? 1 : 0) +
    (filters.hideInDecks ? 1 : 0)
  );
}
