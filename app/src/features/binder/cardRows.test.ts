import { describe, expect, it } from 'vitest';

import { parseSetCatalog, toLoadedSet, type LoadedSet } from '~/domain/catalog';
import { indexOwnership } from '~/domain/ownership';

import {
  buildCardRows,
  collectionTotals,
  EMPTY_FILTERS,
  hasActiveFilters,
  missingListSummary,
  missingListText,
  type Filters,
} from './cardRows';

function makeSet(): LoadedSet {
  return toLoadedSet(
    parseSetCatalog({
      setKey: 'SOR',
      label: 'Spark of Rebellion (SOR)',
      cards: [
        {
          base: 1,
          name: 'Director Krennic',
          subtitle: 'Aspiring to Authority',
          type: 'Leader',
          rarity: 'Rare',
          aspects: ['Vigilance', 'Villainy'],
          printings: [
            { num: '001', variant: 'normal' },
            { num: '253', variant: 'showcase' },
          ],
        },
        {
          base: 59,
          name: '2-1B Surgical Droid',
          type: 'Unit',
          rarity: 'Common',
          aspects: ['Vigilance'],
          printings: [
            { num: '059', variant: 'normal' },
            { num: '059F', variant: 'foil' },
          ],
        },
        {
          base: 80,
          name: 'Nameless Scout',
          type: 'Unit',
          rarity: 'Common',
          aspects: [],
          printings: [{ num: '080', variant: 'normal' }],
        },
      ],
    }),
    new Map([
      ['001', 2],
      ['253', 40],
      ['059', 0.05],
      ['059F', 0.5],
      ['080', 0.1],
    ]),
  );
}

const set = makeSet();
const filters = (overrides: Partial<Filters> = {}): Filters => ({ ...EMPTY_FILTERS, ...overrides });

describe('buildCardRows', () => {
  it('reports binder count, spares and need from per-printing ownership', () => {
    const ownership = indexOwnership([
      { base: 59, variant: 'normal', count: 3 },
      { base: 59, variant: 'foil', count: 2 },
    ]);
    const rows = buildCardRows(set, ownership, filters());
    const droid = rows.find((r) => r.base === 59)!;

    expect(droid.total).toBe(5);
    expect(droid.inBinder).toBe(3);
    expect(droid.inBulk).toBe(0);
    expect(droid.needed).toBe(0);
    expect(droid.status).toBe('complete');
  });

  it('values each printing at its own price', () => {
    const ownership = indexOwnership([
      { base: 59, variant: 'normal', count: 1 },
      { base: 59, variant: 'foil', count: 1 },
    ]);
    const droid = buildCardRows(set, ownership, filters()).find((r) => r.base === 59)!;
    expect(droid.value).toBeCloseTo(0.55, 5);
  });

  it('costs the missing copies at the Normal price', () => {
    const rows = buildCardRows(set, indexOwnership([]), filters());
    const droid = rows.find((r) => r.base === 59)!;
    expect(droid.needed).toBe(3);
    expect(droid.missingCost).toBeCloseTo(0.15, 5);
  });

  it('gives leaders a quota of one', () => {
    const ownership = indexOwnership([{ base: 1, variant: 'showcase', count: 1 }]);
    const krennic = buildCardRows(set, ownership, filters()).find((r) => r.base === 1)!;

    expect(krennic.quota).toBe(1);
    expect(krennic.status).toBe('complete');
    // A Showcase copy still fills the binder slot, and is valued as a Showcase.
    expect(krennic.value).toBe(40);
  });

  it('filters by aspect, treating aspectless cards as NEUTRAL', () => {
    const rows = buildCardRows(set, indexOwnership([]), filters({ aspect: ['NEUTRAL'] }));
    expect(rows.map((r) => r.base)).toEqual([80]);
  });

  it('filters by rarity, type and status', () => {
    const ownership = indexOwnership([{ base: 59, variant: 'normal', count: 3 }]);

    expect(buildCardRows(set, ownership, filters({ rarity: ['Rare'] })).map((r) => r.base)).toEqual(
      [1],
    );
    expect(buildCardRows(set, ownership, filters({ type: ['Unit'] })).map((r) => r.base)).toEqual([
      59, 80,
    ]);
    expect(
      buildCardRows(set, ownership, filters({ status: ['complete'] })).map((r) => r.base),
    ).toEqual([59]);
    expect(buildCardRows(set, ownership, filters({ status: ['none'] })).map((r) => r.base)).toEqual(
      [1, 80],
    );
  });

  it('filters by free text across name and subtitle', () => {
    expect(
      buildCardRows(set, indexOwnership([]), filters({ text: 'krennic' })).map((r) => r.base),
    ).toEqual([1]);
    expect(
      buildCardRows(set, indexOwnership([]), filters({ text: 'authority' })).map((r) => r.base),
    ).toEqual([1]);
  });

  it('sorts by base number so binder order is preserved', () => {
    expect(buildCardRows(set, indexOwnership([]), filters()).map((r) => r.base)).toEqual([
      1, 59, 80,
    ]);
  });
});

