import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetChangeListeners } from '../changes';
import { SwuDatabase } from '../db';
import { adjustPrinting, defaultPrinting, printingFor } from '../inventory';
import { parseSetCatalog, toLoadedSet, type LoadedSet } from '~/domain/catalog';

import { applyInventoryPayload, createInventorySync, snapshotSet } from './inventory';

function makeSet(): LoadedSet {
  return toLoadedSet(
    parseSetCatalog({
      setKey: 'SOR',
      label: 'SOR',
      cards: [
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

function makeStorage(): Storage {
  const map = new Map<string, string>();
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

let database: SwuDatabase;
const set = makeSet();

beforeEach(async () => {
  database = new SwuDatabase(`test-${crypto.randomUUID()}`);
  await database.open();
});

afterEach(() => resetChangeListeners());

describe('snapshotSet', () => {
  it('serialises a set as printing number to count', async () => {
    await adjustPrinting('SOR', 59, printingFor(set, 59, 'normal')!, 3, database);
    await adjustPrinting('SOR', 59, printingFor(set, 59, 'foil')!, 1, database);

    // The same Record<string, number> shape the server already accepts.
    expect(await snapshotSet('SOR', database)).toEqual({ '059': 3, '059F': 1 });
  });

  it('is empty for an untouched set', async () => {
    expect(await snapshotSet('LOF', database)).toEqual({});
  });
});

describe('applyInventoryPayload', () => {
  it('writes printings and replaces the set', async () => {
    await adjustPrinting('SOR', 59, printingFor(set, 59, 'normal')!, 5, database);
    await applyInventoryPayload('SOR', { '324': 2 }, set, database);

    const rows = await database.owned.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ num: '324', variant: 'hyperspace', count: 2 });
  });

  it('refuses a payload with printings this catalog does not know, changing nothing', async () => {
    await adjustPrinting('SOR', 59, printingFor(set, 59, 'normal')!, 3, database);
    // Another device on a newer catalog. Storing only the known part, and then claiming
    // the server's version, is how a whole set was lost.
    await expect(
      applyInventoryPayload('SOR', { '059': 2, '9999': 1 }, set, database),
    ).rejects.toThrow(/9999/);

    const rows = await database.owned.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ num: '059', count: 3 });
  });

  it('refuses when the catalog is unavailable, leaving the set alone', async () => {
    await adjustPrinting('SOR', 59, printingFor(set, 59, 'normal')!, 3, database);
    await expect(applyInventoryPayload('SOR', { '324': 9 }, undefined, database)).rejects.toThrow(
      /not loaded/,
    );

    expect((await database.owned.toArray())[0]!.count).toBe(3);
  });

  it('stores a promo alias under the printing it belongs to', async () => {
    const withPromo = toLoadedSet(
      parseSetCatalog({
        setKey: 'LOF',
        label: 'LOF',
        cards: [
          {
            base: 79,
            name: 'Promo Card',
            type: 'Unit',
            aspects: [],
            printings: [
              { num: '079', variant: 'normal' },
              { num: 'P25-79', variant: 'promo', aliases: ['1050'] },
            ],
          },
        ],
      }),
      new Map(),
    );
    // An older device still writes the alias; a newer one the printing's own number.
    await applyInventoryPayload(
      'LOF',
      { '1050': 1, '1050@bulk': 1, 'P25-79': 1 },
      withPromo,
      database,
    );

    const rows = await database.owned.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ num: 'P25-79', variant: 'promo', base: 79, count: 2, bulk: 1 });
  });

  it('ignores non-positive counts', async () => {
    await applyInventoryPayload('SOR', { '059': 0, '324': -1 }, set, database);
    expect(await database.owned.count()).toBe(0);
  });
});

describe('createInventorySync', () => {
  it('queues a push when a local write happens', async () => {
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ version: 1 }), { status: 200 }),
    );
    const sync = createInventorySync({
      getSet: () => set,
      storage: makeStorage(),
      fetchFn: fetchFn as unknown as typeof fetch,
      database,
    });
    const stop = sync.start();

    await adjustPrinting('SOR', 59, defaultPrinting(set, 59)!, 2, database);

    // The change handler reads the set back from IndexedDB, so it lands a few ticks later
    // — one tick was usually, but not always, enough under a loaded test run.
    await vi.waitFor(() => expect(sync.getState().pending.SOR).toEqual({ '059': 2 }));
    stop();
    sync.dispose();
  });

  it('stops queueing once unsubscribed', async () => {
    const sync = createInventorySync({
      getSet: () => set,
      storage: makeStorage(),
      fetchFn: vi.fn() as unknown as typeof fetch,
      database,
    });
    sync.start()();

    await adjustPrinting('SOR', 59, defaultPrinting(set, 59)!, 1, database);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sync.hasPending()).toBe(false);
    sync.dispose();
  });

  it('does not re-queue a value it just applied from the server', async () => {
    const sync = createInventorySync({
      getSet: () => set,
      storage: makeStorage(),
      fetchFn: vi.fn() as unknown as typeof fetch,
      database,
    });
    const stop = sync.start();

    // Applying a remote value must not look like a local write, or the two devices
    // would push each other's data back and forth forever.
    await sync.applyRemote('SOR', { '324': 3 }, 5);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sync.hasPending()).toBe(false);
    expect((await database.owned.toArray())[0]!.num).toBe('324');

    stop();
    sync.dispose();
  });
});

describe('bulk copies in sync payloads', () => {
  it('sends them under their own key and reads them back', async () => {
    await database.owned.put({
      id: 'SOR:059',
      setKey: 'SOR',
      base: 59,
      num: '059',
      variant: 'normal',
      count: 4,
      bulk: 1,
      updatedAt: 0,
    });
    const payload = await snapshotSet('SOR', database);
    expect(payload).toEqual({ '059': 4, '059@bulk': 1 });

    await database.owned.clear();
    await applyInventoryPayload('SOR', payload, set, database);
    expect(await database.owned.toArray()).toEqual([
      expect.objectContaining({ num: '059', count: 4, bulk: 1 }),
    ]);
  });

  it('never keeps more in bulk than owned after a merge', async () => {
    await applyInventoryPayload('SOR', { '059': 1, '059@bulk': 3 }, set, database);
    expect(await database.owned.get('SOR:059')).toMatchObject({ count: 1, bulk: 1 });
  });
});
