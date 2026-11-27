import { describe, expect, it } from 'vitest';

import type { DeckStatus } from '~/domain/deckBuild';
import type { SavedDeck } from '~/domain/decks';

import { groupDecks } from './deckGroups';

const deck = (id: string, extra: Partial<SavedDeck> = {}): SavedDeck =>
  ({ id, name: id, ...extra }) as SavedDeck;

const partial: DeckStatus = {
  state: 'partial',
  missingOwned: 1,
  missingInBulk: 0,
  missingInPrecon: 0,
  missingUnowned: 0,
};

describe('groupDecks', () => {
  it('sorts decks into status sections and leaves precons out', () => {
    const decks = [deck('a'), deck('b'), deck('c'), deck('d'), deck('p', { precon: 'x' })];
    const statuses: Record<string, DeckStatus> = {
      a: partial,
      b: { state: 'complete' },
      c: { state: 'unbuilt' },
      d: { state: 'unbuilt' },
      p: { state: 'complete' },
    };
    const needed: Record<string, number> = { c: 0, d: 3 };
    const groups = groupDecks(
      decks,
      (d) => statuses[d.id]!,
      (d) => needed[d.id] ?? 0,
    );
    expect(groups.attention.map((d) => d.id)).toEqual(['a']);
    expect(groups.built.map((d) => d.id)).toEqual(['b']);
    expect(groups.ready.map((d) => d.id)).toEqual(['c']);
    expect(groups.planned.map((d) => d.id)).toEqual(['d']);
  });
});
