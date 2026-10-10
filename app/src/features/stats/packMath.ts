import type { CatalogCard, LoadedSet, VariantSlug } from '~/domain/catalog';
import { ownedFor, quotaForCard, type OwnedCounts } from '~/domain/ownership';

import type { PackProfile, PackPool } from './packProfiles';

/**
 * Pack arithmetic for the Stats page: how many packs a collection looks like, how lucky
 * it has been, and roughly how many more it would take to finish the playsets.
 *
 * The model is deliberately simple. A pack is a list of expected cards per pool (commons,
 * uncommons, rare leaders…), and every card in a pool is equally likely, so a card's rate
 * is its pool's cards-per-pack over the pool's size. Copies then arrive as a Poisson
 * process, one per card, independent of the others — close enough for "about how many".
 */

/** Promos come from events, not packs: they never count toward pack estimates. */
const PACK_VARIANTS = (variant: VariantSlug) => variant !== 'promo' && variant !== 'promo-foil';

/** Which pool a card is pulled from, or none for cards packs don't carry (Specials). */
export function poolOf(card: Pick<CatalogCard, 'type' | 'rarity'>): PackPool | undefined {
  const rare = card.rarity === 'Rare' || card.rarity === 'Legendary';
  if (card.type === 'Leader') {
    if (card.rarity === 'Common') return 'leaderCommon';
    return rare ? 'leaderRare' : undefined;
  }
  if (card.type === 'Base') {
    if (card.rarity === 'Common') return 'baseCommon';
    // Rare bases come in the rare slot, alongside the set's other Rares.
    return card.rarity === 'Rare' ? 'rare' : undefined;
  }
  switch (card.rarity) {
    case 'Common':
      return 'common';
    case 'Uncommon':
      return 'uncommon';
    case 'Rare':
      return 'rare';
    case 'Legendary':
      return 'legendary';
    default:
      return undefined;
  }
}

/** Copies of a card that could have come out of a pack. */
export function packCopies(counts: OwnedCounts): number {
  let n = 0;
  for (const [variant, count] of Object.entries(counts.byVariant) as Array<[VariantSlug, number]>) {
    if (PACK_VARIANTS(variant)) n += count;
  }
  return n;
}

type CardRate = { card: CatalogCard; pool: PackPool; rate: number; quota: number; owned: number };

/** Every pack card in the set with its expected copies per pack. */
export function cardRates(
  set: LoadedSet,
  profile: PackProfile,
  owned: ReadonlyMap<number, OwnedCounts>,
): CardRate[] {
  const pools = new Map<PackPool, CatalogCard[]>();
  for (const card of set.cardsByBase.values()) {
    const pool = poolOf(card);
    if (!pool) continue;
    pools.set(pool, [...(pools.get(pool) ?? []), card]);
  }
  const rates: CardRate[] = [];
  for (const [pool, cards] of pools) {
    const perPack = profile.pools[pool] ?? 0;
    if (perPack <= 0) continue;
    for (const card of cards) {
      rates.push({
        card,
        pool,
        rate: perPack / cards.length,
        quota: quotaForCard(card),
        owned: ownedFor(owned, card.base).total,
      });
    }
  }
  return rates;
}

/** P(X ≥ k) for X ~ Poisson(mean). */
export function poissonAtLeast(mean: number, k: number): number {
  if (k <= 0) return 1;
  let term = Math.exp(-mean);
  let below = term;
  for (let i = 1; i < k; i++) {
    term *= mean / i;
    below += term;
  }
  return Math.max(0, 1 - below);
}

/**
 * About how many packs the collection represents, from the commons and uncommons: they
 * are the bulk of every pack and the cards nobody buys as singles, so they say most about
 * packs opened. Undefined when there are none to go on.
 */
export function estimatePacksOpened(
  set: LoadedSet,
  profile: PackProfile,
  owned: ReadonlyMap<number, OwnedCounts>,
): number | undefined {
  const perPack = (profile.pools.common ?? 0) + (profile.pools.uncommon ?? 0);
  if (perPack <= 0) return undefined;
  let copies = 0;
  for (const card of set.cardsByBase.values()) {
    const pool = poolOf(card);
    if (pool !== 'common' && pool !== 'uncommon') continue;
    copies += packCopies(ownedFor(owned, card.base));
  }
  return copies > 0 ? copies / perPack : undefined;
}

/** Expected share of pack cards with a full playset after `packs` packs, from nothing. */
export function expectedCompletion(rates: readonly CardRate[], packs: number): number {
  if (!rates.length) return 0;
  const sum = rates.reduce((s, r) => s + poissonAtLeast(r.rate * packs, r.quota), 0);
  return sum / rates.length;
}

export type PacksToFinish = {
  /** Copies still needed across the set's pack cards. */
  needed: number;
  /** Mean packs until every playset is full. */
  expected: number;
  /** Packs by which you'd be done half the time, and nine times in ten. */
  median: number;
  likely: number;
};

/**
 * More packs until every pack card's playset is full, counting the copies already owned.
 * The slowest card dominates — usually a Legendary — which is the whole point of the
 * comparison with buying singles.
 */
export function packsToFinish(rates: readonly CardRate[], cap = 100_000): PacksToFinish {
  const short = rates.filter((r) => r.owned < r.quota);
  const needed = short.reduce((s, r) => s + (r.quota - r.owned), 0);
  if (!short.length) return { needed: 0, expected: 0, median: 0, likely: 0 };

  const done = (packs: number) =>
    short.reduce((p, r) => p * poissonAtLeast(r.rate * packs, r.quota - r.owned), 1);

  // E[N] = Σ P(N > n). Steps grow with n so a slow set stays cheap; the tail is smooth.
  let expected = 0;
  let median: number | undefined;
  let likely: number | undefined;
  let n = 0;
  while (n < cap) {
    const step = Math.max(1, Math.floor(n / 200));
    const p = done(n);
    if (median === undefined && p >= 0.5) median = n;
    if (likely === undefined && p >= 0.9) likely = n;
    if (p >= 0.9999) break;
    expected += (1 - p) * step;
    n += step;
  }
  return { needed, expected, median: median ?? cap, likely: likely ?? cap };
}

export type HitRate = {
  label: string;
  /** Copies of these printings you own (pack printings only). */
  owned: number;
  /** Expected per pack, from the profile. */
  perPack: number;
};

/** Owned copies of each tracked kind of hit, beside how often a pack holds one. */
export function hitRates(
  set: LoadedSet,
  profile: PackProfile,
  owned: ReadonlyMap<number, OwnedCounts>,
): HitRate[] {
  return profile.hits.map((hit) => {
    let count = 0;
    for (const card of set.cardsByBase.values()) {
      if (hit.rarities && !hit.rarities.includes(card.rarity ?? '')) continue;
      const counts = ownedFor(owned, card.base);
      for (const variant of hit.variants) count += counts.byVariant[variant] ?? 0;
    }
    return { label: hit.label, owned: count, perPack: hit.perPack };
  });
}
