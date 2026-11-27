import { describe, expect, it } from 'vitest';

import {
  adjustInBox,
  applyConstruct,
  applyDeckEdit,
  applyDeconstruct,
  deckStatus,
  editLoanReturns,
  heldByHome,
  inBoxCounts,
  lentFromPrecon,
  planConstruct,
  preconFills,
  preconReleases,
  type HomeLookup,
} from './deckBuild';
import {
  parseDeckLibrary,
  preconDeckId,
  withoutPrecons,
  withPrecons,
  type DeckLibrary,
  type SavedDeck,
} from './decks';
import type { PreconCatalogEntry } from './precons';

const ref = (baseNumber: number, count: number) => ({ setKey: 'SOR', baseNumber, count });

/** Leader #1, base #19, 3× #33, 2× #50 — a sealed precon. */
const PRECON: PreconCatalogEntry = {
  key: 'sor-test',
  label: 'Test Precon',
  setKey: 'SOR',
  aspect: 'Heroism',
  file: 'sor-test.json',
  contents: {
    leader: ref(1, 1),
    base: ref(19, 1),
    mainDeck: [ref(33, 3), ref(50, 2)],
    sideboard: [],
  },
};
const PRECON_ID = preconDeckId(PRECON.key);

function deck(id: string, over: Partial<SavedDeck> = {}): SavedDeck {
  return {
    id,
    name: id.toUpperCase(),
    createdAt: '',
    updatedAt: '',
    physical: false,
    copies: 1,
    sourceText: '',
    constructed: false,
    pulledCards: [],
    // Leader #2, base #20, 2× #50 — the #50s are only in the precon.
    leader: ref(2, 1),
    base: ref(20, 1),
    mainDeck: [ref(50, 2)],
    sideboard: [],
    ...over,
  };
}

const NOTHING: HomeLookup = () => ({ binder: {}, bulk: {} });
const binder =
  (counts: Record<number, number>): HomeLookup =>
  (_setKey, base) => ({ binder: { normal: counts[base] ?? 0 }, bulk: {} });

const owned = (...decks: SavedDeck[]): DeckLibrary =>
  withPrecons({ customDecks: decks, preconOwnership: { [PRECON.key]: 1 } }, [PRECON]);

const byId = (library: DeckLibrary, id: string) => library.customDecks.find((d) => d.id === id)!;

/** B has its leader and base in the binder and takes both #50s from the precon. */
function borrowed() {
  const b = deck('b');
  const lib = owned(b);
  const plan = planConstruct(b, lib, binder({ 2: 1, 20: 1 }), false);
  const line = plan.find((l) => l.baseNumber === 50)!;
  return {
    plan,
    line,
    lib: applyConstruct(
      lib,
      'b',
      [ref(2, 1), ref(20, 1)],
      [{ deckId: PRECON_ID, setKey: 'SOR', baseNumber: 50, count: line.fromDecks[0]!.available }],
      binder({ 2: 1, 20: 1 }),
    ),
  };
}

describe('an owned precon as a deck', () => {
  it('stands in as a complete, built deck after the saved ones', () => {
    const lib = owned(deck('b'));
    expect(lib.customDecks.map((d) => d.id)).toEqual(['b', PRECON_ID]);
    const precon = byId(lib, PRECON_ID);
    expect(precon).toMatchObject({ name: 'Test Precon', constructed: true, precon: PRECON.key });
    expect(deckStatus(precon, lib, NOTHING)).toEqual({ state: 'complete' });
    expect([...inBoxCounts(precon, lib)]).toEqual([
      ['SOR:1', 1],
      ['SOR:19', 1],
      ['SOR:33', 3],
      ['SOR:50', 2],
    ]);
  });

  it('is absent while the precon is not owned', () => {
    const lib = withPrecons({ customDecks: [], preconOwnership: { [PRECON.key]: 0 } }, [PRECON]);
    expect(lib.customDecks).toEqual([]);
  });

  it('is derived: saving the library stores no stand-in', () => {
    const lib = owned(deck('b'));
    expect(withoutPrecons(lib).customDecks.map((d) => d.id)).toEqual(['b']);
  });
});

