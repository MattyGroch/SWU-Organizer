import { beforeEach, describe, expect, it } from 'vitest';

import { newDeck, type SavedDeck } from '~/domain/decks';

import { SwuDatabase } from './db';
import {
  addNewDeck,
  deconstructDeck,
  editDeck,
  readDeckLibrary,
  writeDeckLibraryQuietly,
} from './deckLibrary';

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

describe('a deck copy that outranks a full pocket', () => {
  // The deck holds the Hyperspace; while it was out, the pocket filled with three Normals.
  const hyperspaceDeck: SavedDeck = {
    ...deck,
    pulledCards: [{ ...ref(33, 1), variants: { hyperspace: 1 } }],
    mainDeck: [ref(33, 1)],
  };
  let database: SwuDatabase;

  beforeEach(async () => {
    database = new SwuDatabase(`test-${crypto.randomUUID()}`);
    await database.open();
    await writeDeckLibraryQuietly({ customDecks: [hyperspaceDeck], preconOwnership: {} }, database);
    const owned = { setKey: 'SOR', base: 33, updatedAt: 0 };
    await database.owned.put({
      ...owned,
      id: 'SOR:298',
      num: '298',
      variant: 'hyperspace',
      count: 1,
    });
    await database.owned.put({ ...owned, id: 'SOR:033', num: '033', variant: 'normal', count: 3 });
  });

  const bulkOf = async (num: string) => (await database.owned.get(`SOR:${num}`))?.bulk ?? 0;

  it('takes its place back on deconstruct, bumping a Normal to bulk', async () => {
    expect(await deconstructDeck('a', () => 3, database)).toBe(1);
    expect(await bulkOf('298')).toBe(0);
    expect(await bulkOf('033')).toBe(1);
  });

  it('does the same when an edit drops it from the deck', async () => {
    const dropped = {
      contents: { leader: ref(1, 1), base: ref(19, 1), mainDeck: [], sideboard: [] },
      format: 'eternal' as const,
      name: 'A',
      sourceText: '',
    };
    expect(await editDeck('a', dropped, () => 3, database)).toBe(1);
    expect(await bulkOf('298')).toBe(0);
    expect(await bulkOf('033')).toBe(1);
  });
});

describe('deconstructDeck with owned precons', () => {
  let database: SwuDatabase;

  // A precon whose #33s went to deck B; deck A, holding two #33 from the binder, is put away.
  const precon = {
    key: 'p',
    label: 'Precon',
    setKey: 'SOR',
    aspect: 'Heroism',
    file: 'p.json',
    contents: { leader: ref(2, 1), base: ref(20, 1), mainDeck: [ref(33, 2)], sideboard: [] },
  };
  const b: SavedDeck = {
    ...deck,
    id: 'b',
    constructed: true,
    pulledCards: [],
    borrowed: [{ preconKey: 'p', setKey: 'SOR', baseNumber: 33, count: 2 }],
  };
  const a: SavedDeck = { ...deck, pulledCards: [{ ...ref(33, 2), variants: { normal: 2 } }] };

  beforeEach(async () => {
    database = new SwuDatabase(`test-${crypto.randomUUID()}`);
    await database.open();
    // A library as an older build wrote it: no precon deck stored.
    await writeDeckLibraryQuietly({ customDecks: [a, b], preconOwnership: { p: 1 } }, database);
  });

  it('refills the precon first and stores only those copies, as a deck of its own', async () => {
    await deconstructDeck('a', () => 3, database, Date.now(), [precon]);
    const library = await readDeckLibrary(database);
    expect(library.preconOwnership).toEqual({ p: 1 });
    expect(library.customDecks.map((d) => d.id)).toEqual(['a', 'b', 'precon:p']);
    expect(library.customDecks[0]).toMatchObject({ constructed: false, pulledCards: [] });
    expect(library.customDecks[2]!.pulledCards).toEqual([
      { setKey: 'SOR', baseNumber: 33, count: 2, variants: { normal: 2 } },
    ]);
    // B's loan is untouched.
    expect(library.customDecks[1]!.borrowed).toHaveLength(1);
  });

  it('stores nothing extra when no precon is missing the card', async () => {
    await deconstructDeck('b', () => 3, database, Date.now(), [precon]);
    const library = await readDeckLibrary(database);
    expect(library.customDecks.map((d) => d.id)).toEqual(['a', 'b']);
    expect(library.customDecks[1]).not.toHaveProperty('borrowed');
  });
});

describe('addNewDeck', () => {
  it('adds the deck with the list the editor gave it, once', async () => {
    const database = new SwuDatabase(`test-${crypto.randomUUID()}`);
    await database.open();
    const fresh = newDeck(
      {
        name: 'Fresh',
        format: 'twinSuns',
        leader: ref(1, 1),
        secondLeader: ref(2, 1),
        base: ref(19, 1),
      },
      { makeId: () => 'n', now: () => 't' },
    );
    const edit = {
      contents: { ...fresh, mainDeck: [ref(33, 1)] },
      format: 'twinSuns' as const,
      name: ' Renamed ',
      sourceText: 'list',
    };
    await addNewDeck(fresh, edit, database);
    await addNewDeck(fresh, edit, database);
    const decks = (await readDeckLibrary(database)).customDecks;
    expect(decks).toHaveLength(1);
    expect(decks[0]).toMatchObject({
      id: 'n',
      name: 'Renamed',
      format: 'twinSuns',
      secondLeader: ref(2, 1),
      mainDeck: [ref(33, 1)],
      sourceText: 'list',
      constructed: false,
    });
  });
});
