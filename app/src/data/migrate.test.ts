import { beforeEach, describe, expect, it } from 'vitest';

import { parseSetCatalog, toLoadedSet, type LoadedSet } from '~/domain/catalog';
import type { SetKey } from '~/domain/types';

import { SwuDatabase } from './db';
import { legacySetKeys, migrateLocalStorage, planMigration } from './migrate';

/** Minimal in-memory Storage so tests don't depend on jsdom's localStorage lifecycle. */
function makeStorage(entries: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  } as Storage;
}

function makeSets(): Map<SetKey, LoadedSet> {
  const sor = toLoadedSet(
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
          ],
        },
      ],
    }),
    new Map(),
  );
  return new Map([['SOR', sor]]);
}

describe('legacySetKeys', () => {
  it('finds set inventories and ignores bookkeeping keys', () => {
    const storage = makeStorage({
      'inv:SOR': '{}',
      'inv:LOF': '{}',
      'inv:schema-version': '2',
      'inv:migration:v2:backup': '{}',
      'decks:v1': '{}',
    });
    expect(legacySetKeys(storage).sort()).toEqual(['LOF', 'SOR']);
  });
});

describe('planMigration', () => {
  it('lands each legacy count on the card’s Normal printing', () => {
    const storage = makeStorage({ 'inv:SOR': JSON.stringify({ 1: 1, 59: 3 }) });
    const { rows, report } = planMigration(storage, makeSets(), 1000);

    expect(rows).toEqual([
      {
        id: 'SOR:001',
        setKey: 'SOR',
        base: 1,
        num: '001',
        variant: 'normal',
        count: 1,
        updatedAt: 1000,
      },
      {
        id: 'SOR:059',
        setKey: 'SOR',
        base: 59,
        num: '059',
        variant: 'normal',
        count: 3,
        updatedAt: 1000,
      },
    ]);
    expect(report.setsImported).toBe(1);
    expect(report.copiesWritten).toBe(4);
    expect(report.unknownCards).toEqual([]);
  });

  it('preserves counts above the playset quota instead of clamping them', () => {
    // The legacy importer did Math.min(total, quota) and discarded the rest.
    const storage = makeStorage({ 'inv:SOR': JSON.stringify({ 59: 7 }) });
    const { rows } = planMigration(storage, makeSets(), 1000);
    expect(rows[0]!.count).toBe(7);
  });

  it('reports cards the catalog no longer knows rather than dropping them silently', () => {
    const storage = makeStorage({ 'inv:SOR': JSON.stringify({ 9999: 2 }) });
    const { rows, report } = planMigration(storage, makeSets(), 1000);

    expect(rows).toEqual([]);
    expect(report.unknownCards).toEqual([{ setKey: 'SOR', base: 9999, count: 2 }]);
  });

  it('reports an entire set the catalog no longer knows', () => {
    const storage = makeStorage({ 'inv:XYZ': JSON.stringify({ 1: 2 }) });
    const { report } = planMigration(storage, makeSets(), 1000);
    expect(report.unknownCards).toEqual([{ setKey: 'XYZ', base: 1, count: 2 }]);
  });

  it('skips malformed and non-positive entries', () => {
    const storage = makeStorage({
      'inv:SOR': JSON.stringify({ 59: 0, 1: -1, abc: 2, 0: 5 }),
    });
    const { rows } = planMigration(storage, makeSets(), 1000);
    expect(rows).toEqual([]);
  });

  it('tolerates unparseable storage', () => {
    const storage = makeStorage({ 'inv:SOR': 'not json' });
    expect(planMigration(storage, makeSets(), 1000).rows).toEqual([]);
  });
});

describe('migrateLocalStorage', () => {
  let database: SwuDatabase;

  beforeEach(async () => {
    database = new SwuDatabase(`test-${crypto.randomUUID()}`);
    await database.open();
  });

  it('imports legacy data once and records that it ran', async () => {
    const storage = makeStorage({ 'inv:SOR': JSON.stringify({ 59: 3 }) });

    const first = await migrateLocalStorage(database, storage, makeSets(), 1000);
    expect(first.ran).toBe(true);
    expect(first.printingsWritten).toBe(1);
    expect(await database.owned.count()).toBe(1);

    // A second boot must not double-count.
    const second = await migrateLocalStorage(database, storage, makeSets(), 2000);
    expect(second.ran).toBe(false);
    expect(await database.owned.count()).toBe(1);
    expect((await database.owned.get('SOR:059'))!.count).toBe(3);
  });

  it('leaves localStorage intact so the legacy app still works', async () => {
    const storage = makeStorage({ 'inv:SOR': JSON.stringify({ 59: 3 }) });
    await migrateLocalStorage(database, storage, makeSets(), 1000);
    expect(storage.getItem('inv:SOR')).toBe(JSON.stringify({ 59: 3 }));
  });

  it('never overwrites a database that already holds data', async () => {
    await database.owned.put({
      id: 'SOR:059',
      setKey: 'SOR',
      base: 59,
      num: '059',
      variant: 'normal',
      count: 1,
      updatedAt: 1,
    });
    const storage = makeStorage({ 'inv:SOR': JSON.stringify({ 59: 3 }) });

    const report = await migrateLocalStorage(database, storage, makeSets(), 1000);

    expect(report.ran).toBe(false);
    expect((await database.owned.get('SOR:059'))!.count).toBe(1);
  });

  it('no-ops cleanly when there is nothing to migrate', async () => {
    const report = await migrateLocalStorage(database, makeStorage(), makeSets(), 1000);
    expect(report.ran).toBe(true);
    expect(report.printingsWritten).toBe(0);
    expect(await database.owned.count()).toBe(0);
  });
});