describe('taking a card from a precon', () => {
  it('offers the precon only after the binder, bulk and your other built decks', () => {
    const b = deck('b');
    const other = deck('other', { constructed: true, pulledCards: [ref(50, 1)] });
    const lib = owned(b, other);
    const line = planConstruct(b, lib, NOTHING, false).find((l) => l.baseNumber === 50)!;
    expect(line.fromDecks).toEqual([
      { deckId: 'other', deckName: 'OTHER', available: 1 },
      { deckId: PRECON_ID, deckName: 'Test Precon', available: 1, precon: true },
    ]);
    expect(line.unowned).toBe(0);
  });

  it('marks the precon as missing the card and the deck as holding it', () => {
    const { lib } = borrowed();
    expect(byId(lib, 'b').borrowed).toEqual([
      { preconKey: PRECON.key, setKey: 'SOR', baseNumber: 50, count: 2 },
    ]);
    expect(deckStatus(byId(lib, 'b'), lib, binder({ 2: 1, 20: 1 }))).toEqual({
      state: 'complete',
    });
    // The precon is short two #50 — owned, just sitting in B.
    expect(deckStatus(byId(lib, PRECON_ID), lib, NOTHING)).toEqual({
      state: 'partial',
      missingOwned: 2,
      missingInBulk: 0,
      missingInPrecon: 0,
      missingUnowned: 0,
    });
    expect(lentFromPrecon(lib, PRECON.key).get('SOR:50')).toBe(2);
  });

  it('keeps the precon out of the binder: nothing is held from it', () => {
    const { lib } = borrowed();
    // B's box holds only its own leader and base; the lent cards have no binder home.
    expect(byId(lib, 'b').pulledCards.map((r) => r.baseNumber)).toEqual([2, 20]);
  });

  it('does not let another deck take what a deck borrowed', () => {
    const { lib } = borrowed();
    const c = deck('c');
    const line = planConstruct(
      c,
      { ...lib, customDecks: [...lib.customDecks, c] },
      NOTHING,
      false,
    ).find((l) => l.baseNumber === 50)!;
    expect(line.fromDecks).toEqual([]);
    expect(line.unowned).toBe(2);
  });

  it('shows a deck short of a card that only a precon has', () => {
    const b = deck('b', { constructed: true, pulledCards: [ref(2, 1), ref(20, 1)] });
    const lib = owned(b);
    expect(deckStatus(byId(lib, 'b'), lib, NOTHING)).toEqual({
      state: 'partial',
      missingOwned: 0,
      missingInBulk: 0,
      missingInPrecon: 2,
      missingUnowned: 0,
    });
  });
});

describe('putting a borrowing deck away', () => {
  it('returns each card to its precon, which is complete again', () => {
    const { lib } = borrowed();
    const after = applyDeconstruct(lib, 'b');
    expect(byId(after, 'b')).not.toHaveProperty('borrowed');
    expect(byId(after, 'b').constructed).toBe(false);
    expect(deckStatus(byId(after, PRECON_ID), after, NOTHING)).toEqual({ state: 'complete' });
  });

  it('returns a card when − takes it out of the deck, before any binder copy', () => {
    const { lib } = borrowed();
    const once = adjustInBox(lib, 'b', 'SOR', 50, -1, 2, NOTHING);
    expect(byId(once, 'b').borrowed).toEqual([
      { preconKey: PRECON.key, setKey: 'SOR', baseNumber: 50, count: 1 },
    ]);
    const twice = adjustInBox(once, 'b', 'SOR', 50, -1, 2, NOTHING);
    expect(byId(twice, 'b')).not.toHaveProperty('borrowed');
    expect(deckStatus(byId(twice, PRECON_ID), twice, NOTHING)).toEqual({ state: 'complete' });
  });

  it('returns what a changed list no longer holds', () => {
    const { lib } = borrowed();
    const contents = { ...byId(lib, 'b'), mainDeck: [ref(50, 1)] };
    expect(editLoanReturns(lib, 'b', contents)).toEqual([
      { preconKey: PRECON.key, setKey: 'SOR', baseNumber: 50, count: 1 },
    ]);
    const edited = applyDeckEdit(lib, 'b', {
      contents,
      format: 'premier',
      name: 'B',
      sourceText: '',
    });
    expect(byId(edited, 'b').borrowed).toEqual([
      { preconKey: PRECON.key, setKey: 'SOR', baseNumber: 50, count: 1 },
    ]);
  });
});

