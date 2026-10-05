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
  pocketCounts,
  boxCounts,
  pocketRoom,
  spillToBulk,
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

  it('keeps the Leader & Base setting for those two types only', () => {
    expect(quotaForCard({ type: 'Leader' }, 2)).toBe(2);
    expect(quotaForCard({ type: 'Base' }, 2)).toBe(2);
    expect(quotaForCard({ type: 'Unit' }, 2)).toBe(3);
  });

  it('honours a per-card override', () => {
    // Swarming Vulture Droid allows 15.
    expect(quotaForCard({ type: 'Unit', maxCopies: 15 })).toBe(15);
  });
});

describe('binder vs collection', () => {
  it('caps the binder at the playset', () => {
    expect(binderCount(5, 3)).toBe(3);
    expect(binderCount(2, 3)).toBe(2);
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
    const pocket = pocketCounts(counts, {
      binder: { prestige: 1, 'hyperspace-foil': 1 },
      bulk: {},
    });
    expect(pocket.byVariant).toMatchObject({
      prestige: 0,
      'hyperspace-foil': 0,
      hyperspace: 1,
      normal: 2,
    });
    expect(pocket.total).toBe(4);
  });

  it('changes nothing when no copies are out', () => {
    expect(pocketCounts(counts, { binder: {}, bulk: {} })).toEqual(counts);
  });

  it('leaves out bulk-box copies, and counts what is in the box apart', () => {
    const withBulk = { ...counts, bulkByVariant: { normal: 2 } };
    const held = { binder: {}, bulk: { normal: 1 } };
    expect(pocketCounts(withBulk, held).total).toBe(4);
    expect(boxCounts(withBulk, held)).toEqual({ normal: 1 });
  });
});

describe('takeVariants', () => {
  it('takes the most valuable first and never a Prestige Serialized', () => {
    const available = { normal: 2, hyperspace: 1, prestige: 1, 'prestige-serialized': 1 };
    expect(takeVariants(available, 2)).toEqual({ prestige: 1, hyperspace: 1 });
    expect(takeVariants(available, 10)).toEqual({ prestige: 1, hyperspace: 1, normal: 2 });
  });
});

describe('pocketRoom', () => {
  it('has room until the pocket holds its quota', () => {
    expect(pocketRoom({ normal: 2 }, 3, 'normal')).toEqual({ kind: 'room' });
    expect(pocketRoom({}, 1, 'normal')).toEqual({ kind: 'room' });
  });

  it('sends a copy no better than the weakest in the pocket to bulk', () => {
    expect(pocketRoom({ normal: 3 }, 3, 'normal')).toEqual({ kind: 'full' });
    expect(pocketRoom({ hyperspace: 2, normal: 1 }, 3, 'normal')).toEqual({ kind: 'full' });
    expect(pocketRoom({ hyperspace: 3 }, 3, 'foil')).toEqual({ kind: 'full' });
  });

  it('offers to swap out the weakest copy for a better one', () => {
    // Your example: 2 Hyperspace and 1 Normal, then a Hyperspace Foil.
    expect(pocketRoom({ hyperspace: 2, normal: 1 }, 3, 'hyperspace-foil')).toEqual({
      kind: 'upgrade',
      replaces: 'normal',
    });
    expect(pocketRoom({ normal: 1 }, 1, 'prestige-serialized')).toEqual({
      kind: 'upgrade',
      replaces: 'normal',
    });
  });

  it('judges only the copies the binder shows, not the spares beyond them', () => {
    // Three Hyperspace fill the pocket; the spare Normal is not "in the binder".
    expect(pocketRoom({ hyperspace: 3, normal: 1 }, 3, 'foil')).toEqual({ kind: 'full' });
    expect(pocketRoom({ hyperspace: 3, normal: 1 }, 3, 'hyperspace-foil')).toEqual({
      kind: 'upgrade',
      replaces: 'hyperspace',
    });
  });
});

describe('bulk box', () => {
  const row = (variant: 'normal' | 'hyperspace' | 'prestige', count: number, bulk?: number) => ({
    base: 59,
    variant,
    count,
    ...(bulk !== undefined && { bulk }),
  });

  it('indexes bulk copies apart from the total', () => {
    const index = indexOwnership([row('normal', 3, 2), row('hyperspace', 1)]);
    expect(ownedFor(index, 59)).toEqual({
      total: 4,
      byVariant: { normal: 3, hyperspace: 1 },
      bulkByVariant: { normal: 2 },
    });
  });

  it('spills the weakest binder copies beyond the playset', () => {
    const rows = [row('prestige', 1), row('normal', 3), row('hyperspace', 1)];
    expect(spillToBulk(rows, 3)).toEqual([
      row('prestige', 1),
      row('normal', 3, 2),
      row('hyperspace', 1),
    ]);
  });

  it('counts copies already in bulk as out of the binder, and never brings them back', () => {
    expect(spillToBulk([row('normal', 4, 1), row('hyperspace', 1)], 3)).toEqual([
      row('normal', 4, 2),
      row('hyperspace', 1),
    ]);
    expect(spillToBulk([row('normal', 3, 3)], 3)).toEqual([row('normal', 3, 3)]);
  });

  it('leaves copies out in decks alone, and does not count them toward the playset', () => {
    // A Leader: its Normal is in a deck, so the pocket holds only the two Hyperspace copies.
    const rows = [row('normal', 1), row('hyperspace', 2)];
    expect(spillToBulk(rows, 1, { normal: 1 })).toEqual([
      row('normal', 1),
      row('hyperspace', 2, 1),
    ]);
  });
});
