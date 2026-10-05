import type { CatalogCard, VariantSlug } from './catalog';
import { resolveQuota } from './inventory';

/**
 * How ownership is derived from per-printing rows.
 *
 * The binder slot and the collection are different questions. The binder physically holds
 * a playset — three copies, or one for a Leader/Base — but you may own more than that, and
 * you certainly own them in different printings. The legacy app conflated the two: it
 * stored one clamped number per card, so a 4th copy was discarded on import and a Prestige
 * was indistinguishable from a Normal.
 *
 * Here the stored truth is "how many of each printing", uncapped, and everything the UI
 * shows is derived from it.
 */

export type VariantCounts = Partial<Record<VariantSlug, number>>;

export type OwnedCounts = {
  /** Every copy you own, across all printings. */
  total: number;
  byVariant: VariantCounts;
};

export const EMPTY_OWNED: OwnedCounts = { total: 0, byVariant: {} };

/**
 * Most valuable first — the collector's ranking, the reverse of VARIANTS' order: Serialized
 * and Showcase (equal), Prestige Foil, Prestige, Promo Foil, Hyperspace Foil, Promo,
 * Hyperspace, Foil, Normal. It decides which copies a pocket keeps when it holds more
 * than its quota, and which copy a better scan bumps.
 */
export const VALUE_ORDER: readonly VariantSlug[] = [
  'prestige-serialized',
  'showcase',
  'prestige-foil',
  'prestige',
  'promo-foil',
  'hyperspace-foil',
  'promo',
  'hyperspace',
  'foil',
  'normal',
];

/**
 * The order copies leave the binder for decks: most valuable printing first. Prestige
 * Serialized is absent on purpose — it never goes into a deck, so it never leaves.
 */
export const DECK_PULL_ORDER: readonly VariantSlug[] = VALUE_ORDER.filter(
  (variant) => variant !== 'prestige-serialized',
);

const valueRank = (variant: VariantSlug) => {
  const rank = VALUE_ORDER.indexOf(variant);
  return rank < 0 ? VALUE_ORDER.length : rank;
};

/** Whether a newly scanned copy has a place in its binder pocket. */
export type PocketRoom =
  | { kind: 'room' }
  /** The pocket is full of copies at least as good: this one goes to bulk. */
  | { kind: 'full' }
  /** The pocket is full, but this copy beats its weakest: swap that one out. */
  | { kind: 'upgrade'; replaces: VariantSlug };

/**
 * A pocket holds its quota of the most valuable copies. A new copy that is no better than
 * the weakest of those has no place in the binder; a better one displaces it.
 */
export function pocketRoom(pocket: VariantCounts, quota: number, scanned: VariantSlug): PocketRoom {
  if (sumVariants(pocket) < quota) return { kind: 'room' };
  let left = quota;
  let weakest: VariantSlug | undefined;
  for (const variant of VALUE_ORDER) {
    const count = pocket[variant] ?? 0;
    if (count <= 0 || left <= 0) continue;
    weakest = variant;
    left -= Math.min(count, left);
  }
  if (!weakest) return { kind: 'full' };
  return valueRank(scanned) < valueRank(weakest)
    ? { kind: 'upgrade', replaces: weakest }
    : { kind: 'full' };
}

export function sumVariants(variants: VariantCounts): number {
  let total = 0;
  for (const n of Object.values(variants)) total += n ?? 0;
  return total;
}

export function addVariants(a: VariantCounts, b: VariantCounts): VariantCounts {
  const out: VariantCounts = { ...a };
  for (const [variant, n] of Object.entries(b) as Array<[VariantSlug, number]>) {
    out[variant] = (out[variant] ?? 0) + n;
  }
  return out;
}

/** `a − b` per printing, never below zero. */
export function subtractVariants(a: VariantCounts, b: VariantCounts): VariantCounts {
  const out: VariantCounts = { ...a };
  for (const [variant, n] of Object.entries(b) as Array<[VariantSlug, number]>) {
    out[variant] = Math.max(0, (out[variant] ?? 0) - n);
  }
  return out;
}

/**
 * Picks `count` copies out of `available`, walking `order` — by default most valuable
 * first, the way copies leave the binder for a deck. Returns what was taken, which can be
 * fewer than asked for.
 */
export function takeVariants(
  available: VariantCounts,
  count: number,
  order: readonly VariantSlug[] = DECK_PULL_ORDER,
): VariantCounts {
  const taken: VariantCounts = {};
  let remaining = count;
  for (const variant of order) {
    if (remaining <= 0) break;
    const take = Math.min(available[variant] ?? 0, remaining);
    if (take > 0) taken[variant] = take;
    remaining -= take;
  }
  return taken;
}

/** Copies a deck can take from a pocket: everything except a Prestige Serialized. */
export function pullableCount(pocket: VariantCounts): number {
  return sumVariants(pocket) - (pocket['prestige-serialized'] ?? 0);
}

/** What is physically left in a binder pocket, given the printings out in decks. */
export function pocketCounts(counts: OwnedCounts, held: VariantCounts): OwnedCounts {
  if (sumVariants(held) <= 0) return counts;
  const byVariant = subtractVariants(counts.byVariant, held);
  return { total: sumVariants(byVariant), byVariant };
}

export type CollectionStatus = 'complete' | 'partial' | 'none';

/** Copies that physically sit in the binder: the playset, capped by the card's quota. */
export function binderCount(total: number, quota: number): number {
  return Math.min(total, quota);
}

/** Copies beyond the playset — the ones that live in a spares box, not the binder. */
export function spareCount(total: number, quota: number): number {
  return Math.max(0, total - quota);
}

export function collectionStatus(count: number, quota: number): CollectionStatus {
  if (count >= quota) return 'complete';
  if (count > 0) return 'partial';
  return 'none';
}

/** Copies still needed to finish the playset. */
export function neededCount(total: number, quota: number): number {
  return Math.max(0, quota - total);
}

export function quotaForCard(card: Pick<CatalogCard, 'type' | 'maxCopies'>): number {
  return resolveQuota(card.type, card.maxCopies);
}

/**
 * Market value of what you own of one card.
 *
 * Each printing is valued at its own price, which is the point of tracking variants: the
 * legacy app priced every copy at the Normal printing's price, so a Prestige Serialized
 * counted the same as a bulk common.
 */
export function cardValue(
  counts: OwnedCounts,
  card: CatalogCard,
  prices: ReadonlyMap<string, number>,
): number {
  let value = 0;
  for (const printing of card.printings) {
    const owned = counts.byVariant[printing.variant] ?? 0;
    if (owned > 0) value += owned * (prices.get(printing.num) ?? 0);
  }
  return value;
}

export type OwnedRowLike = {
  base: number;
  variant: VariantSlug;
  count: number;
};

/** Folds per-printing rows into per-card totals for a whole set. */
export function indexOwnership(rows: readonly OwnedRowLike[]): Map<number, OwnedCounts> {
  const index = new Map<number, OwnedCounts>();

  for (const row of rows) {
    if (row.count <= 0) continue;
    const entry = index.get(row.base) ?? { total: 0, byVariant: {} };
    entry.total += row.count;
    entry.byVariant[row.variant] = (entry.byVariant[row.variant] ?? 0) + row.count;
    index.set(row.base, entry);
  }

  return index;
}

export function ownedFor(
  index: ReadonlyMap<number, OwnedCounts>,
  base: number | undefined,
): OwnedCounts {
  return (base === undefined ? undefined : index.get(base)) ?? EMPTY_OWNED;
}
