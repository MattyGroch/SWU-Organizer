import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  parseSetCatalog,
  toLoadedSet,
  type CatalogCard,
  type LoadedSet,
  type VariantSlug,
} from '~/domain/catalog';
import { indexOwnership, type OwnedCounts } from '~/domain/ownership';

import {
  cardRates,
  estimatePackMix,
  expectedCompletion,
  hitRates,
  packsToFinish,
  poissonAtLeast,
  poolOf,
} from './packMath';
import { packProfiles } from './packProfiles';

function realSet(key: string): LoadedSet {
  const file = resolve(__dirname, `../../../public/sets/SWU-${key}.json`);
  return toLoadedSet(parseSetCatalog(JSON.parse(readFileSync(file, 'utf8'))), new Map());
}

/** `copies` of every card of the given rarities, as Normal printings (`number` for leaders/bases). */
function own(set: LoadedSet, copies: (rarity?: string, type?: string) => number) {
  const rows = [...set.cardsByBase.values()].map((card) => ({
    base: card.base,
    variant: 'normal' as const,
    count: copies(card.rarity, card.type),
  }));
  return indexOwnership(rows);
}

describe('poissonAtLeast', () => {
  it('matches the closed forms', () => {
    expect(poissonAtLeast(2, 0)).toBe(1);
    expect(poissonAtLeast(2, 1)).toBeCloseTo(1 - Math.exp(-2));
    expect(poissonAtLeast(2, 3)).toBeCloseTo(1 - Math.exp(-2) * (1 + 2 + 2));
  });
});

describe('poolOf', () => {
  it('sorts leaders, bases and the rest by rarity, and leaves Specials out', () => {
    expect(poolOf({ type: 'Leader', rarity: 'Rare' })).toBe('leaderRare');
    expect(poolOf({ type: 'Leader', rarity: 'Special' })).toBeUndefined();
    expect(poolOf({ type: 'Base', rarity: 'Rare' })).toBe('rare');
    expect(poolOf({ type: 'Unit', rarity: 'Legendary' })).toBe('legendary');
    expect(poolOf({ type: 'Event', rarity: 'Special' })).toBeUndefined();
  });
});

describe('pack maths on Spark of Rebellion', () => {
  const set = realSet('SOR');
  const booster = packProfiles('SOR')!.booster;
  const none = new Map<number, OwnedCounts>();

  it('has no carbonite, and later sets do', () => {
    expect(packProfiles('SOR')!.carbonite).toBeUndefined();
    expect(packProfiles('JTL')!.carbonite).toBeDefined();
    expect(packProfiles('TS26')).toBeUndefined();
  });

  it('expects one Legendary in about eight packs, spread over sixteen', () => {
    const rates = cardRates(set, booster, none);
    const legendaries = rates.filter((r) => r.pool === 'legendary');
    expect(legendaries).toHaveLength(16);
    const perPack = legendaries.reduce((s, r) => s + r.rate, 0);
    expect(perPack).toBeGreaterThan(1 / 8);
    expect(perPack).toBeLessThan(1 / 6);
  });

  it('counts boosters from foils and Hyperspace, not plain copies or promos', () => {
    // A playset of every plain common and uncommon could be singles: it says nothing.
    const playsets = own(set, (rarity, type) =>
      type !== 'Leader' && type !== 'Base' && (rarity === 'Common' || rarity === 'Uncommon')
        ? 3
        : 0,
    );
    expect(estimatePackMix(set, packProfiles('SOR')!, playsets)).toBeUndefined();

    const promoOnly = indexOwnership([{ base: 5, variant: 'promo', count: 10 }]);
    expect(estimatePackMix(set, packProfiles('SOR')!, promoOnly)).toBeUndefined();

    // Fifty boosters' worth of foil and Hyperspace commons and uncommons.
    const low = [...set.cardsByBase.values()].filter((card) => {
      const pool = poolOf(card);
      return pool === 'common' || pool === 'uncommon';
    });
    const copies = (variant: VariantSlug, n: number) =>
      Array.from({ length: n }, (_, i) => ({ base: low[i % low.length]!.base, variant, count: 1 }));
    const opened = indexOwnership([
      ...copies('foil', 37),
      ...copies('hyperspace', 21),
      ...copies('hyperspace-foil', 8),
    ]);
    const mix = estimatePackMix(set, packProfiles('SOR')!, opened)!;
    expect(mix.carbonite).toBe(0);
    expect(mix.boosters).toBeCloseTo(50, -1);
  });

  it('fills commons long before legendaries', () => {
    const rates = cardRates(set, booster, none);
    const commons = rates.filter((r) => r.pool === 'common');
    expect(expectedCompletion(commons, 100)).toBeGreaterThan(0.9);
    expect(expectedCompletion(rates, 100)).toBeLessThan(0.8);
  });

  it('needs hundreds of packs from scratch, and none once complete', () => {
    const fromScratch = packsToFinish(cardRates(set, booster, none));
    expect(fromScratch.expected).toBeGreaterThan(300);
    expect(fromScratch.median).toBeLessThanOrEqual(fromScratch.likely);

    const everything = own(set, () => 3);
    expect(packsToFinish(cardRates(set, booster, everything))).toEqual({
      needed: 0,
      expected: 0,
      median: 0,
      likely: 0,
    });
  });

  it('counts hits by printing and rarity', () => {
    const owned = indexOwnership([
      // Two Hyperspace copies of a common base.
      { base: 21, variant: 'hyperspace', count: 2 },
    ]);
    const hits = hitRates(set, packProfiles('SOR')!, owned);
    expect(hits.find((h) => h.label === 'Hyperspace')!.owned).toBe(2);
    expect(hits.find((h) => h.label === 'Legendary')!.owned).toBe(0);
  });
});

