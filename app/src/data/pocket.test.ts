import { beforeEach, describe, expect, it } from 'vitest';

import { parseSetCatalog, toLoadedSet, type LoadedSet } from '~/domain/catalog';
import type { SavedDeck } from '~/domain/decks';

import { SwuDatabase } from './db';
import { writeDeckLibraryQuietly } from './deckLibrary';
import { printingFor } from './inventory';
import {
  addToBulk,
  addToPocket,
  clearPocket,
  fillPocket,
  removeFromPocket,
  restoreCard,
} from './pocket';

const set: LoadedSet = toLoadedSet(
  parseSetCatalog({
    setKey: 'SOR',
    label: 'Spark of Rebellion (SOR)',
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
const normal = printingFor(set, 59, 'normal')!;
const foil = printingFor(set, 59, 'foil')!;
const hyperspace = printingFor(set, 59, 'hyperspace')!;

describe('binder pocket edits', () => {
  let database: SwuDatabase;

  beforeEach(async () => {
    database = new SwuDatabase(`test-${crypto.randomUUID()}`);
    await database.open();
  });

  /** `[count, bulk]` for each printing that has a row. */
  const rows = async () =>
    Object.fromEntries(
      (await database.owned.where({ setKey: 'SOR', base: 59 }).toArray()).map((row) => [
        row.variant,
        [row.count, row.bulk ?? 0],
      ]),
    );
  const own = (printing: typeof normal, count: number, bulk = 0) =>
    database.owned.put({
      id: `SOR:${printing.num}`,
      setKey: 'SOR',
      base: 59,
      num: printing.num,
      variant: printing.variant,
      count,
      ...(bulk ? { bulk } : {}),
      updatedAt: 0,
    });
  const add = (printing: typeof normal) => addToPocket('SOR', 59, printing, 3, database);

  it('adds while the pocket has room', async () => {
    expect((await add(normal)).kind).toBe('room');
    expect(await rows()).toEqual({ normal: [1, 0] });
  });

  it('refuses a copy that does not fit and beats nothing', async () => {
    await own(foil, 3);
    expect((await add(normal)).kind).toBe('full');
    expect((await add(foil)).kind).toBe('full');
    expect(await rows()).toEqual({ foil: [3, 0] });
  });

  it('add to bulk puts a copy in the box and leaves the pocket alone', async () => {
    await own(normal, 3, 1);
    await addToBulk('SOR', 59, normal, database);
    await addToBulk('SOR', 59, foil, database);
    expect(await rows()).toEqual({ normal: [4, 2], foil: [1, 1] });
  });

  it('a better printing bumps the weakest copy to bulk', async () => {
    await own(normal, 2);
    await own(foil, 1);
    expect(await add(hyperspace)).toMatchObject({ kind: 'upgrade', replaces: 'normal' });
    expect(await rows()).toEqual({ normal: [2, 1], foil: [1, 0], hyperspace: [1, 0] });
  });

  it('bulk copies take no room in the pocket', async () => {
    await own(normal, 4, 2);
    expect((await add(normal)).kind).toBe('room');
    expect(await rows()).toEqual({ normal: [5, 2] });
  });

  it('copies out in decks leave room in the pocket', async () => {
    await own(normal, 3);
    const deck: SavedDeck = {
      id: 'deck-1',
      name: 'Droids',
      createdAt: '',
      updatedAt: '',
      physical: false,
      copies: 1,
      sourceText: '',
      constructed: true,
      pulledCards: [{ setKey: 'SOR', baseNumber: 59, count: 1, variants: { normal: 1 } }],
      leader: { setKey: 'SOR', baseNumber: 1, count: 1 },
      base: { setKey: 'SOR', baseNumber: 19, count: 1 },
      mainDeck: [{ setKey: 'SOR', baseNumber: 59, count: 1 }],
      sideboard: [],
    };
    await writeDeckLibraryQuietly({ customDecks: [deck], preconOwnership: {} }, database);
    expect((await add(normal)).kind).toBe('room');
  });

  it('undo puts back the bumped copy and takes out the new one', async () => {
    await own(normal, 3);
    const result = await add(hyperspace);
    await restoreCard(result.before, database);
    expect(await rows()).toEqual({ normal: [3, 0] });
  });

  it('minus only takes from the pocket', async () => {
    await own(normal, 2, 1);
    expect(await removeFromPocket('SOR', 59, 'normal', database)).toBe(true);
    expect(await rows()).toEqual({ normal: [1, 1] });
    expect(await removeFromPocket('SOR', 59, 'normal', database)).toBe(false);
    expect(await rows()).toEqual({ normal: [1, 1] });
  });

  it('fill tops the pocket up to a playset, ignoring bulk', async () => {
    await own(foil, 1);
    await own(normal, 2, 2);
    expect(await fillPocket('SOR', 59, normal, 3, database)).toBe(2);
    expect(await rows()).toEqual({ foil: [1, 0], normal: [4, 2] });
    expect(await fillPocket('SOR', 59, normal, 3, database)).toBe(0);
  });

  it('clear empties the pocket but keeps bulk, and undoes exactly', async () => {
    await own(normal, 3, 1);
    await own(foil, 1);
    const { removed, before } = await clearPocket('SOR', 59, database);
    expect(removed).toBe(3);
    expect(await rows()).toEqual({ normal: [1, 1] });
    await restoreCard(before, database);
    expect(await rows()).toEqual({ normal: [3, 1], foil: [1, 0] });
  });
});
