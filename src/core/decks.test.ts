import { describe, expect, it } from 'vitest';
import {
  createSavedDeck,
  deriveOwnedTotals,
  emptyDeckLibrary,
  loadDeckLibrary,
  parseDeckLibrary,
  persistDeckLibrary,
  type DeckLibrary,
  type SavedDeck,
} from './decks';
import type { ResolvedDeckRow } from './decklist';
import type { PreconCatalogEntry } from './precons';

function row(partial: Partial<ResolvedDeckRow> & Pick<ResolvedDeckRow, 'role' | 'setKey' | 'baseNumber' | 'count'>): ResolvedDeckRow {
  return { name: 'Card', price: 0, ambiguous: false, ...partial };
}

function fakeStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

describe('createSavedDeck', () => {
  const validRows: ResolvedDeckRow[] = [
    row({ role: 'leader', setKey: 'SOR', baseNumber: 1, count: 1 }),
    row({ role: 'base', setKey: 'SOR', baseNumber: 2, count: 1 }),
    row({ role: 'deck', setKey: 'SOR', baseNumber: 3, count: 3 }),
  ];

  it('fails when rows have no leader/base', () => {
    const result = createSavedDeck([], { name: 'x', physical: false, copies: 1, sourceText: '' });
    expect(result).toEqual({ ok: false, reason: 'missing-leader' });
  });

  it('builds a SavedDeck with generated id/timestamps and trimmed name', () => {
    const result = createSavedDeck(validRows, { name: '  My Deck  ', physical: true, copies: 2, sourceText: 'raw' }, {
      now: () => '2026-07-29T00:00:00.000Z',
      makeId: () => 'deck-1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.deck).toEqual({
      id: 'deck-1',
      name: 'My Deck',
      createdAt: '2026-07-29T00:00:00.000Z',
      updatedAt: '2026-07-29T00:00:00.000Z',
      physical: true,
      copies: 2,
      sourceText: 'raw',
      leader: { setKey: 'SOR', baseNumber: 1, count: 1 },
      secondLeader: undefined,
      base: { setKey: 'SOR', baseNumber: 2, count: 1 },
      mainDeck: [{ setKey: 'SOR', baseNumber: 3, count: 3 }],
      sideboard: [],
    });
  });

  it('defaults an untitled name and floors/clamps copies to at least 1', () => {
    const result = createSavedDeck(validRows, { name: '   ', physical: false, copies: 0, sourceText: '' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.deck.name).toBe('Untitled deck');
    expect(result.deck.copies).toBe(1);
  });
});

describe('deriveOwnedTotals', () => {
  const preconCatalog: PreconCatalogEntry[] = [
    {
      key: 'SOR-heroism',
      label: 'SOR Heroism',
      setKey: 'SOR',
      aspect: 'Heroism',
      file: 'SOR-heroism.json',
      contents: {
        leader: { setKey: 'SOR', baseNumber: 1, count: 1 },
        base: { setKey: 'SOR', baseNumber: 2, count: 1 },
        mainDeck: [{ setKey: 'SOR', baseNumber: 3, count: 3 }],
        sideboard: [],
      },
    },
  ];

  const physicalDeck: SavedDeck = {
    id: 'd1',
    name: 'Boxed deck',
    createdAt: '',
    updatedAt: '',
    physical: true,
    copies: 1,
    sourceText: '',
    leader: { setKey: 'JTL', baseNumber: 10, count: 1 },
    base: { setKey: 'JTL', baseNumber: 11, count: 1 },
    mainDeck: [{ setKey: 'JTL', baseNumber: 12, count: 2 }],
    sideboard: [],
  };

  const referenceDeck: SavedDeck = { ...physicalDeck, id: 'd2', physical: false };

  it('contributes nothing when nothing is owned or physical', () => {
    const totals = deriveOwnedTotals({ customDecks: [referenceDeck], preconOwnership: {} }, preconCatalog);
    expect(totals).toEqual({});
  });

  it('sums owned precon contents', () => {
    const totals = deriveOwnedTotals({ customDecks: [], preconOwnership: { 'SOR-heroism': 1 } }, preconCatalog);
    expect(totals).toEqual({ SOR: { 1: 1, 2: 1, 3: 3 } });
  });

  it('sums physical custom decks but ignores reference decks', () => {
    const library: DeckLibrary = {
      customDecks: [physicalDeck, referenceDeck],
      preconOwnership: {},
    };
    const totals = deriveOwnedTotals(library, preconCatalog);
    expect(totals).toEqual({ JTL: { 10: 1, 11: 1, 12: 2 } });
  });

  it('combines precon ownership and physical decks across sets', () => {
    const library: DeckLibrary = {
      customDecks: [physicalDeck],
      preconOwnership: { 'SOR-heroism': 1 },
    };
    const totals = deriveOwnedTotals(library, preconCatalog);
    expect(totals).toEqual({
      SOR: { 1: 1, 2: 1, 3: 3 },
      JTL: { 10: 1, 11: 1, 12: 2 },
    });
  });
});

describe('parseDeckLibrary / persistence', () => {
  it('returns an empty library for null/invalid input', () => {
    expect(parseDeckLibrary(null)).toEqual(emptyDeckLibrary);
    expect(parseDeckLibrary('not json')).toEqual(emptyDeckLibrary);
    expect(parseDeckLibrary('[]')).toEqual(emptyDeckLibrary);
  });

  it('filters out malformed saved decks but keeps valid ones', () => {
    const valid: SavedDeck = {
      id: 'd1',
      name: 'Valid',
      createdAt: '',
      updatedAt: '',
      physical: false,
      copies: 1,
      sourceText: '',
      leader: { setKey: 'SOR', baseNumber: 1, count: 1 },
      base: { setKey: 'SOR', baseNumber: 2, count: 1 },
      mainDeck: [],
      sideboard: [],
    };
    const raw = JSON.stringify({
      customDecks: [valid, { id: 'bad' }],
      preconOwnership: { 'SOR-heroism': 1, bad: 'x' },
    });
    expect(parseDeckLibrary(raw)).toEqual({ customDecks: [valid], preconOwnership: {} });
  });

  it('round-trips through loadDeckLibrary/persistDeckLibrary', () => {
    const storage = fakeStorage();
    const library: DeckLibrary = { customDecks: [], preconOwnership: { 'SOR-heroism': 1 } };
    expect(persistDeckLibrary(storage, library)).toBe(true);
    expect(loadDeckLibrary(storage)).toEqual(library);
  });

  it('loadDeckLibrary recovers to empty on a storage read error', () => {
    const storage = {
      getItem: () => {
        throw new Error('boom');
      },
    };
    expect(loadDeckLibrary(storage)).toEqual(emptyDeckLibrary);
  });
});
