import { beforeEach, describe, expect, it } from 'vitest';

import type { SavedDeck } from '~/domain/decks';

import { SwuDatabase } from './db';
import { deconstructDeck, editDeck, readDeckLibrary, writeDeckLibraryQuietly } from './deckLibrary';

const ref = (baseNumber: number, count: number) => ({ setKey: 'SOR', baseNumber, count });

const deck: SavedDeck = {
  id: 'a',
  name: 'A',
  createdAt: '',
  updatedAt: '',
  physical: false,
  copies: 1,
  sourceText: '',
  constructed: true,
  // Two Hyperspace from the binder, one Normal from the bulk box.
  pulledCards: [{ ...ref(33, 3), variants: { hyperspace: 2, normal: 1 }, fromBulk: { normal: 1 } }],
  leader: ref(1, 1),
  base: ref(19, 1),
  mainDeck: [ref(33, 3)],
  sideboard: [],
};

describe('deconstructDeck', () => {
  let database: SwuDatabase;

  beforeEach(async () => {
    database = new SwuDatabase(`test-${crypto.randomUUID()}`);
    await database.open();
    await writeDeckLibraryQuietly({ customDecks: [deck], preconOwnership: {} }, database);
  });

  const put = (num: string, variant: 'normal' | 'hyperspace', count: number, bulk?: number) =>
    database.owned.put({
      id: `SOR:${num}`,
      setKey: 'SOR',
      base: 33,
      num,
      variant,
      count,
      ...(bulk !== undefined && { bulk }),
      updatedAt: 0,
    });
  const row = async (num: string) => {
    const r = await database.owned.get(`SOR:${num}`);
    return [r?.count, r?.bulk ?? 0];
  };

  it('sends each copy home, changing nothing when the pocket has room', async () => {
    await put('298', 'hyperspace', 2);
    await put('033', 'normal', 1, 1);
    expect(await deconstructDeck('a', () => 3, database)).toBe(0);
    expect((await readDeckLibrary(database)).customDecks[0]).toMatchObject({ constructed: false });
    expect(await row('298')).toEqual([2, 0]);
    expect(await row('033')).toEqual([1, 1]);
  });

  it('a pocket that filled up meanwhile keeps its best playset; the rest go to bulk', async () => {
    // While the deck was out, two more Normals were filed in the pocket.
    await put('298', 'hyperspace', 2);
    await put('033', 'normal', 3, 1);
    expect(await deconstructDeck('a', () => 3, database)).toBe(1);
    expect(await row('298')).toEqual([2, 0]);
    expect(await row('033')).toEqual([3, 2]);
  });
});

describe('editDeck', () => {
  let database: SwuDatabase;

  beforeEach(async () => {
    database = new SwuDatabase(`test-${crypto.randomUUID()}`);
    await database.open();
    await writeDeckLibraryQuietly({ customDecks: [deck], preconOwnership: {} }, database);
  });

  const edit = (mainDeck: Array<{ setKey: string; baseNumber: number; count: number }>) => ({
    contents: { leader: ref(1, 1), base: ref(19, 1), mainDeck, sideboard: [] },
    format: 'eternal' as const,
    name: 'A',
    sourceText: '',
  });

  it('saves the list and returns the copies it dropped, bulk copy first', async () => {
    await database.owned.put({
      id: 'SOR:298',
      setKey: 'SOR',
      base: 33,
      num: '298',
      variant: 'hyperspace',
      count: 2,
      updatedAt: 0,
    });
    expect(await editDeck('a', edit([ref(33, 2)]), () => 3, database)).toBe(0);
    const saved = (await readDeckLibrary(database)).customDecks[0]!;
    expect(saved).toMatchObject({ constructed: true, format: 'eternal', mainDeck: [ref(33, 2)] });
    expect(saved.pulledCards).toEqual([{ ...ref(33, 2), variants: { hyperspace: 2 } }]);
  });
});
