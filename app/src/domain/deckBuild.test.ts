import { describe, expect, it } from 'vitest';

import {
  adjustInBox,
  applyConstruct,
  applyDeconstruct,
  available,
  deckStatus,
  heldVariants,
  inPlace,
  planConstruct,
  pulledTotals,
  requiredCounts,
  type HomeLookup,
} from './deckBuild';
import type { DeckLibrary, SavedDeck } from './decks';
import { sumVariants, type VariantCounts } from './ownership';

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
    // Leader #1, base #19, 3× #33, sideboard 1× #40.
    leader: ref(1, 1),
    base: ref(19, 1),
    mainDeck: [ref(33, 3)],
    sideboard: [ref(40, 1)],
    ...over,
  };
}

const library = (...decks: SavedDeck[]): DeckLibrary => ({
  customDecks: decks,
  preconOwnership: {},
});

type Spec = number | VariantCounts;
const asVariants = (value: Spec | undefined): VariantCounts =>
  value === undefined ? {} : typeof value === 'number' ? { normal: value } : value;

/**
 * Copies per base number whose home is the binder, and the bulk box. A plain number means
 * that many Normals.
 */
const owning =
  (binder: Record<number, Spec>, bulk: Record<number, Spec> = {}): HomeLookup =>
  (_setKey, base) => ({ binder: asVariants(binder[base]), bulk: asVariants(bulk[base]) });

const FULL = [ref(1, 1), ref(19, 1), ref(33, 3)];
const boxOf = (lib: DeckLibrary, id: string) =>
  lib.customDecks.find((d) => d.id === id)!.pulledCards;

describe('requiredCounts', () => {
  it('leaves the sideboard out unless asked', () => {
    expect([...requiredCounts(deck('a')).keys()]).toEqual(['SOR:1', 'SOR:19', 'SOR:33']);
    expect(requiredCounts(deck('a'), true).get('SOR:40')).toBe(1);
  });
});

describe('binder availability', () => {
  it('is owned minus what built decks hold; unbuilt decks hold nothing', () => {
    const lib = library(
      deck('a', { constructed: true, pulledCards: [ref(33, 2)] }),
      deck('b', { constructed: false, pulledCards: [ref(33, 3)] }),
    );
    expect(pulledTotals(lib).get('SOR:33')).toBe(2);
    expect(available(owning({ 33: 3 }), lib)('SOR', 33)).toEqual({ binder: 1, bulk: 0 });
    expect(available(owning({ 33: 1 }), lib)('SOR', 33)).toEqual({ binder: 0, bulk: 0 });
  });

  it('never offers a Prestige Serialized to a deck', () => {
    const owned = owning({ 33: { normal: 1, 'prestige-serialized': 1 } });
    expect(available(owned, library())('SOR', 33).binder).toBe(1);
  });
});

describe('deckStatus', () => {
  it('is complete when the box holds leader, base and main — sideboard ignored', () => {
    const a = deck('a', { constructed: true, pulledCards: FULL });
    expect(deckStatus(a, library(a), owning({ 1: 1, 19: 1, 33: 3 }))).toEqual({
      state: 'complete',
    });
  });

  it('splits missing cards into ones you own elsewhere and ones you do not', () => {
    // Box is short two #33. One more is owned (in the binder); the other is not.
    const a = deck('a', { constructed: true, pulledCards: [ref(1, 1), ref(19, 1), ref(33, 1)] });
    expect(deckStatus(a, library(a), owning({ 1: 1, 19: 1, 33: 2 }))).toEqual({
      state: 'partial',
      missingOwned: 1,
      missingInBulk: 0,
      missingUnowned: 1,
    });
  });

  it('counts copies held by another built deck as owned', () => {
    const a = deck('a', { constructed: true, pulledCards: [ref(1, 1), ref(19, 1), ref(33, 2)] });
    const b = deck('b', { constructed: true, pulledCards: [ref(33, 1)] });
    expect(deckStatus(a, library(a, b), owning({ 1: 1, 19: 1, 33: 3 }))).toMatchObject({
      missingOwned: 1,
      missingUnowned: 0,
    });
  });
});

describe('planConstruct', () => {
  it('takes from the binder first, then offers other built decks, then the rest is unowned', () => {
    const a = deck('a');
    const b = deck('b', { constructed: true, pulledCards: [ref(33, 1)] });
    // Own 2 Death Troopers: one in the binder, one in deck B. Need 3.
    const lines = planConstruct(a, library(a, b), owning({ 1: 1, 19: 1, 33: 2 }), false);
    expect(lines.find((l) => l.baseNumber === 33)).toEqual({
      setKey: 'SOR',
      baseNumber: 33,
      need: 3,
      fromBinder: 1,
      fromBulk: 0,
      bulkPrintings: {},
      fromDecks: [{ deckId: 'b', deckName: 'B', available: 1 }],
      unowned: 1,
    });
  });

  it('only plans what a partly built deck is still missing', () => {
    const a = deck('a', { constructed: true, pulledCards: [ref(1, 1), ref(19, 1), ref(33, 2)] });
    const lines = planConstruct(a, library(a), owning({ 1: 1, 19: 1, 33: 3 }), false);
    expect(lines).toEqual([
      {
        setKey: 'SOR',
        baseNumber: 33,
        need: 1,
        fromBinder: 1,
        fromBulk: 0,
        bulkPrintings: {},
        fromDecks: [],
        unowned: 0,
      },
    ]);
  });
});