describe('rebuilding precons before going home', () => {
  /** B borrowed both #50s; C holds two #50 from the binder, and is about to be put away. */
  function setup() {
    const { lib } = borrowed();
    const c = deck('c', {
      constructed: true,
      leader: ref(3, 1),
      base: ref(21, 1),
      pulledCards: [{ ...ref(50, 2), variants: { normal: 2 } }],
    });
    return { ...lib, customDecks: [...lib.customDecks, c] };
  }

  it('puts a card a precon is missing back in it, not in the binder', () => {
    const lib = setup();
    const after = applyDeconstruct(lib, 'c');
    expect(deckStatus(byId(after, PRECON_ID), after, NOTHING)).toEqual({ state: 'complete' });
    expect(byId(after, 'c').pulledCards).toEqual([]);
    expect(preconFills(lib, after)).toEqual([
      {
        preconKey: PRECON.key,
        setKey: 'SOR',
        baseNumber: 50,
        homes: { binder: { normal: 2 }, bulk: {} },
      },
    ]);
    // The copies stay out of the binder's pocket while they sit in the precon.
    expect(heldByHome(after).get('SOR:50')?.binder).toEqual({ normal: 2 });
  });

  it('only takes what the precon is short of; the rest goes home', () => {
    const lib = setup();
    const c = byId(lib, 'c');
    const more = {
      ...lib,
      customDecks: lib.customDecks.map((d) =>
        d.id === 'c' ? { ...c, pulledCards: [{ ...ref(50, 3), variants: { normal: 3 } }] } : d,
      ),
    };
    const after = applyDeconstruct(more, 'c');
    expect(preconFills(more, after)[0]?.homes).toEqual({ binder: { normal: 2 }, bulk: {} });
  });

  it('prefers the precon even when it is the loan that comes back later', () => {
    const lib = setup();
    const afterC = applyDeconstruct(lib, 'c');
    // B hands its borrowed #50s back: the precon already holds copies, so they are surplus.
    const afterB = applyDeconstruct(afterC, 'b');
    expect(byId(afterB, PRECON_ID).pulledCards).toEqual([]);
    expect(preconReleases(afterC, afterB)[0]?.homes).toEqual({
      binder: { normal: 2 },
      bulk: {},
    });
  });

  it('does the same for cards an edited list drops', () => {
    const lib = setup();
    const c = byId(lib, 'c');
    const edited = applyDeckEdit(lib, 'c', {
      contents: { ...c, mainDeck: [] },
      format: 'premier',
      name: 'C',
      sourceText: '',
    });
    expect(deckStatus(byId(edited, PRECON_ID), edited, NOTHING)).toEqual({ state: 'complete' });
  });

  it('leaves cards no precon is missing to go home', () => {
    const c = deck('c', {
      constructed: true,
      pulledCards: [{ ...ref(50, 2), variants: { normal: 2 } }],
    });
    const lib = owned(c);
    const after = applyDeconstruct(lib, 'c');
    expect(preconFills(lib, after)).toEqual([]);
    expect(byId(after, PRECON_ID).pulledCards).toEqual([]);
  });
});