describe('telling boosters from Carbonite', () => {
  /** Spreads `n` copies of one printing over the cards that have it, round-robin. */
  function spread(
    set: LoadedSet,
    variant: VariantSlug,
    n: number,
    pick: (card: CatalogCard) => boolean,
  ) {
    const cards = [...set.cardsByBase.values()].filter(
      (card) => pick(card) && card.printings.some((p) => p.variant === variant),
    );
    return Array.from({ length: Math.round(n) }, (_, i) => ({
      base: cards[i % cards.length]!.base,
      variant,
      count: 1,
    }));
  }

  it('reads 33 boosters and 12 Carbonite packs back out of Homeworlds', () => {
    const set = realSet('HMW');
    const lowCard = (card: CatalogCard) => {
      const pool = poolOf(card);
      return pool === 'common' || pool === 'uncommon';
    };
    const [boosters, carbonite] = [33, 12];
    const owned = indexOwnership([
      ...spread(set, 'normal', boosters * 10.8, lowCard),
      ...spread(set, 'hyperspace', boosters * 1.2 + carbonite * 6.86, lowCard),
      ...spread(set, 'hyperspace-foil', boosters * 0.95 + carbonite * 5.14, lowCard),
      ...spread(set, 'prestige', boosters / 18 + carbonite, () => true),
    ]);
    const mix = estimatePackMix(set, packProfiles('HMW')!, owned)!;
    // Within a few packs: the 14 Prestige weigh a lot, and whole cards round them.
    expect(Math.abs(mix.boosters - 33)).toBeLessThan(3);
    expect(Math.abs(mix.carbonite - 12)).toBeLessThan(1.5);

    const hsFoil = hitRates(set, packProfiles('HMW')!, owned, mix).find(
      (h) => h.label === 'Hyperspace Foil',
    )!;
    expect(hsFoil.expected).toBeCloseTo(33 + 12 * 6, -1);
  });

  it('never fits a negative count', () => {
    // Hyperspace Foils and no Prestige at all: boosters only, not negative Carbonite.
    const set = realSet('HMW');
    const owned = indexOwnership(
      spread(set, 'hyperspace-foil', 30, (card) => poolOf(card) === 'common'),
    );
    const mix = estimatePackMix(set, packProfiles('HMW')!, owned)!;
    expect(mix.carbonite).toBeGreaterThanOrEqual(0);
    expect(mix.boosters).toBeGreaterThanOrEqual(0);
    expect(mix.boosters + mix.carbonite).toBeGreaterThan(0);
  });
});
