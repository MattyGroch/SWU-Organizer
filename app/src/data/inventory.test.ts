import { beforeEach, describe, expect, it } from 'vitest';

import { parseSetCatalog, toLoadedSet, type LoadedSet } from '~/domain/catalog';

import { SwuDatabase } from './db';
import {
  adjustPrinting,
  clearSlot,
  defaultPrinting,
  fillPlayset,
  printingFor,
  readSetOwnership,
  restorePrintings,
  setPrintingCount,
} from './inventory';

function makeSet(): LoadedSet {
  return toLoadedSet(
    parseSetCatalog({
      setKey: 'SOR',
      label: 'Spark of Rebellion (SOR)',
      cards: [
        {
          base: 1,
          name: 'Director Krennic',
          type: 'Leader',
          aspects: [],
          printings: [
            { num: '001', variant: 'normal' },
            { num: '253', variant: 'showcase' },
          ],
        },
        {
          base: 59,
          name: '2-1B Surgical Droid',
          type: 'Unit',
          aspects: [],
          printings: [
            { num: '059', variant: 'normal' },
            { num: '059F', variant: 'foil' },
            { num: '324', variant: 'hyperspace' },
          ],
        },
      ],
    }),
    new Map(),
  );
}

describe('printing selection', () => {
  const set = makeSet();

  it('defaults to the Normal printing', () => {
    expect(defaultPrinting(set, 59)).toEqual({ num: '059', variant: 'normal' });
  });

  it('finds a specific variant', () => {
    expect(printingFor(set, 59, 'hyperspace')).toEqual({ num: '324', variant: 'hyperspace' });
  });

  it('returns nothing for a variant the card was never printed in', () => {
    // SOR Units have no Prestige run.
    expect(printingFor(set, 59, 'prestige')).toBeUndefined();
  });
});

describe('adjustPrinting', () => {
  let database: SwuDatabase;
  const set = makeSet();

  beforeEach(async () => {
    database = new SwuDatabase(`test-${crypto.randomUUID()}`);
    await database.open();
  });

  it('increments and decrements a single printing', async () => {
    const normal = defaultPrinting(set, 59)!;

    expect(await adjustPrinting('SOR', 59, normal, 1, database)).toBe(1);
    expect(await adjustPrinting('SOR', 59, normal, 1, database)).toBe(2);
    expect(await adjustPrinting('SOR', 59, normal, -1, database)).toBe(1);
  });

  it('never goes below zero and removes the row when emptied', async () => {
    const normal = defaultPrinting(set, 59)!;

    await adjustPrinting('SOR', 59, normal, 1, database);
    expect(await adjustPrinting('SOR', 59, normal, -5, database)).toBe(0);
    expect(await database.owned.get('SOR:059')).toBeUndefined();
  });

  it('does not cap at the playset quota', async () => {
    const normal = defaultPrinting(set, 59)!;
    for (let i = 0; i < 7; i++) await adjustPrinting('SOR', 59, normal, 1, database);

    const ownership = await readSetOwnership('SOR', database);
    expect(ownership.get(59)!.total).toBe(7);
  });

  it('tracks printings of the same card separately but totals them together', async () => {
    await adjustPrinting('SOR', 59, printingFor(set, 59, 'normal')!, 2, database);
    await adjustPrinting('SOR', 59, printingFor(set, 59, 'foil')!, 1, database);
    await adjustPrinting('SOR', 59, printingFor(set, 59, 'hyperspace')!, 3, database);

    const ownership = await readSetOwnership('SOR', database);
    expect(ownership.get(59)).toEqual({
      total: 6,
      byVariant: { normal: 2, foil: 1, hyperspace: 3 },
    });
  });

  it('keeps sets isolated', async () => {
    const normal = defaultPrinting(set, 59)!;
    await adjustPrinting('SOR', 59, normal, 2, database);
    await adjustPrinting('LOF', 59, normal, 5, database);

    expect((await readSetOwnership('SOR', database)).get(59)!.total).toBe(2);
    expect((await readSetOwnership('LOF', database)).get(59)!.total).toBe(5);
  });
});

