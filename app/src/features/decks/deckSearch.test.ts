import { describe, expect, it } from 'vitest';

import { buildCardPool } from '~/domain/deckLegality';
import type { Card } from '~/domain/types';

import { DEFAULT_FILTERS, fitsAspects, searchCards, type SearchInput } from './deckSearch';

const card = (Number: number, over: Partial<Card>): Card => ({
  Name: `Card ${Number}`,
  Number,
  Set: '',
  Type: 'Unit',
  ...over,
});

const sets = [
  {
    setKey: 'SOR',
    baseCards: [
      card(1, { Name: 'Old Leader', Type: 'Leader', Aspects: ['Vigilance', 'Villainy'] }),
      card(2, { Name: 'Rotated Unit', Cost: 2 }),
      card(3, { Name: 'Vanquish', Type: 'Event', Cost: 5, Aspects: ['Vigilance'] }),
    ],
  },
  {
    setKey: 'LAW',
    baseCards: [
      card(10, { Name: 'Vanquish', Type: 'Event', Cost: 5, Aspects: ['Vigilance'] }),
      card(11, {
        Name: 'Stormtrooper',
        Cost: 2,
        Aspects: ['Villainy'],
        Traits: ['IMPERIAL', 'TROOPER'],
      }),
      card(12, { Name: 'Big Gun', Cost: 9, Aspects: ['Aggression'], Text: 'Overwhelm' }),
      card(13, { Name: 'Neutral Droid', Cost: 1 }),
      card(14, { Name: 'Double Vig', Cost: 3, Aspects: ['Vigilance', 'Vigilance'] }),
      card(15, { Name: 'Echo Base', Type: 'Base', Aspects: ['Vigilance'] }),
    ],
  },
];

const input = (over: Partial<SearchInput> = {}): SearchInput => ({
  sets,
  mode: 'cards',
  filters: { ...DEFAULT_FILTERS, ownedOnly: false, inAspect: false },
  format: 'eternal',
  pool: buildCardPool(sets),
  deckAspects: ['Vigilance', 'Vigilance', 'Villainy'],
  owned: (setKey, base) => (setKey === 'LAW' && base === 11 ? 3 : 0),
  ...over,
});

const names = (over: Partial<SearchInput>) =>
  searchCards(input(over)).map((h) => `${h.card.Name}@${h.setKey}`);

describe('fitsAspects', () => {
  it('needs one deck icon per card icon; neutrals always fit', () => {
    expect(fitsAspects(['Vigilance', 'Vigilance'], ['Vigilance', 'Vigilance'])).toBe(true);
    expect(fitsAspects(['Vigilance', 'Vigilance'], ['Vigilance', 'Villainy'])).toBe(false);
    expect(fitsAspects(undefined, [])).toBe(true);
  });
});

describe('searchCards', () => {
  it('lists deck cards by cost, never leaders or bases', () => {
    expect(names({})).toEqual([
      'Neutral Droid@LAW',
      'Rotated Unit@SOR',
      'Stormtrooper@LAW',
      'Double Vig@LAW',
      'Vanquish@LAW',
      'Vanquish@SOR',
      'Big Gun@LAW',
    ]);
  });

  it('Premier leaves out rotated cards but keeps a rotated printing of a reprint', () => {
    expect(names({ format: 'premier' })).not.toContain('Rotated Unit@SOR');
    expect(names({ format: 'premier' })).toContain('Vanquish@SOR');
  });

  it('filters by owned, aspect, type, cost and text', () => {
    const filters = { ...DEFAULT_FILTERS, ownedOnly: false, inAspect: false };
    expect(names({ filters: { ...filters, ownedOnly: true } })).toEqual(['Stormtrooper@LAW']);
    expect(names({ filters: { ...filters, inAspect: true } })).not.toContain('Big Gun@LAW');
    expect(names({ filters: { ...filters, inAspect: true } })).toContain('Double Vig@LAW');
    expect(names({ filters: { ...filters, types: ['Event'] } })).toEqual([
      'Vanquish@LAW',
      'Vanquish@SOR',
    ]);
    expect(names({ filters: { ...filters, costs: [7] } })).toEqual(['Big Gun@LAW']);
    expect(names({ filters: { ...filters, text: 'trooper' } })).toEqual(['Stormtrooper@LAW']);
    expect(names({ filters: { ...filters, text: 'overwhelm' } })).toEqual(['Big Gun@LAW']);
  });

  it('leader and base modes list only those, whatever their aspects', () => {
    expect(names({ mode: 'leader' })).toEqual(['Old Leader@SOR']);
    expect(names({ mode: 'leader', format: 'premier' })).toEqual([]);
    expect(names({ mode: 'base', filters: { ...DEFAULT_FILTERS, ownedOnly: false } })).toEqual([
      'Echo Base@LAW',
    ]);
  });
});
