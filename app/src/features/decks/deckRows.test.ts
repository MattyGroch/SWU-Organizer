import { describe, expect, it } from 'vitest';

import type { SavedDeck } from '~/domain/decks';

import type { Card } from '~/domain/types';

import { cardsNeeded, deckAspects, formatLabel } from './deckRows';

const ref = (baseNumber: number, count: number) => ({ setKey: 'SOR', baseNumber, count });

function deck(over: Partial<SavedDeck>): SavedDeck {
  return {
    id: 'd',
    name: 'Deck',
    createdAt: '',
    updatedAt: '',
    physical: false,
    copies: 1,
    sourceText: '',
    constructed: false,
    pulledCards: [],
    leader: ref(1, 1),
    base: ref(19, 1),
    mainDeck: [ref(33, 3)],
    sideboard: [ref(40, 1)],
    ...over,
  };
}

describe('cardsNeeded', () => {
  it('counts copies to buy, leaving the sideboard out', () => {
    const owned = (_set: string, base: number) => (base === 33 ? 1 : 0);
    // Leader 1 + base 1 + 2 Death Troopers; the sideboard card does not count.
    expect(cardsNeeded(deck({}), owned)).toBe(4);
  });
});

describe('formatLabel', () => {
  it('reads two leaders as Twin Suns', () => {
    expect(formatLabel(deck({}))).toBe('Premier');
    expect(formatLabel(deck({ secondLeader: ref(2, 1) }))).toBe('Twin Suns');
  });
});

describe('deckAspects', () => {
  const card = (Aspects: string[]) => ({ Aspects }) as Card;
  const lookup = new Map([
    [
      'SOR',
      {
        byNumber: new Map([
          [1, card(['Vigilance', 'Villainy'])],
          [2, card(['Aggression', 'Villainy'])],
          [19, card(['Vigilance'])],
        ]),
        baseCards: [],
      },
    ],
  ]);

  it('lists leader then base aspects, with the affiliation last', () => {
    expect(deckAspects(deck({}), lookup)).toEqual(['Vigilance', 'Vigilance', 'Villainy']);
  });

  it('shows a shared Twin Suns affiliation once', () => {
    expect(deckAspects(deck({ secondLeader: ref(2, 1) }), lookup)).toEqual([
      'Vigilance',
      'Aggression',
      'Vigilance',
      'Villainy',
    ]);
  });

  it('skips cards missing from the catalog', () => {
    expect(deckAspects(deck({ base: ref(99, 1) }), lookup)).toEqual(['Vigilance', 'Villainy']);
  });
});