describe('setPrintingCount', () => {
  let database: SwuDatabase;
  const set = makeSet();

  beforeEach(async () => {
    database = new SwuDatabase(`test-${crypto.randomUUID()}`);
    await database.open();
  });

  it('sets an exact count', async () => {
    const normal = defaultPrinting(set, 59)!;
    expect(await setPrintingCount('SOR', 59, normal, 4, database)).toBe(4);
    expect(await setPrintingCount('SOR', 59, normal, 1, database)).toBe(1);
  });

  it('deletes the row when set to zero', async () => {
    const normal = defaultPrinting(set, 59)!;
    await setPrintingCount('SOR', 59, normal, 3, database);
    await setPrintingCount('SOR', 59, normal, 0, database);
    expect(await database.owned.get('SOR:059')).toBeUndefined();
  });
});

describe('clearSlot and restorePrintings', () => {
  let database: SwuDatabase;
  const set = makeSet();

  beforeEach(async () => {
    database = new SwuDatabase(`test-${crypto.randomUUID()}`);
    await database.open();
  });

  it('removes every printing of a card and reports what it took', async () => {
    await adjustPrinting('SOR', 59, printingFor(set, 59, 'normal')!, 3, database);
    await adjustPrinting('SOR', 59, printingFor(set, 59, 'foil')!, 1, database);
    await adjustPrinting('SOR', 59, printingFor(set, 59, 'hyperspace')!, 2, database);

    const removed = await clearSlot('SOR', 59, database);

    expect(removed).toHaveLength(3);
    expect(removed.reduce((sum, row) => sum + row.count, 0)).toBe(6);
    expect((await readSetOwnership('SOR', database)).size).toBe(0);
  });

  it('leaves other slots alone', async () => {
    await adjustPrinting('SOR', 1, printingFor(set, 1, 'normal')!, 1, database);
    await adjustPrinting('SOR', 59, printingFor(set, 59, 'normal')!, 2, database);

    await clearSlot('SOR', 59, database);

    const ownership = await readSetOwnership('SOR', database);
    expect(ownership.get(1)!.total).toBe(1);
    expect(ownership.has(59)).toBe(false);
  });

  it('restores an emptied slot exactly', async () => {
    await adjustPrinting('SOR', 59, printingFor(set, 59, 'normal')!, 3, database);
    await adjustPrinting('SOR', 59, printingFor(set, 59, 'hyperspace')!, 2, database);
    const before = await readSetOwnership('SOR', database);

    const removed = await clearSlot('SOR', 59, database);
    await restorePrintings(removed, database);

    // Undo must return the exact per-printing breakdown, not a flattened total.
    expect(await readSetOwnership('SOR', database)).toEqual(before);
  });

  it('is a no-op on an empty slot', async () => {
    expect(await clearSlot('SOR', 59, database)).toEqual([]);
    await expect(restorePrintings([], database)).resolves.toBeUndefined();
  });
});

describe('fillPlayset', () => {
  let database: SwuDatabase;
  const set = makeSet();

  beforeEach(async () => {
    database = new SwuDatabase(`test-${crypto.randomUUID()}`);
    await database.open();
  });

  it('fills an empty slot to the quota', async () => {
    const printing = defaultPrinting(set, 59)!;
    expect(await fillPlayset('SOR', 59, printing, 3, database)).toBe(3);
  });

  it('tops up a partial slot', async () => {
    const printing = defaultPrinting(set, 59)!;
    await adjustPrinting('SOR', 59, printing, 1, database);
    expect(await fillPlayset('SOR', 59, printing, 3, database)).toBe(3);
  });

  it('never deletes spares', async () => {
    // Someone with five copies who hits "fill playset" must not lose two of them.
    const printing = defaultPrinting(set, 59)!;
    await adjustPrinting('SOR', 59, printing, 5, database);
    expect(await fillPlayset('SOR', 59, printing, 3, database)).toBe(5);
  });

  it('respects a card’s own quota rather than a flat three', async () => {
    const printing = defaultPrinting(set, 1)!;
    // Krennic is a Leader: one copy is a full playset.
    expect(await fillPlayset('SOR', 1, printing, 1, database)).toBe(1);
  });

  it('leaves other printings of the card untouched', async () => {
    await adjustPrinting('SOR', 59, printingFor(set, 59, 'hyperspace')!, 2, database);
    await fillPlayset('SOR', 59, defaultPrinting(set, 59)!, 3, database);

    expect((await readSetOwnership('SOR', database)).get(59)!.byVariant).toEqual({
      normal: 3,
      hyperspace: 2,
    });
  });
});
