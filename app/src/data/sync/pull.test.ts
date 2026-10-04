import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseSetCatalog, toLoadedSet } from '~/domain/catalog';
import type { DeckLibrary, SavedDeck } from '~/domain/decks';

import { resetChangeListeners } from '../changes';
import { SwuDatabase } from '../db';
import { readDeckLibrary, writeDeckLibraryQuietly } from '../deckLibrary';

import { createDeckSync } from './decks';
import { createInventorySync } from './inventory';
import { applyPull, needsFirstSyncChoice, resolveFirstSync, type CloudSnapshot } from './pull';

const card = (setKey: string) =>
  toLoadedSet(
    parseSetCatalog({
      setKey,
      label: setKey,
      cards: [
        {
          base: 59,
          name: 'Card',
          type: 'Unit',
          aspects: [],
          printings: [
            { num: '059', variant: 'normal' },
            { num: '324', variant: 'hyperspace' },
          ],
        },
      ],
    }),
    new Map(),
  );
const sets = new Map([
  ['SOR', card('SOR')],
  ['HMW', card('HMW')],
]);

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

const deck = (id: string): SavedDeck => ({
  id,
  name: id,
  createdAt: '2026-10-04T00:00:00Z',
  updatedAt: '2026-10-04T00:00:00Z',
  physical: false,
  copies: 1,
  sourceText: '',
  constructed: false,
  pulledCards: [],
  leader: { setKey: 'SOR', baseNumber: 1, count: 1 },
  base: { setKey: 'SOR', baseNumber: 19, count: 1 },
  mainDeck: [],
  sideboard: [],
});

const empty: DeckLibrary = { customDecks: [], preconOwnership: {} };
const cloud = (
  inventories: CloudSnapshot['inventories'] = {},
  decks: CloudSnapshot['decks'] = { data: empty, version: 0 },
): CloudSnapshot => ({ inventories, decks });

describe('pulling and first sync', () => {
  let database: SwuDatabase;
  let bundle: {
    inventory: ReturnType<typeof createInventorySync>;
    decks: ReturnType<typeof createDeckSync>;
  };

  beforeEach(async () => {
    database = new SwuDatabase(`test-${crypto.randomUUID()}`);
    await database.open();
    // Sign-in is never set here, so queued writes stay queued and nothing is sent.
    const fetchFn = vi.fn() as unknown as typeof fetch;
    bundle = {
      inventory: createInventorySync({
        getSet: (key) => sets.get(key),
        storage: memoryStorage(),
        fetchFn,
        database,
      }),
      decks: createDeckSync({ storage: memoryStorage(), fetchFn, database }),
    };
  });

  afterEach(() => {
    bundle.inventory.dispose();
    bundle.decks.dispose();
    resetChangeListeners();
  });

  const own = (setKey: string, num: string, count: number) =>
    database.owned.put({
      id: `${setKey}:${num}`,
      setKey,
      base: 59,
      num,
      variant: num === '324' ? 'hyperspace' : 'normal',
      count,
      updatedAt: 0,
    });
  const counts = async () =>
    Object.fromEntries((await database.owned.toArray()).map((r) => [r.id, r.count]));

  it('uploads everything when the cloud is empty', async () => {
    await own('SOR', '059', 2);
    await writeDeckLibraryQuietly({ ...empty, customDecks: [deck('a')] }, database);

    expect(await needsFirstSyncChoice(bundle, cloud(), database)).toBe(false);
    await applyPull(bundle, cloud(), database);

    expect(bundle.inventory.getState().pending.SOR).toEqual({ '059': 2 });
    expect(bundle.decks.getState().pending.library?.customDecks.map((d) => d.id)).toEqual(['a']);
  });

  it('downloads everything onto an empty device', async () => {
    await applyPull(
      bundle,
      cloud(
        { HMW: { data: { '059': 3 }, version: 4 } },
        { data: { ...empty, customDecks: [deck('b')] }, version: 2 },
      ),
      database,
    );
    expect(await counts()).toEqual({ 'HMW:059': 3 });
    expect((await readDeckLibrary(database)).customDecks.map((d) => d.id)).toEqual(['b']);
    expect(bundle.inventory.getState().versions.HMW).toBe(4);
  });

  it('asks only when a never-synced device and the cloud both hold data', async () => {
    const both = cloud({ HMW: { data: { '059': 1 }, version: 1 } });
    await own('SOR', '059', 1);
    expect(await needsFirstSyncChoice(bundle, both, database)).toBe(true);

    bundle.inventory.markPulled();
    expect(await needsFirstSyncChoice(bundle, both, database)).toBe(false);
  });

  describe('when both sides hold data', () => {
    const both = cloud({
      SOR: { data: { '059': 1, '324': 1 }, version: 5 },
      HMW: { data: { '059': 2 }, version: 2 },
    });

    beforeEach(async () => {
      await own('SOR', '059', 3);
      await own('LAW', '059', 1);
    });

    it('merge keeps the higher count of each printing from both sides', async () => {
      await resolveFirstSync(bundle, both, 'merge', database);
      expect(await counts()).toMatchObject({ 'SOR:059': 3, 'SOR:324': 1 });
      expect(bundle.inventory.getState().pending.SOR).toEqual({ '059': 3, '324': 1 });
      expect(bundle.inventory.getState().pending.HMW).toEqual({ '059': 2 });
      expect(bundle.inventory.getState().pending.LAW).toEqual({ '059': 1 });
      // Pushed at the server's version, against the copy the server actually holds.
      expect(bundle.inventory.getState().versions.SOR).toBe(5);
      expect(bundle.inventory.getState().base.SOR).toEqual({ '059': 1, '324': 1 });
    });

    it('use the cloud replaces this device, including removing what only it had', async () => {
      await resolveFirstSync(bundle, both, 'cloud', database);
      expect(await counts()).toEqual({ 'SOR:059': 1, 'SOR:324': 1, 'HMW:059': 2 });
      expect(bundle.inventory.hasPending()).toBe(false);
    });

    it('use this device sends it up, emptying sets only the cloud had', async () => {
      await resolveFirstSync(bundle, both, 'device', database);
      const { pending, versions } = bundle.inventory.getState();
      expect(pending.SOR).toEqual({ '059': 3 });
      expect(pending.HMW).toEqual({});
      expect(versions.HMW).toBe(2);
      expect(await counts()).toEqual({ 'SOR:059': 3, 'LAW:059': 1 });
    });
  });
});