describe('which printings a deck holds', () => {
  const owned = owning({ 33: { normal: 2, prestige: 1 } });

  it('pulls the most valuable printing from the binder, and records it', () => {
    const next = applyConstruct(library(deck('a')), 'a', [ref(33, 1)], [], owned);
    expect(boxOf(next, 'a')).toEqual([ref(33, 1, { prestige: 1 })]);
    expect(inPlace(owned, next)('SOR', 33).binder).toEqual({ normal: 2, prestige: 0 });
  });

  it('puts back exactly what a deck took, whatever order decks are built and broken', () => {
    // A takes the Prestige, then B takes a Normal.
    let lib = applyConstruct(library(deck('a'), deck('b')), 'a', [ref(33, 1)], [], owned);
    lib = applyConstruct(lib, 'b', [ref(33, 1)], [], owned);
    expect(boxOf(lib, 'b')).toEqual([ref(33, 1, { normal: 1 })]);

    // Breaking A must return the Prestige — not reshuffle B's Normal into a Prestige.
    lib = applyDeconstruct(lib, 'a');
    expect(inPlace(owned, lib)('SOR', 33).binder).toEqual({ normal: 1, prestige: 1 });
    expect(heldVariants(lib).get('SOR:33')).toEqual({ normal: 1 });
  });

  it('moves the exact printing when one deck takes from another', () => {
    let lib = applyConstruct(library(deck('a'), deck('b')), 'a', [ref(33, 2)], [], owned);
    expect(boxOf(lib, 'a')).toEqual([ref(33, 2, { prestige: 1, normal: 1 })]);

    lib = applyConstruct(
      lib,
      'b',
      [],
      [{ deckId: 'a', setKey: 'SOR', baseNumber: 33, count: 1 }],
      owned,
    );
    // The most valuable copy moves, and A stays built without it.
    expect(boxOf(lib, 'b')).toEqual([ref(33, 1, { prestige: 1 })]);
    expect(boxOf(lib, 'a')).toEqual([ref(33, 1, { normal: 1 })]);
    expect(lib.customDecks[0]!.constructed).toBe(true);
  });

  it('keeps printings an intake batch already decided', () => {
    const next = applyConstruct(
      library(deck('a')),
      'a',
      [ref(33, 3, { hyperspace: 1, normal: 2 })],
      [],
      owned,
    );
    expect(boxOf(next, 'a')).toEqual([ref(33, 3, { hyperspace: 1, normal: 2 })]);
  });

  it('reads a record without printings as Normal binder copies', () => {
    const a = deck('a', { constructed: true, pulledCards: [ref(33, 1)] });
    expect(heldVariants(library(a)).get('SOR:33')).toEqual({ normal: 1 });
  });

  it('never pulls a Prestige Serialized', () => {
    const withSerialized = owning({ 33: { normal: 1, 'prestige-serialized': 1 } });
    const next = applyConstruct(library(deck('a')), 'a', [ref(33, 1)], [], withSerialized);
    expect(boxOf(next, 'a')).toEqual([ref(33, 1, { normal: 1 })]);
  });
});

describe('applyConstruct', () => {
  it('adds to what a partly built deck already holds', () => {
    const a = deck('a', { constructed: true, pulledCards: [ref(33, 2, { normal: 2 })] });
    const next = applyConstruct(library(a), 'a', [ref(33, 1)], [], owning({ 33: 3 }));
    expect(boxOf(next, 'a')).toEqual([ref(33, 3, { normal: 3 })]);
  });
});

describe('box edits', () => {
  it('deconstruct empties the box', () => {
    const a = deck('a', { constructed: true, pulledCards: FULL });
    expect(applyDeconstruct(library(a), 'a').customDecks[0]).toMatchObject({
      constructed: false,
      pulledCards: [],
    });
  });

  it('− files back the least valuable copy; + takes the most valuable from the binder', () => {
    const owned = owning({ 33: { normal: 2, hyperspace: 1, prestige: 1 } });
    const a = deck('a', {
      constructed: true,
      pulledCards: [ref(33, 3, { prestige: 1, hyperspace: 1, normal: 1 })],
    });
    const down = adjustInBox(library(a), 'a', 'SOR', 33, -1, 3, owned);
    expect(boxOf(down, 'a')).toEqual([ref(33, 2, { prestige: 1, hyperspace: 1 })]);

    const up = adjustInBox(down, 'a', 'SOR', 33, 1, 3, owned);
    expect(boxOf(up, 'a')).toEqual([ref(33, 3, { prestige: 1, hyperspace: 1, normal: 1 })]);
  });

  it('is clamped to what the deck lists, and to what the binder has', () => {
    const owned = owning({ 33: 3 });
    const full = deck('a', { constructed: true, pulledCards: [ref(33, 3, { normal: 3 })] });
    expect(adjustInBox(library(full), 'a', 'SOR', 33, 1, 3, owned)).toEqual(library(full));

    const partial = deck('a', { constructed: true, pulledCards: [ref(33, 1, { normal: 1 })] });
    // Binder has 2 left, but the deck only lists one more slot… and with none left, + does nothing.
    const none = adjustInBox(library(partial), 'a', 'SOR', 33, 1, 3, owning({ 33: 1 }));
    expect(boxOf(none, 'a')).toEqual([ref(33, 1, { normal: 1 })]);

    const gone = adjustInBox(library(partial), 'a', 'SOR', 33, -1, 3, owned);
    expect(boxOf(gone, 'a')).toEqual([]);
  });
});

