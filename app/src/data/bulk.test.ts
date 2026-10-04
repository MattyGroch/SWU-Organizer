import { beforeEach, describe, expect, it } from 'vitest';

import { parseSetCatalog, toLoadedSet, type VariantSlug } from '~/domain/catalog';

import { bulkAdjust, resetCollection, restoreSnapshot } from './bulk';
import { SwuDatabase } from './db';
import { readDeckLibrary, writeDeckLibraryQuietly } from './deckLibrary';

const set = toLoadedSet(
  parseSetCatalog({
    setKey: 'SOR',
    label: 'SOR',
    cards: [
      {
        base: 1,
        name: 'Krennic',
        type: 'Leader',
        aspects: [],
        printings: [{ num: '001', variant: 'normal' }],
      },
      {
        base: 59,
        name: '2-1B',
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
const quotaOf = (base: number) => (base === 1 ? 1 : 3);

describe('bulk edits', () => {
  let database: SwuDatabase;

  beforeEach(async () => {
    database = new SwuDatabase(`test-${crypto.randomUUID()}`);
    await database.open();
  });

  const own = (setKey: string, base: number, num: string, variant: VariantSlug, count: number) =>
    database.owned.put({ id: `${setKey}:${num}`, setKey, base, num, variant, count, updatedAt: 0 });
  const counts = async () =>
    Object.fromEntries((await database.owned.toArray()).map((r) => [r.id, r.count]));

  it('+1 adds a Normal copy only to cards short of a playset', async () => {
    await own('SOR', 1, '001', 'normal', 1); // complete leader
    await own('SOR', 59, '324', 'hyperspace', 1);
    const result = await bulkAdjust(set, [1, 59], 'add', quotaOf, { database });
    expect(result.changed).toBe(1);
    expect(await counts()).toEqual({ 'SOR:001': 1, 'SOR:324': 1, 'SOR:059': 1 });
  });

  it('fill counts every printing owned, then tops up with Normals', async () => {
    await own('SOR', 59, '324', 'hyperspace', 2);
    await bulkAdjust(set, [59], 'fillPlayset', quotaOf, { database });
    expect(await counts()).toEqual({ 'SOR:324': 2, 'SOR:059': 1 });
  });

  it('−1 takes the plainest printing first, keeping premium copies', async () => {
    await own('SOR', 59, '324', 'hyperspace', 1);
    await own('SOR', 59, '059F', 'foil', 1);
    await bulkAdjust(set, [59], 'remove', quotaOf, { database });
    expect(await counts()).toEqual({ 'SOR:324': 1 });
  });

  it('clear removes every printing, and undo puts them back', async () => {
    await own('SOR', 59, '059', 'normal', 2);
    await own('SOR', 59, '324', 'hyperspace', 1);
    const { undo } = await bulkAdjust(set, [59], 'clear', quotaOf, { database });
    expect(await database.owned.count()).toBe(0);

    await restoreSnapshot(undo, database);
    expect(await counts()).toEqual({ 'SOR:059': 2, 'SOR:324': 1 });
  });

  it('undo of +1 removes the copies it added', async () => {
    const { undo } = await bulkAdjust(set, [1, 59], 'fillPlayset', quotaOf, { database });
    expect(await database.owned.count()).toBe(2);
    await restoreSnapshot(undo, database);
    expect(await database.owned.count()).toBe(0);
  });
});

describe('reset', () => {
  let database: SwuDatabase;

  const builtDeck = (id: string, setKey: string) => ({
    id,
    name: id,
    createdAt: '',
    updatedAt: '',
    physical: false,
    copies: 1,
    sourceText: '',
    constructed: true,
    pulledCards: [{ setKey, baseNumber: 1, count: 1 }],
    leader: { setKey, baseNumber: 1, count: 1 },
    base: { setKey, baseNumber: 19, count: 1 },
    mainDeck: [],
    sideboard: [],
  });

  beforeEach(async () => {
    database = new SwuDatabase(`test-${crypto.randomUUID()}`);
    await database.open();
    await database.owned.bulkPut([
      {
        id: 'SOR:001',
        setKey: 'SOR',
        base: 1,
        num: '001',
        variant: 'normal',
        count: 1,
        updatedAt: 0,
      },
      {
        id: 'HMW:001',
        setKey: 'HMW',
        base: 1,
        num: '001',
        variant: 'normal',
        count: 2,
        updatedAt: 0,
      },
    ]);
    await writeDeckLibraryQuietly(
      {
        customDecks: [builtDeck('sor-deck', 'SOR'), builtDeck('hmw-deck', 'HMW')],
        preconOwnership: {},
      },
      database,
    );
  });

  it('empties one set and can unbuild only the decks that held its cards', async () => {
    const result = await resetCollection('SOR', { unbuildDecks: true, database });
    expect(result).toMatchObject({ changed: 1, decksUnbuilt: 1 });
    expect((await database.owned.toArray()).map((r) => r.id)).toEqual(['HMW:001']);
    const decks = (await readDeckLibrary(database)).customDecks;
    expect(decks.map((d) => [d.id, d.constructed])).toEqual([
      ['sor-deck', false],
      ['hmw-deck', true],
    ]);
  });

  it('empties everything, leaves decks alone unless asked, and undoes fully', async () => {
    const { undo } = await resetCollection(undefined, { database });
    expect(await database.owned.count()).toBe(0);
    expect((await readDeckLibrary(database)).customDecks.every((d) => d.constructed)).toBe(true);

    await restoreSnapshot(undo, database);
    expect(await database.owned.count()).toBe(2);
  });

  it('undo restores decks it unbuilt', async () => {
    const { undo } = await resetCollection(undefined, { unbuildDecks: true, database });
    expect((await readDeckLibrary(database)).customDecks.some((d) => d.constructed)).toBe(false);
    await restoreSnapshot(undo, database);
    expect((await readDeckLibrary(database)).customDecks.every((d) => d.constructed)).toBe(true);
  });
});
