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

/**
 * Sync payloads and backups write a printing's bulk copies under their own key, "059@bulk"
 * beside "059", so the existing `{ key: count }` format carries them with no server change.
 */
export const BULK_KEY_SUFFIX = '@bulk';

export type VariantCounts = Partial<Record<VariantSlug, number>>;

export type OwnedCounts = {
  /** Every copy you own, across all printings: binder, bulk box and decks alike. */
  total: number;
  byVariant: VariantCounts;
  /** The part of `byVariant` whose home is the bulk box. Absent when none is. */
  bulkByVariant?: VariantCounts;
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

/** The least valuable printing present, if any: what a bare minus takes from a pocket. */
export function weakestVariant(variants: VariantCounts): VariantSlug | undefined {
  return [...VALUE_ORDER].reverse().find((variant) => (variants[variant] ?? 0) > 0);
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

/** Where a card's copies live, per printing: its binder pocket or the bulk box. */
export type Homes = { binder: VariantCounts; bulk: VariantCounts };

export const NO_HOMES: Homes = { binder: {}, bulk: {} };

export function homesOf(counts: OwnedCounts): Homes {
  const bulk = counts.bulkByVariant ?? {};
  return { binder: subtractVariants(counts.byVariant, bulk), bulk };
}

export function addHomes(a: Homes, b: Homes): Homes {
  return { binder: addVariants(a.binder, b.binder), bulk: addVariants(a.bulk, b.bulk) };
}

/** `a − b` per home and printing, never below zero. */
export function subtractHomes(a: Homes, b: Homes): Homes {
  return {
    binder: subtractVariants(a.binder, b.binder),
    bulk: subtractVariants(a.bulk, b.bulk),
  };
}

/**
 * What is physically in a card's binder pocket: copies whose home is the binder, less
 * those out in decks.
 */
export function pocketCounts(counts: OwnedCounts, held: Homes): OwnedCounts {
  const byVariant = subtractVariants(homesOf(counts).binder, held.binder);
  return { total: sumVariants(byVariant), byVariant };
}

/** What is physically in the bulk box of a card: its bulk copies, less those out in decks. */
export function boxCounts(counts: OwnedCounts, held: Homes): VariantCounts {
  return subtractVariants(counts.bulkByVariant ?? {}, held.bulk);
}

/**
 * One card's printings after its binder pocket keeps only the best `quota` copies: the
 * weakest copies beyond that move to the bulk box. Copies only ever move this way — the
 * bulk box never refills the binder. Rows come back in the order given.
 *
 * `held` is what built decks hold of the binder's copies. Those are out of the pocket, so
 * they neither count toward the quota nor move.
 */
export function spillToBulk<T extends OwnedRowLike>(
  rows: readonly T[],
  quota: number,
  held: VariantCounts = {},
): T[] {
  const inBulk = (row: T) => Math.min(row.bulk ?? 0, row.count);
  const heldLeft: VariantCounts = { ...held };
  const inPocket = new Map<T, number>();
  for (const row of rows) {
    const home = row.count - inBulk(row);
    const out = Math.min(heldLeft[row.variant] ?? 0, home);
    heldLeft[row.variant] = (heldLeft[row.variant] ?? 0) - out;
    inPocket.set(row, home - out);
  }

  let extra = [...inPocket.values()].reduce((sum, n) => sum + n, 0) - quota;
  const spilled = new Map<T, number>();
  for (const row of [...rows].sort((a, b) => valueRank(b.variant) - valueRank(a.variant))) {
    if (extra <= 0) break;
    const move = Math.min(inPocket.get(row)!, extra);
    if (move > 0) spilled.set(row, inBulk(row) + move);
    extra -= move;
  }
  return rows.map((row) => (spilled.has(row) ? { ...row, bulk: spilled.get(row) } : row));
}

/**
 * What `spillToBulk` would send to the bulk box for one card, per printing, given where its
 * copies live and what decks hold of its binder copies.
 */
export function pocketSpill(homes: Homes, held: VariantCounts, quota: number): VariantCounts {
  const variants = Object.keys(addVariants(homes.binder, homes.bulk)) as VariantSlug[];
  const rows = variants.map((variant) => {
    const bulk = homes.bulk[variant] ?? 0;
    return { base: 0, variant, count: (homes.binder[variant] ?? 0) + bulk, bulk };
  });
  const moved: VariantCounts = {};
  spillToBulk(rows, quota, held).forEach((row, i) => {
    const n = (row.bulk ?? 0) - rows[i]!.bulk;
    if (n > 0) moved[row.variant] = n;
  });
  return moved;
}

export type CollectionStatus = 'complete' | 'partial' | 'none';

/** Copies that physically sit in the binder: the playset, capped by the card's quota. */
export function binderCount(total: number, quota: number): number {
  return Math.min(total, quota);
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
  bulk?: number;
};

/** Folds per-printing rows into per-card totals for a whole set. */
export function indexOwnership(rows: readonly OwnedRowLike[]): Map<number, OwnedCounts> {
  const index = new Map<number, OwnedCounts>();

  for (const row of rows) {
    if (row.count <= 0) continue;
    const entry = index.get(row.base) ?? { total: 0, byVariant: {} };
    entry.total += row.count;
    entry.byVariant[row.variant] = (entry.byVariant[row.variant] ?? 0) + row.count;
    const bulk = Math.min(row.bulk ?? 0, row.count);
    if (bulk > 0) {
      entry.bulkByVariant ??= {};
      entry.bulkByVariant[row.variant] = (entry.bulkByVariant[row.variant] ?? 0) + bulk;
    }
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
