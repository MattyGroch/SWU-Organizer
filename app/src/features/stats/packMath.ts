import type { CatalogCard, LoadedSet } from '~/domain/catalog';
import { ownedFor, quotaForCard, type OwnedCounts } from '~/domain/ownership';

import {
  SIGNAL_VARIANTS,
  type PackPool,
  type PackProfile,
  type PackSignal,
  type SetPackProfiles,
} from './packProfiles';

/**
 * Pack arithmetic for the Stats page: how many packs a collection looks like, how lucky
 * it has been, and roughly how many more it would take to finish the playsets.
 *
 * The model is deliberately simple. A pack is a list of expected cards per pool (commons,
 * uncommons, rare leaders…), and every card in a pool is equally likely, so a card's rate
 * is its pool's cards-per-pack over the pool's size. Copies then arrive as a Poisson
 * process, one per card, independent of the others — close enough for "about how many".
 */

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

export type CardRate = {
  card: CatalogCard;
  pool: PackPool;
  rate: number;
  quota: number;
  owned: number;
};

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

export type PackMix = { boosters: number; carbonite: number };

/**
 * About how many boosters and Carbonite packs the collection represents.
 *
 * Each kind of pack leaves its own mix of printings — a booster's Commons and Uncommons
 * are nearly all plain, a Carbonite pack's all foil or Hyperspace, and every Carbonite
 * pack has a Prestige. So the copies of each special printing are fitted as a blend of
 * the two, by least squares weighted for counting noise (each count's variance is about
 * its mean, so the fit is re-weighted by the counts it predicts a few times over). Sets
 * without Carbonite fit boosters alone.
 *
 * Plain copies are left out. Extras past a playset get thrown away, and singles bought
 * to finish a playset are plain, so a set's plain Commons say "a playset's worth" and
 * nothing about packs. A fit that trusted them saw too few boosters and made up the
 * difference in Carbonite. Foil, Hyperspace and Prestige copies come out of packs and
 * get kept. Undefined when there's nothing to go on.
 */
export function estimatePackMix(
  set: LoadedSet,
  profiles: SetPackProfiles,
  owned: ReadonlyMap<number, OwnedCounts>,
): PackMix | undefined {
  const observed = signalCounts(set, owned);
  const fitted = (Object.keys(SIGNAL_VARIANTS) as PackSignal[]).filter(
    (signal) => signal !== 'normal',
  );
  if (fitted.every((signal) => observed[signal] === 0)) return undefined;

  const a = profiles.booster.signature;
  const c = profiles.carbonite?.signature;
  const weight = (signal: PackSignal, mix?: PackMix) =>
    1 /
    Math.max(
      mix ? a[signal] * mix.boosters + (c?.[signal] ?? 0) * mix.carbonite : observed[signal],
      1,
    );

  let boosters = 0;
  let carbonite = 0;
  for (let round = 0; round < 6; round++) {
    // Neyman weights to start (from what's seen), then Pearson (from what's predicted).
    const mix = round === 0 ? undefined : { boosters, carbonite };
    let aa = 0;
    let ac = 0;
    let cc = 0;
    let ao = 0;
    let co = 0;
    for (const signal of fitted) {
      const w = weight(signal, mix);
      const ai = a[signal];
      const ci = c?.[signal] ?? 0;
      const o = observed[signal];
      aa += w * ai * ai;
      ac += w * ai * ci;
      cc += w * ci * ci;
      ao += w * ai * o;
      co += w * ci * o;
    }
    const det = aa * cc - ac * ac;
    if (c && det > 1e-12) {
      boosters = (ao * cc - co * ac) / det;
      carbonite = (co * aa - ao * ac) / det;
    } else {
      boosters = aa > 0 ? ao / aa : 0;
      carbonite = 0;
    }
    // Neither count can be negative: pin one at zero and fit the other alone.
    if (carbonite < 0) {
      carbonite = 0;
      boosters = aa > 0 ? ao / aa : 0;
    } else if (boosters < 0) {
      boosters = 0;
      carbonite = cc > 0 ? co / cc : 0;
    }
  }

  return { boosters, carbonite };
}

