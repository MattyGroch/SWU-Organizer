import { beforeEach, describe, expect, it } from 'vitest';

import type { ImportedPrinting } from '~/domain/import';

import { emptyDeckLibrary, type DeckLibrary } from '~/domain/decks';

import { applyImport, buildExport } from './applyImport';
import { SwuDatabase, type OwnedPrinting } from './db';

function printing(
  setKey: string,
  base: number,
  num: string,
  variant: ImportedPrinting['variant'],
  count: number,
): ImportedPrinting {
  return { setKey, base, num, variant, count };
}

describe('applyImport', () => {
  let database: SwuDatabase;

  beforeEach(async () => {
    database = new SwuDatabase(`test-${crypto.randomUUID()}`);
    await database.open();
  });

  it('writes each printing as its own row', async () => {
    await applyImport(
      [
        printing('SOR', 59, '059', 'normal', 3),
        printing('SOR', 59, '059F', 'foil', 1),
        printing('SOR', 59, '324', 'hyperspace', 2),
      ],
      'replaceSets',
      { database },
    );

    expect(await database.owned.count()).toBe(3);
    expect((await database.owned.get('SOR:059'))!.count).toBe(3);
    expect((await database.owned.get('SOR:059F'))!.variant).toBe('foil');
  });

  it('replace clears only the sets the file mentions', async () => {
    await database.owned.bulkPut([
      {
        id: 'SOR:001',
        setKey: 'SOR',
        base: 1,
        num: '001',
        variant: 'normal',
        count: 1,
        updatedAt: 1,
      },
      {
        id: 'LOF:142',
        setKey: 'LOF',
        base: 142,
        num: '142',
        variant: 'normal',
        count: 4,
        updatedAt: 1,
      },
    ]);

    await applyImport([printing('SOR', 59, '059', 'normal', 2)], 'replaceSets', { database });

    // SOR was rewritten from scratch; LOF was never mentioned, so it survives untouched.
    expect(await database.owned.get('SOR:001')).toBeUndefined();
    expect((await database.owned.get('SOR:059'))!.count).toBe(2);
    expect((await database.owned.get('LOF:142'))!.count).toBe(4);
  });

  it('merge adds to existing counts', async () => {
    await applyImport([printing('SOR', 59, '059', 'normal', 2)], 'replaceSets', { database });
    await applyImport([printing('SOR', 59, '059', 'normal', 3)], 'add', { database });

    expect((await database.owned.get('SOR:059'))!.count).toBe(5);
  });

  it('merge leaves untouched printings alone', async () => {
    await applyImport([printing('SOR', 59, '059F', 'foil', 1)], 'replaceSets', { database });
    await applyImport([printing('SOR', 59, '059', 'normal', 2)], 'add', { database });

    expect((await database.owned.get('SOR:059F'))!.count).toBe(1);
    expect((await database.owned.get('SOR:059'))!.count).toBe(2);
  });

  it('does not clamp to a playset quota', async () => {
    await applyImport([printing('SOR', 59, '059', 'normal', 12)], 'replaceSets', { database });
    expect((await database.owned.get('SOR:059'))!.count).toBe(12);
  });

  it('reports what it did', async () => {
    const report = await applyImport(
      [printing('SOR', 59, '059', 'normal', 3), printing('LOF', 142, '142', 'normal', 1)],
      'replaceSets',
      { database },
    );

    expect(report).toMatchObject({ mode: 'replaceSets', printingsWritten: 2, copiesDelta: 4 });
    expect(report.setsTouched.sort()).toEqual(['LOF', 'SOR']);
  });

  it('handles an empty import without clearing anything', async () => {
    await applyImport([printing('SOR', 59, '059', 'normal', 1)], 'replaceSets', { database });
    const report = await applyImport([], 'replaceSets', { database });

    expect(report.setsTouched).toEqual([]);
    expect(await database.owned.count()).toBe(1);
  });
});

