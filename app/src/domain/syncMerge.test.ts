import { describe, expect, it } from 'vitest';

import type { DeckLibrary, SavedDeck } from './decks';
import { mergeDeckLibraries, mergeInventory } from './syncMerge';

describe('mergeInventory', () => {
  it('keeps both devices’ changes since they last agreed', () => {
    const base = { '059': 2, '080': 1 };
    const local = { '059': 4, '080': 1 }; // this device added two 059
    const remote = { '059': 2, '080': 0, '324': 1 }; // the other removed 080, added 324
    expect(mergeInventory(local, remote, base)).toEqual({ '059': 4, '324': 1 });
  });

  it('never goes below zero', () => {
    expect(mergeInventory({ '059': 0 }, { '059': 0 }, { '059': 1 })).toEqual({});
  });

  it('takes the higher count, not the sum, when the two never agreed on anything', () => {
    expect(mergeInventory({ '059': 3 }, { '059': 2, '080': 1 }, undefined)).toEqual({
      '059': 3,
      '080': 1,
    });
  });
});

const deck = (id: string, updatedAt: string, name = id): SavedDeck => ({
  id,
  name,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt,
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
const lib = (decks: SavedDeck[], extra: Partial<DeckLibrary> = {}): DeckLibrary => ({
  customDecks: decks,
  preconOwnership: {},
  ...extra,
});

describe('mergeDeckLibraries', () => {
  const T1 = '2026-10-04T10:00:00Z';
  const T2 = '2026-10-04T11:00:00Z';
  const T3 = '2026-10-04T12:00:00Z';

  it('keeps decks from both sides, and the newer edit of a deck changed on both', () => {
    const merged = mergeDeckLibraries(
      lib([deck('a', T2, 'A renamed here'), deck('b', T1)]),
      lib([deck('a', T1, 'A'), deck('c', T1)]),
      lib([deck('a', T1, 'A')]),
    );
    expect(merged.customDecks.map((d) => [d.id, d.name])).toEqual([
      ['a', 'A renamed here'],
      ['b', 'b'],
      ['c', 'c'],
    ]);
  });

  it('does not bring back a deck deleted on the other device', () => {
    const merged = mergeDeckLibraries(
      lib([deck('a', T1)]),
      lib([], { deletedDecks: { a: T2 } }),
      lib([deck('a', T1)]),
    );
    expect(merged.customDecks).toEqual([]);
    expect(merged.deletedDecks).toEqual({ a: T2 });
  });

  it('keeps a deck edited after it was deleted elsewhere', () => {
    const merged = mergeDeckLibraries(
      lib([deck('a', T3, 'edited later')]),
      lib([], { deletedDecks: { a: T2 } }),
      undefined,
    );
    expect(merged.customDecks.map((d) => d.name)).toEqual(['edited later']);
    expect(merged.deletedDecks).toBeUndefined();
  });

  it('keeps this device’s precon changes and the server’s for the rest', () => {
    const merged = mergeDeckLibraries(
      lib([], { preconOwnership: { 'SOR-Vader': 1, 'SOR-Luke': 0 } }),
      lib([], { preconOwnership: { 'SOR-Vader': 0, 'SOR-Luke': 1, 'JTL-Han': 1 } }),
      lib([], { preconOwnership: { 'SOR-Vader': 0, 'SOR-Luke': 0 } }),
    );
    expect(merged.preconOwnership).toEqual({ 'SOR-Vader': 1, 'SOR-Luke': 1, 'JTL-Han': 1 });
  });
});
