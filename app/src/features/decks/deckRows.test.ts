import { describe, expect, it } from 'vitest';

import type { SavedDeck } from '~/domain/decks';

import type { Card } from '~/domain/types';

import { cardKind, cardsNeeded, deckAspects, formatLabel, orderDeckRows } from './deckRows';

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

describe('cardKind', () => {
  it('names a unit by its arena', () => {
    expect(cardKind('Unit', ['Ground'])).toBe('Ground unit');
    expect(cardKind('Unit', ['Space'])).toBe('Space unit');
  });

  it('gives upgrades and events their type', () => {
    expect(cardKind('Upgrade', undefined)).toBe('Upgrade');
    expect(cardKind('Event', undefined)).toBe('Event');
  });

  it('leaves leaders and bases to their role', () => {
    expect(cardKind('Leader', ['Ground'])).toBeUndefined();
    expect(cardKind('Base', undefined)).toBeUndefined();
  });
});

describe('orderDeckRows', () => {
  type Row = Parameters<typeof orderDeckRows>[0][number];
  const row = (name: string, over: Partial<Row>): Row => ({ role: 'deck', name, ...over });

  it('lists leader and base, then each zone by ground, space, events, upgrades, then cost', () => {
    const rows = [
      row('Upgrade', { type: 'Upgrade', cost: 1 }),
      row('Side event', { role: 'sideboard', type: 'Event', cost: 1 }),
      row('Big ground', { type: 'Unit', arenas: ['Ground'], cost: 5 }),
      row('Event', { type: 'Event', cost: 2 }),
      row('Fighter', { type: 'Unit', arenas: ['Space'], cost: 2 }),
      row('Base', { role: 'base', type: 'Base' }),
      row('Small ground', { type: 'Unit', arenas: ['Ground'], cost: 2 }),
      row('Leader', { role: 'leader', type: 'Leader', cost: 6 }),
    ];
    const ordered = orderDeckRows(rows);
    expect(ordered.map((e) => e.row.name)).toEqual([
      'Leader',
      'Base',
      'Small ground',
      'Big ground',
      'Fighter',
      'Event',
      'Upgrade',
      'Side event',
    ]);
    // Each still knows where it was, for columns aligned with the input.
    expect(ordered.map((e) => e.index)).toEqual([7, 5, 6, 2, 4, 3, 0, 1]);
  });
});