describe('applyImport modes', () => {
  let database: SwuDatabase;

  beforeEach(async () => {
    database = new SwuDatabase(`test-${crypto.randomUUID()}`);
    await database.open();
    // Starting collection: 2 Normal Krennic, 1 Normal 2-1B, plus a card in another set.
    await applyImport(
      [
        printing('SOR', 1, '001', 'normal', 2),
        printing('SOR', 59, '059', 'normal', 1),
        printing('LOF', 142, '142', 'normal', 3),
      ],
      'replaceAll',
      { database },
    );
  });

  const count = async (id: string) => (await database.owned.get(id))?.count ?? 0;

  const file = [
    printing('SOR', 1, '001', 'normal', 1),
    printing('SOR', 59, '059', 'normal', 3),
    printing('SOR', 59, '324', 'hyperspace', 1),
  ];

  it('add: sums onto existing counts', async () => {
    await applyImport(file, 'add', { database });
    expect([await count('SOR:001'), await count('SOR:059'), await count('SOR:324')]).toEqual([
      3, 4, 1,
    ]);
    expect(await count('LOF:142')).toBe(3);
  });

  it('missing: only writes printings you have none of, per printing', async () => {
    const report = await applyImport(file, 'missing', { database });
    // Both owned Normals keep their counts; the Hyperspace 2-1B is new, even though the
    // Normal 2-1B is owned.
    expect([await count('SOR:001'), await count('SOR:059'), await count('SOR:324')]).toEqual([
      2, 1, 1,
    ]);
    expect(report).toMatchObject({ printingsWritten: 1, printingsUnchanged: 2, copiesDelta: 1 });
  });

  it('higher: keeps the larger count for each printing', async () => {
    const report = await applyImport(file, 'higher', { database });
    expect([await count('SOR:001'), await count('SOR:059'), await count('SOR:324')]).toEqual([
      2, 3, 1,
    ]);
    expect(report).toMatchObject({ printingsWritten: 2, printingsUnchanged: 1, copiesDelta: 3 });
  });

  it('replaceSets: clears only the sets in the file', async () => {
    await applyImport(file, 'replaceSets', { database });
    expect([await count('SOR:001'), await count('SOR:059'), await count('SOR:324')]).toEqual([
      1, 3, 1,
    ]);
    expect(await count('LOF:142')).toBe(3);
  });

  it('replaceAll: clears every set, and reports the emptied ones as touched', async () => {
    const report = await applyImport(file, 'replaceAll', { database });
    expect(await count('LOF:142')).toBe(0);
    expect(await database.owned.count()).toBe(3);
    expect(report.setsTouched.sort()).toEqual(['LOF', 'SOR']);
    // 6 owned before, 5 after.
    expect(report.copiesDelta).toBe(-1);
  });

  it('sums a printing listed twice in one file instead of keeping only the last row', async () => {
    await applyImport(
      [printing('SOR', 59, '324', 'hyperspace', 1), printing('SOR', 59, '324', 'hyperspace', 2)],
      'add',
      { database },
    );
    expect(await count('SOR:324')).toBe(3);
  });

  it('restores the deck library alongside the counts', async () => {
    const library: DeckLibrary = { ...emptyDeckLibrary, preconOwnership: { 'SOR-Vader': 1 } };
    const report = await applyImport(file, 'replaceAll', { database, deckLibrary: library });
    expect(report.decksRestored).toBe(true);
    expect(JSON.parse((await database.deckLibrary.get('library'))!.json)).toEqual(library);
  });

  it('leaves decks alone when none are passed', async () => {
    await applyImport(file, 'replaceAll', { database });
    expect(await database.deckLibrary.get('library')).toBeUndefined();
  });
});

describe('buildExport', () => {
  let database: SwuDatabase;

  beforeEach(async () => {
    database = new SwuDatabase(`test-${crypto.randomUUID()}`);
    await database.open();
  });

  it('exports at printing level, not base level', async () => {
    await applyImport(
      [printing('SOR', 59, '059', 'normal', 3), printing('SOR', 59, '059F', 'foil', 1)],
      'replaceSets',
      { database },
    );

    const payload = await buildExport(database, new Date('2026-10-04T12:00:00Z'));

    expect(payload.version).toBe(3);
    expect(payload.exportedAt).toBe('2026-10-04T12:00:00.000Z');
    // The legacy v1 export collapsed both of these into a single base-number count.
    expect(payload.sets.SOR).toEqual({ '059': 3, '059F': 1 });
  });

  it('round-trips through import without losing variants', async () => {
    const original = [
      printing('SOR', 59, '059', 'normal', 3),
      printing('SOR', 59, '324F', 'hyperspace-foil', 2),
    ];
    await applyImport(original, 'replaceSets', { database });

    const payload = await buildExport(database);
    const other = new SwuDatabase(`test-${crypto.randomUUID()}`);
    await other.open();

    const restored: ImportedPrinting[] = Object.entries(payload.sets).flatMap(([setKey, inv]) =>
      Object.entries(inv).map(([num, count]) => {
        const source = original.find((p) => p.num === num)!;
        return printing(setKey, source.base, num, source.variant, count);
      }),
    );
    await applyImport(restored, 'replaceSets', { database: other });

    // `updatedAt` is a write timestamp, not collection data, so compare the rest.
    const strip = (rows: OwnedPrinting[]) =>
      rows
        .map(({ updatedAt: _updatedAt, ...rest }) => rest)
        .sort((a, b) => a.id.localeCompare(b.id));

    expect(strip(await other.owned.toArray())).toEqual(strip(await database.owned.toArray()));
  });

  it('includes the deck library, so a backup restores decks too', async () => {
    const library: DeckLibrary = { ...emptyDeckLibrary, preconOwnership: { 'SOR-Luke': 1 } };
    await applyImport([], 'add', { database, deckLibrary: library });
    expect((await buildExport(database)).decks).toEqual(library);
  });

  it('exports nothing for an empty collection', async () => {
    expect((await buildExport(database)).sets).toEqual({});
  });
});
