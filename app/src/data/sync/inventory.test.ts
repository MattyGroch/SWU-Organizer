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

  it('accepts unpadded base numbers from an older cloud backup', async () => {
    // The legacy app synced base numbers like "59"; the catalog spells it "059".
    await applyInventoryPayload('SOR', { '59': 4 }, set, database);

    const rows = await database.owned.toArray();
    expect(rows[0]).toMatchObject({ num: '059', variant: 'normal', count: 4 });
  });

  it('drops entries that no longer resolve, without failing the rest', async () => {
    await applyInventoryPayload('SOR', { '059': 2, '9999': 1, bad: 3 }, set, database);

    const rows = await database.owned.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.num).toBe('059');
  });

  it('leaves the set alone when the catalog is unavailable', async () => {
    await adjustPrinting('SOR', 59, printingFor(set, 59, 'normal')!, 3, database);
    await applyInventoryPayload('SOR', { '324': 9 }, undefined, database);

    // A catalog that failed to load must not be able to wipe a collection.
    expect((await database.owned.toArray())[0]!.count).toBe(3);
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
