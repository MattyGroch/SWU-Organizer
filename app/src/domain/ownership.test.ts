import { describe, expect, it } from 'vitest';

import type { CatalogCard } from './catalog';
import {
  binderCount,
  cardValue,
  collectionStatus,
  indexOwnership,
  neededCount,
  ownedFor,
  quotaForCard,
  spareCount,
  pocketCounts,
  takeVariants,
} from './ownership';

const droid: CatalogCard = {
  base: 59,
  name: '2-1B Surgical Droid',
  type: 'Unit',
  aspects: ['Vigilance'],
  printings: [
    { num: '059', variant: 'normal' },
    { num: '059F', variant: 'foil' },
    { num: '324', variant: 'hyperspace' },
    { num: '324F', variant: 'hyperspace-foil' },
  ],
};

describe('quotaForCard', () => {
  it('gives units a playset of three and leaders/bases one', () => {
    expect(quotaForCard({ type: 'Unit' })).toBe(3);
    expect(quotaForCard({ type: 'Event' })).toBe(3);
    expect(quotaForCard({ type: 'Leader' })).toBe(1);
    expect(quotaForCard({ type: 'Base' })).toBe(1);
  });

  it('honours a per-card override', () => {
    // Swarming Vulture Droid allows 15.
    expect(quotaForCard({ type: 'Unit', maxCopies: 15 })).toBe(15);
  });
});

describe('binder vs collection', () => {
  it('caps the binder at the playset while keeping the extras as spares', () => {
    expect(binderCount(5, 3)).toBe(3);
    expect(spareCount(5, 3)).toBe(2);
  });

  it('has no spares below the quota', () => {
    expect(binderCount(2, 3)).toBe(2);
    expect(spareCount(2, 3)).toBe(0);
  });

  it('reports what is still needed to finish a playset', () => {
    expect(neededCount(0, 3)).toBe(3);
    expect(neededCount(2, 3)).toBe(1);
    // Owning spares never reports a negative need.
    expect(neededCount(5, 3)).toBe(0);
  });

  it('classifies collection status', () => {
    expect(collectionStatus(0, 3)).toBe('none');
    expect(collectionStatus(1, 3)).toBe('partial');
    expect(collectionStatus(3, 3)).toBe('complete');
    expect(collectionStatus(4, 3)).toBe('complete');
  });
});

describe('indexOwnership', () => {
  it('sums printings of the same card into one total', () => {
    const index = indexOwnership([
      { base: 59, variant: 'normal', count: 2 },
      { base: 59, variant: 'hyperspace', count: 1 },
      { base: 1, variant: 'normal', count: 1 },
    ]);

    expect(index.get(59)).toEqual({ total: 3, byVariant: { normal: 2, hyperspace: 1 } });
    expect(index.get(1)).toEqual({ total: 1, byVariant: { normal: 1 } });
  });

  it('keeps totals above the quota rather than clamping', () => {
    const index = indexOwnership([
      { base: 59, variant: 'normal', count: 3 },
      { base: 59, variant: 'foil', count: 2 },
    ]);
    expect(index.get(59)!.total).toBe(5);
    expect(binderCount(index.get(59)!.total, 3)).toBe(3);
    expect(spareCount(index.get(59)!.total, 3)).toBe(2);
  });

  it('ignores non-positive rows', () => {
    expect(indexOwnership([{ base: 59, variant: 'normal', count: 0 }]).size).toBe(0);
  });

  it('returns an empty record for cards you own none of', () => {
    const index = indexOwnership([]);
    expect(ownedFor(index, 59)).toEqual({ total: 0, byVariant: {} });
    expect(ownedFor(index, undefined)).toEqual({ total: 0, byVariant: {} });
  });
});

describe('cardValue', () => {
  const prices = new Map([
    ['059', 0.05],
    ['059F', 0.4],
    ['324', 0.24],
    ['324F', 1.8],
  ]);

  it('values each printing at its own price', () => {
    const counts = { total: 3, byVariant: { normal: 1, foil: 1, 'hyperspace-foil': 1 } };
    expect(cardValue(counts, droid, prices)).toBeCloseTo(0.05 + 0.4 + 1.8, 5);
  });

  it('does not price every copy at the Normal rate, as the legacy app did', () => {
    const allNormal = { total: 3, byVariant: { normal: 3 } };
    const oneOfEach = { total: 3, byVariant: { normal: 1, foil: 1, 'hyperspace-foil': 1 } };
    expect(cardValue(allNormal, droid, prices)).toBeLessThan(cardValue(oneOfEach, droid, prices));
  });

  it('is zero when nothing is owned, and tolerates an unpriced printing', () => {
    expect(cardValue({ total: 0, byVariant: {} }, droid, prices)).toBe(0);
    expect(cardValue({ total: 1, byVariant: { normal: 1 } }, droid, new Map())).toBe(0);
  });
});

describe('pocketCounts', () => {
  const counts = {
    total: 6,
    byVariant: {
      normal: 2,
      hyperspace: 1,
      'hyperspace-foil': 1,
      prestige: 1,
      'prestige-serialized': 1,
    },
  };

  it('removes exactly the printings out in decks', () => {
    const pocket = pocketCounts(counts, { prestige: 1, 'hyperspace-foil': 1 });
    expect(pocket.byVariant).toMatchObject({
      prestige: 0,
      'hyperspace-foil': 0,
      hyperspace: 1,
      normal: 2,
    });
    expect(pocket.total).toBe(4);
  });

  it('changes nothing when no copies are out', () => {
    expect(pocketCounts(counts, {})).toBe(counts);
  });
});

describe('takeVariants', () => {
  it('takes the most valuable first and never a Prestige Serialized', () => {
    const available = { normal: 2, hyperspace: 1, prestige: 1, 'prestige-serialized': 1 };
    expect(takeVariants(available, 2)).toEqual({ prestige: 1, hyperspace: 1 });
    expect(takeVariants(available, 10)).toEqual({ prestige: 1, hyperspace: 1, normal: 2 });
  });
});