describe('stored printings', () => {
  it('survive the deck library round trip, and malformed ones are rejected', async () => {
    const { parseDeckLibrary } = await import('./decks');
    const good = deck('a', {
      constructed: true,
      pulledCards: [ref(33, 2, { prestige: 1, normal: 1 })],
    });
    const bad = deck('b', {
      constructed: true,
      pulledCards: [{ setKey: 'SOR', baseNumber: 33, count: 1, variants: { shiny: 1 } as never }],
    });
    const parsed = parseDeckLibrary(JSON.stringify(library(good, bad)));
    expect(parsed.customDecks.map((d) => d.id)).toEqual(['a']);
    expect(parsed.customDecks[0]!.pulledCards).toEqual([ref(33, 2, { prestige: 1, normal: 1 })]);
  });
});

describe('the bulk box', () => {
  // One Normal in the binder; a Normal and a Hyperspace in the bulk box.
  const homes = owning({ 33: 1 }, { 33: { normal: 1, hyperspace: 1 } });

  it('is planned after the binder and before other decks', () => {
    const a = deck('a');
    const b = deck('b', { constructed: true, pulledCards: [ref(33, 1, { normal: 1 })] });
    // Two Normals at home in the binder, one of them out in deck B; one in the bulk box.
    const lines = planConstruct(a, library(a, b), owning({ 33: 2 }, { 33: 1 }), false);
    expect(lines.find((l) => l.baseNumber === 33)).toMatchObject({
      fromBinder: 1,
      fromBulk: 1,
      bulkPrintings: { normal: 1 },
      fromDecks: [{ deckId: 'b', available: 1 }],
      unowned: 0,
    });
  });

  it('records which copies came from it, and leaves the binder copy out of its count', () => {
    const next = applyConstruct(library(deck('a')), 'a', [ref(33, 3)], [], homes);
    expect(boxOf(next, 'a')).toEqual([
      ref(33, 3, { normal: 2, hyperspace: 1 }, { normal: 1, hyperspace: 1 }),
    ]);
    const left = inPlace(homes, next)('SOR', 33);
    expect(sumVariants(left.binder) + sumVariants(left.bulk)).toBe(0);
    // Breaking the deck sends each copy home.
    const back = applyDeconstruct(next, 'a');
    expect(inPlace(homes, back)('SOR', 33)).toEqual(homes('SOR', 33));
  });

  it('counts toward a partial deck as "in bulk"', () => {
    const a = deck('a', { constructed: true, pulledCards: [ref(1, 1), ref(19, 1), ref(33, 1)] });
    expect(deckStatus(a, library(a), owning({ 1: 1, 19: 1, 33: 1 }, { 33: 1 }))).toEqual({
      state: 'partial',
      missingOwned: 0,
      missingInBulk: 1,
      missingUnowned: 1,
    });
  });

  it('+ falls back to it when the binder is out; − sends a bulk copy back first', () => {
    const a = deck('a', { constructed: true, pulledCards: [ref(33, 1, { normal: 1 })] });
    const up = adjustInBox(library(a), 'a', 'SOR', 33, 1, 3, homes);
    expect(boxOf(up, 'a')).toEqual([ref(33, 2, { normal: 1, hyperspace: 1 }, { hyperspace: 1 })]);
    const down = adjustInBox(up, 'a', 'SOR', 33, -1, 3, homes);
    expect(boxOf(down, 'a')).toEqual([ref(33, 1, { normal: 1 })]);
  });

  it('travels with a copy one deck takes from another', () => {
    const a = deck('a', {
      constructed: true,
      pulledCards: [ref(33, 1, { hyperspace: 1 }, { hyperspace: 1 })],
    });
    const lib = applyConstruct(
      library(a, deck('b')),
      'b',
      [],
      [{ deckId: 'a', setKey: 'SOR', baseNumber: 33, count: 1 }],
      homes,
    );
    expect(boxOf(lib, 'b')).toEqual([ref(33, 1, { hyperspace: 1 }, { hyperspace: 1 })]);
  });
});