describe('refilling a precon', () => {
  it('pulls from the binder like any deck and is kept in the library', () => {
    const { lib } = borrowed();
    const homes = binder({ 50: 2 });
    const plan = planConstruct(byId(lib, PRECON_ID), lib, homes, false);
    expect(plan).toEqual([expect.objectContaining({ baseNumber: 50, need: 2, fromBinder: 2 })]);

    const refilled = applyConstruct(lib, PRECON_ID, [ref(50, 2)], [], homes);
    expect(deckStatus(byId(refilled, PRECON_ID), refilled, homes)).toEqual({ state: 'complete' });
    // Only the pulled-in cards are stored; the list itself always comes from the catalog.
    const stored = withoutPrecons(refilled);
    expect(stored.customDecks.map((d) => d.id)).toEqual(['b', PRECON_ID]);
    expect(byId(stored, PRECON_ID).pulledCards).toEqual([
      { setKey: 'SOR', baseNumber: 50, count: 2, variants: { normal: 2 } },
    ]);
    // …and it comes back as the same deck on the next read.
    const reread = withPrecons(parseDeckLibrary(JSON.stringify(stored)), [PRECON]);
    expect(deckStatus(byId(reread, PRECON_ID), reread, homes)).toEqual({ state: 'complete' });
  });

  it('sends the extra copy home once the borrowed card is back', () => {
    const { lib } = borrowed();
    const homes = binder({ 50: 2 });
    const refilled = applyConstruct(lib, PRECON_ID, [ref(50, 2)], [], homes);
    const after = applyDeconstruct(refilled, 'b');
    // The precon is whole from its own copies; the refill copies are no longer in its box.
    expect(byId(after, PRECON_ID).pulledCards).toEqual([]);
    expect(preconReleases(refilled, after)).toEqual([
      {
        preconKey: PRECON.key,
        setKey: 'SOR',
        baseNumber: 50,
        homes: { binder: { normal: 2 }, bulk: {} },
      },
    ]);
    expect(deckStatus(byId(after, PRECON_ID), after, homes)).toEqual({ state: 'complete' });
  });

  it('is forgotten when the precon is no longer owned', () => {
    const { lib } = borrowed();
    const refilled = applyConstruct(lib, PRECON_ID, [ref(50, 2)], [], binder({ 50: 2 }));
    const stored = withoutPrecons(refilled);
    const unowned = withPrecons({ ...stored, preconOwnership: { [PRECON.key]: 0 } }, [PRECON]);
    expect(unowned.customDecks.map((d) => d.id)).toEqual(['b']);
  });

  it('is left alone when the catalog did not load, so a save cannot lose it', () => {
    const { lib } = borrowed();
    const refilled = applyConstruct(lib, PRECON_ID, [ref(50, 2)], [], binder({ 50: 2 }));
    const stored = withoutPrecons(refilled);
    expect(withPrecons(stored, []).customDecks.map((d) => d.id)).toEqual(['b', PRECON_ID]);
  });
});

describe('libraries saved before precons were decks', () => {
  it('read as they always did: no loans, no precon decks', () => {
    const old = JSON.stringify({
      customDecks: [deck('b', { constructed: true, pulledCards: [ref(2, 1)] })],
      preconOwnership: { [PRECON.key]: 1 },
    });
    const lib = parseDeckLibrary(old);
    expect(lib.customDecks).toHaveLength(1);
    expect(lib.customDecks[0]).not.toHaveProperty('borrowed');
    expect(withoutPrecons(withPrecons(lib, [PRECON]))).toEqual(lib);
  });

  it('keeps loans through a save and reload, and drops malformed ones', () => {
    const { lib } = borrowed();
    const json = JSON.stringify(withoutPrecons(lib));
    expect(byId(parseDeckLibrary(json), 'b').borrowed).toHaveLength(1);

    const bad = JSON.parse(json) as { customDecks: Array<Record<string, unknown>> };
    bad.customDecks[0]!.borrowed = [{ preconKey: 1 }, 'x'];
    expect(parseDeckLibrary(JSON.stringify(bad)).customDecks[0]).not.toHaveProperty('borrowed');
  });

  it('keeps a loan on a deck an older build deconstructed from being counted', () => {
    // An older build clears the box but leaves `borrowed` behind; unbuilt, it counts for nothing.
    const { lib } = borrowed();
    const stale = {
      ...lib,
      customDecks: lib.customDecks.map((d) =>
        d.id === 'b' ? { ...d, constructed: false, pulledCards: [] } : d,
      ),
    };
    expect(lentFromPrecon(stale, PRECON.key).size).toBe(0);
    expect(deckStatus(byId(stale, PRECON_ID), stale, NOTHING)).toEqual({ state: 'complete' });
  });
});
