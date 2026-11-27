import { describe, expect, it } from 'vitest';

import type { HomeLookup } from './deckBuild';
import type { DeckLibrary, SavedDeck } from './decks';
import { deckUpgrades, libraryUpgrades, upgradeCount } from './deckUpgrades';
import type { VariantCounts } from './ownership';

const ref = (
  baseNumber: number,
  count: number,
  variants?: VariantCounts,
  fromBulk?: VariantCounts,
) => ({
  setKey: 'SOR',
  baseNumber,
  count,
  ...(variants && { variants }),
  ...(fromBulk && { fromBulk }),
});

const deck = (id: string, pulled: ReturnType<typeof ref>[], built = true): SavedDeck => ({
  id,
  name: id.toUpperCase(),
  createdAt: '',
  updatedAt: '',
  physical: false,
  copies: 1,
  sourceText: '',
  constructed: built,
  pulledCards: pulled,
  leader: ref(1, 1),
  base: ref(19, 1),
  mainDeck: [ref(33, 3)],
  sideboard: [],
});

const library = (...decks: SavedDeck[]): DeckLibrary => ({
  customDecks: decks,
  preconOwnership: {},
});

/** Whole-collection homes per base number: what is owned, binder-homed and bulk-homed. */
const owning =
  (binder: Record<number, VariantCounts>, bulk: Record<number, VariantCounts> = {}): HomeLookup =>
  (_setKey, base) => ({ binder: binder[base] ?? {}, bulk: bulk[base] ?? {} });

describe('deckUpgrades', () => {
  it('flags a binder Hyperspace for a deck holding only Normals', () => {
    // Three Normals all in the deck, then one Hyperspace scanned into the binder.
    const lib = library(deck('a', [ref(33, 3, { normal: 3 })]));
    const homes = owning({ 33: { normal: 3, hyperspace: 1 } });
    expect(deckUpgrades(lib.customDecks[0]!, lib, homes)).toEqual([
      { setKey: 'SOR', baseNumber: 33, from: 'normal', to: 'hyperspace', count: 1 },
    ]);
  });

  it('pairs the best binder copy with the deck’s weakest', () => {
    const lib = library(deck('a', [ref(33, 3, { normal: 2, foil: 1 })]));
    const homes = owning({ 33: { normal: 2, foil: 1, hyperspace: 1, showcase: 1 } });
    const found = deckUpgrades(lib.customDecks[0]!, lib, homes);
    expect(found).toEqual([
      { setKey: 'SOR', baseNumber: 33, from: 'normal', to: 'showcase', count: 1 },
      { setKey: 'SOR', baseNumber: 33, from: 'normal', to: 'hyperspace', count: 1 },
    ]);
    expect(upgradeCount(found)).toBe(2);
  });

  it('counts any better printing, however small the step', () => {
    const lib = library(deck('a', [ref(33, 1, { normal: 1 })]));
    expect(
      deckUpgrades(lib.customDecks[0]!, lib, owning({ 33: { normal: 1, foil: 1 } })),
    ).toHaveLength(1);
  });

  it('never offers a copy no better than the deck’s own', () => {
    const lib = library(deck('a', [ref(33, 3, { hyperspace: 3 })]));
    const homes = owning({ 33: { hyperspace: 3, normal: 2, foil: 1 } });
    expect(deckUpgrades(lib.customDecks[0]!, lib, homes)).toEqual([]);
  });

  it('ignores copies held by another deck', () => {
    const a = deck('a', [ref(33, 1, { normal: 1 })]);
    const b = deck('b', [ref(33, 1, { hyperspace: 1 })]);
    const homes = owning({ 33: { normal: 1, hyperspace: 1 } });
    expect(deckUpgrades(a, library(a, b), homes)).toEqual([]);
  });

  it('ignores better copies sitting in the bulk box', () => {
    const lib = library(deck('a', [ref(33, 1, { normal: 1 })]));
    const homes = owning({ 33: { normal: 1 } }, { 33: { hyperspace: 1 } });
    expect(deckUpgrades(lib.customDecks[0]!, lib, homes)).toEqual([]);
  });

  it('never offers a Prestige Serialized', () => {
    const lib = library(deck('a', [ref(33, 1, { normal: 1 })]));
    const homes = owning({ 33: { normal: 1, 'prestige-serialized': 1 } });
    expect(deckUpgrades(lib.customDecks[0]!, lib, homes)).toEqual([]);
  });

  it('upgrades a deck copy that was pulled from the bulk box', () => {
    const lib = library(deck('a', [ref(33, 1, { normal: 1 }, { normal: 1 })]));
    const homes = owning({ 33: { hyperspace: 1 } }, { 33: { normal: 1 } });
    expect(deckUpgrades(lib.customDecks[0]!, lib, homes)).toHaveLength(1);
  });

  it('treats a record with no variants as Normals', () => {
    const lib = library(deck('a', [ref(33, 1)]));
    const homes = owning({ 33: { normal: 1, hyperspace: 1 } });
    expect(deckUpgrades(lib.customDecks[0]!, lib, homes)[0]).toMatchObject({ from: 'normal' });
  });

  it('finds nothing for a deck that is not built', () => {
    const lib = library(deck('a', [ref(33, 1, { normal: 1 })], false));
    const homes = owning({ 33: { normal: 1, hyperspace: 1 } });
    expect(deckUpgrades(lib.customDecks[0]!, lib, homes)).toEqual([]);
  });
});

describe('libraryUpgrades across decks', () => {
  const twoDecks = () => {
    // Two built decks, three Normals each; the binder pocket holds the rest.
    const a = deck('a', [ref(33, 3, { normal: 3 })]);
    const b = deck('b', [ref(33, 3, { normal: 3 })]);
    return { a, b, lib: library(a, b) };
  };

  it('offers each binder copy to one deck only', () => {
    const { lib } = twoDecks();
    const homes = owning({ 33: { normal: 6, hyperspace: 3 } });
    const found = libraryUpgrades(lib, homes);
    // Three Hyperspaces, not six swaps: the first deck takes them all.
    expect(upgradeCount(found.get('a') ?? [])).toBe(3);
    expect(found.get('b')).toBeUndefined();
  });

  it('splits copies between decks once the first has had its share', () => {
    const a = deck('a', [ref(33, 1, { normal: 1 })]);
    const b = deck('b', [ref(33, 3, { normal: 3 })]);
    const homes = owning({ 33: { normal: 4, hyperspace: 3 } });
    const found = libraryUpgrades(library(a, b), homes);
    expect(upgradeCount(found.get('a') ?? [])).toBe(1);
    expect(upgradeCount(found.get('b') ?? [])).toBe(2);
  });

  it('gives a copy to the deck it improves most, whatever the library order', () => {
    const a = deck('a', [ref(33, 1, { hyperspace: 1 })]);
    const b = deck('b', [ref(33, 1, { normal: 1 })]);
    const homes = owning({ 33: { hyperspace: 1, normal: 1, showcase: 1 } });
    const found = libraryUpgrades(library(a, b), homes);
    expect(found.get('b')).toEqual([
      { setKey: 'SOR', baseNumber: 33, from: 'normal', to: 'showcase', count: 1 },
    ]);
    expect(found.get('a')).toBeUndefined();
  });

  it('never offers more copies than the binder holds, in total', () => {
    const { lib } = twoDecks();
    const homes = owning({ 33: { normal: 6, hyperspace: 2 } });
    const total = [...libraryUpgrades(lib, homes).values()].flat();
    expect(upgradeCount(total)).toBe(2);
  });
});