describe('collectionTotals', () => {
  it('counts each card once by status and sums value and remaining cost', () => {
    const ownership = indexOwnership([
      { base: 59, variant: 'normal', count: 3 },
      { base: 80, variant: 'normal', count: 1 },
    ]);
    const totals = collectionTotals(buildCardRows(set, ownership, filters()));

    expect(totals).toMatchObject({ cards: 3, complete: 1, partial: 1, missing: 1 });
    expect(totals.value).toBeCloseTo(3 * 0.05 + 0.1, 5);
    // Krennic needs 1 @ 2.00; the scout needs 2 @ 0.10.
    expect(totals.missingCost).toBeCloseTo(2 + 0.2, 5);
  });

  it('counts the bulk box separately from the binder', () => {
    const ownership = indexOwnership([{ base: 59, variant: 'normal', count: 5, bulk: 2 }]);
    const rows = buildCardRows(set, ownership, filters());
    expect(rows.find((r) => r.base === 59)).toMatchObject({ inBinder: 3, inBulk: 2 });
    expect(collectionTotals(rows).inBulk).toBe(2);
  });
});

describe('hasActiveFilters', () => {
  it('detects any active filter', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters(filters({ type: ['Unit'] }))).toBe(true);
    expect(hasActiveFilters(filters({ text: '  ' }))).toBe(false);
    expect(hasActiveFilters(filters({ text: 'vader' }))).toBe(true);
  });
});

describe('missingListText', () => {
  it('writes a TCGplayer-pasteable list of what is still needed', () => {
    const rows = buildCardRows(set, indexOwnership([]), filters());
    expect(missingListText(rows, 'SOR', 'fullNeeded')).toBe(
      [
        '1 Director Krennic - Aspiring to Authority (SOR)',
        '3 2-1B Surgical Droid (SOR)',
        '3 Nameless Scout (SOR)',
      ].join('\n'),
    );
  });

  it('can list one of each instead of the full need', () => {
    const rows = buildCardRows(set, indexOwnership([]), filters());
    expect(
      missingListText(rows, 'SOR', 'oneEach')
        .split('\n')
        .every((l) => l.startsWith('1 ')),
    ).toBe(true);
  });

  it('omits cards that are already complete', () => {
    const ownership = indexOwnership([{ base: 59, variant: 'normal', count: 3 }]);
    const rows = buildCardRows(set, ownership, filters());
    expect(missingListText(rows, 'SOR', 'fullNeeded')).not.toContain('2-1B');
  });

  it('copies only what the filters show', () => {
    const rows = buildCardRows(set, indexOwnership([]), filters({ type: ['Unit'] }));
    const text = missingListText(rows, 'SOR', 'fullNeeded');
    expect(text).not.toContain('Krennic');
    expect(text).toContain('2-1B');
  });
});

describe('missingListSummary', () => {
  it('counts the cards and copies the copy buttons would produce', () => {
    const ownership = indexOwnership([{ base: 59, variant: 'normal', count: 1 }]);
    const rows = buildCardRows(set, ownership, filters());
    // Krennic 1 + 2-1B 2 + Scout 3.
    expect(missingListSummary(rows)).toEqual({ cards: 3, copies: 6 });
  });

  it('is empty when nothing shown is needed', () => {
    const ownership = indexOwnership([{ base: 59, variant: 'normal', count: 3 }]);
    const rows = buildCardRows(set, ownership, filters({ text: '2-1B' }));
    expect(missingListSummary(rows)).toEqual({ cards: 0, copies: 0 });
  });
});

describe('cards pulled into built decks', () => {
  const ownership = indexOwnership([{ base: 59, variant: 'normal', count: 3 }]);
  const inDecks = new Map([[59, { binder: { normal: 2 }, bulk: {} }]]);

  it('leaves the binder, but still counts as owned', () => {
    const row = buildCardRows(set, ownership, filters(), inDecks).find((r) => r.base === 59)!;
    expect(row).toMatchObject({ inBinder: 1, inDecks: 2, status: 'partial', needed: 0 });
  });

  it('can be hidden when only short because of decks', () => {
    const rows = buildCardRows(set, ownership, filters({ hideInDecks: true }), inDecks);
    expect(rows.some((r) => r.base === 59)).toBe(false);
    expect(hasActiveFilters(filters({ hideInDecks: true }))).toBe(true);
  });
});
