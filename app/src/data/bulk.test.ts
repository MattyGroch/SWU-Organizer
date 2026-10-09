import { beforeEach, describe, expect, it } from 'vitest';

import { parseSetCatalog, toLoadedSet, type VariantSlug } from '~/domain/catalog';

import { mergeDeckLibraries } from '~/domain/syncMerge';

import {
  bulkAdjust,
  eraseEverything,
  removeFromBulkBox,
  resetCollection,
  restoreErased,
  restoreSnapshot,
} from './bulk';
import { SwuDatabase, type StackCardRow } from './db';
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

describe('remove from the bulk box', () => {
  let database: SwuDatabase;

  beforeEach(async () => {
    database = new SwuDatabase(`test-${crypto.randomUUID()}`);
    await database.open();
  });

  const own = (num: string, variant: VariantSlug, count: number, bulk: number) =>
    database.owned.put({
      id: `SOR:${num}`,
      setKey: 'SOR',
      base: 59,
      num,
      variant,
      count,
      ...(bulk && { bulk }),
      updatedAt: 0,
    });
  const rows = async () =>
    Object.fromEntries((await database.owned.toArray()).map((r) => [r.id, [r.count, r.bulk ?? 0]]));

  it('takes copies from the box only, leaving the binder alone', async () => {
    await own('059', 'normal', 5, 2);
    await own('324', 'hyperspace', 1, 1);
    const { removed } = await removeFromBulkBox(
      'SOR',
      59,
      { normal: 2, hyperspace: 1 },
      {
        database,
      },
    );
    expect(removed).toBe(3);
    expect(await rows()).toEqual({ 'SOR:059': [3, 0] });
  });

  it('never takes more than the box holds', async () => {
    await own('059', 'normal', 4, 1);
    const { removed } = await removeFromBulkBox('SOR', 59, { normal: 3 }, { database });
    expect(removed).toBe(1);
    expect(await rows()).toEqual({ 'SOR:059': [3, 0] });
  });

  it('undo puts the copies back in the box', async () => {
    await own('059', 'normal', 4, 2);
    const { undo } = await removeFromBulkBox('SOR', 59, { normal: 1 }, { database });
    expect(await rows()).toEqual({ 'SOR:059': [3, 1] });
    await restoreSnapshot(undo, database);
    expect(await rows()).toEqual({ 'SOR:059': [4, 2] });
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

  describe('erase everything', () => {
    beforeEach(async () => {
      const library = await readDeckLibrary(database);
      await writeDeckLibraryQuietly({ ...library, preconOwnership: { 'SOR-vader': 1 } }, database);
      await database.intakeBatches.add({ id: 'b', kind: 'scan', label: 'Scans', createdAt: 0 });
      await database.intakeLines.add({
        id: 'l',
        batchId: 'b',
        setKey: 'SOR',
        base: 1,
        num: '001',
        variant: 'normal',
        count: 1,
        order: 0,
      });
      await database.stacks.add({ id: 's', label: 'Stack', createdAt: 0, step: 0 });
      await database.stackCards.add({ id: 'c', stackId: 's', seq: 0 } as StackCardRow);
    });

    it('empties cards, decks, precons, intake and stacks', async () => {
      await eraseEverything({ database, now: Date.parse('2026-10-05T00:00:00Z') });

      expect(await database.owned.count()).toBe(0);
      expect(await database.intakeBatches.count()).toBe(0);
      expect(await database.intakeLines.count()).toBe(0);
      expect(await database.stacks.count()).toBe(0);
      expect(await database.stackCards.count()).toBe(0);
      const library = await readDeckLibrary(database);
      expect(library.customDecks).toEqual([]);
      expect(library.preconOwnership).toEqual({ 'SOR-vader': 0 });
      expect(Object.keys(library.deletedDecks ?? {}).sort()).toEqual(['hmw-deck', 'sor-deck']);
    });

    it('does not let a sync bring the old decks or precons back', async () => {
      const before = await readDeckLibrary(database);
      await eraseEverything({ database });
      const merged = mergeDeckLibraries(await readDeckLibrary(database), before, before);
      expect(merged.customDecks).toEqual([]);
      expect(merged.preconOwnership).toEqual({ 'SOR-vader': 0 });
    });

    it('undo puts everything back, with decks newer than their deletions', async () => {
      const erased = await eraseEverything({ database, now: Date.parse('2026-10-05T00:00:00Z') });
      const deletedLibrary = await readDeckLibrary(database);
      await restoreErased(erased, { database, now: Date.parse('2026-10-05T00:01:00Z') });

      expect(await database.owned.count()).toBe(2);
      expect(await database.intakeLines.count()).toBe(1);
      expect(await database.stackCards.count()).toBe(1);
      const library = await readDeckLibrary(database);
      expect(library.customDecks.map((d) => d.id)).toEqual(['sor-deck', 'hmw-deck']);
      expect(library.preconOwnership).toEqual({ 'SOR-vader': 1 });

      const merged = mergeDeckLibraries(library, deletedLibrary, deletedLibrary);
      expect(merged.customDecks).toHaveLength(2);
    });
  });
});