/**
 * Whether a set's Commons and Uncommons look trimmed to playsets — most of them at
 * exactly a playset and hardly any past it — the way a binder looks before its bulk box
 * is entered (or after the extras went). The extras would have held foils and Hyperspace
 * too, so pack counts read from such a set are a floor.
 */
export function looksTrimmed(set: LoadedSet, owned: ReadonlyMap<number, OwnedCounts>): boolean {
  let cards = 0;
  let atLeast = 0;
  let over = 0;
  for (const card of set.cardsByBase.values()) {
    const pool = poolOf(card);
    if (pool !== 'common' && pool !== 'uncommon') continue;
    const quota = quotaForCard(card);
    const total = ownedFor(owned, card.base).total;
    cards += 1;
    if (total >= quota) atLeast += 1;
    if (total > quota) over += 1;
  }
  return cards > 0 && atLeast / cards >= 0.5 && over / cards < 0.15;
}

/** Owned copies of each printing signal: Commons and Uncommons, and every Prestige. */
export function signalCounts(
  set: LoadedSet,
  owned: ReadonlyMap<number, OwnedCounts>,
): Record<PackSignal, number> {
  const counts: Record<PackSignal, number> = {
    normal: 0,
    foil: 0,
    hyperspace: 0,
    hyperspaceFoil: 0,
    prestige: 0,
  };
  for (const card of set.cardsByBase.values()) {
    const byVariant = ownedFor(owned, card.base).byVariant;
    const pool = poolOf(card);
    const low = pool === 'common' || pool === 'uncommon';
    for (const signal of Object.keys(counts) as PackSignal[]) {
      if (signal !== 'prestige' && !low) continue;
      for (const variant of SIGNAL_VARIANTS[signal]) counts[signal] += byVariant[variant] ?? 0;
    }
  }
  return counts;
}

/**
 * Each pack card's expected copies from a mix of packs: the booster and Carbonite rates,
 * weighted by how many of each. `quota` and `owned` as `cardRates` gives them.
 */
export function mixedRates(
  set: LoadedSet,
  profiles: SetPackProfiles,
  owned: ReadonlyMap<number, OwnedCounts>,
  mix: PackMix,
): CardRate[] {
  const byBase = new Map<number, CardRate>();
  const add = (profile: PackProfile | undefined, packs: number) => {
    if (!profile || packs <= 0) return;
    for (const r of cardRates(set, profile, owned)) {
      const prior = byBase.get(r.card.base);
      byBase.set(r.card.base, { ...r, rate: (prior?.rate ?? 0) + r.rate * packs });
    }
  };
  add(profiles.booster, mix.boosters);
  add(profiles.carbonite, mix.carbonite);
  return [...byBase.values()];
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
  /** Copies of these printings you own. */
  owned: number;
  /** Expected copies from the packs in `mix`; undefined without one. */
  expected?: number;
  /** Per booster and per Carbonite pack, from FFG's odds. */
  booster: number;
  carbonite: number;
};

/** Owned copies of each tracked kind of hit, beside what that mix of packs should give. */
export function hitRates(
  set: LoadedSet,
  profiles: SetPackProfiles,
  owned: ReadonlyMap<number, OwnedCounts>,
  mix?: PackMix,
): HitRate[] {
  return profiles.hits.map((hit) => {
    let count = 0;
    for (const card of set.cardsByBase.values()) {
      if (hit.rarities && (card.type === 'Leader' || !hit.rarities.includes(card.rarity ?? '')))
        continue;
      const counts = ownedFor(owned, card.base);
      for (const variant of hit.variants) count += counts.byVariant[variant] ?? 0;
    }
    return {
      label: hit.label,
      owned: count,
      expected: mix && mix.boosters * hit.booster + mix.carbonite * hit.carbonite,
      booster: hit.booster,
      carbonite: hit.carbonite,
    };
  });
}
