import { describe, expect, it } from 'vitest';

import { EMPTY_FILTERS, type Filters } from '~/features/binder/cardRows';

import { filterBulkRows, matchesBulkFilters, type BulkFilters } from './bulkFilters';
import { groupBulkRows, type BulkRow } from './bulkRows';

function row(over: Partial<BulkRow> & Pick<BulkRow, 'setKey' | 'base'>): BulkRow {
  return {
    name: `${over.setKey} ${over.base}`,
    aspects: [],
    inBox: { normal: 1 },
    boxCount: 1,
    inDecks: 0,
    ...over,
  };
}

const vader = row({
  setKey: 'SOR',
  base: 10,
  name: 'Darth Vader',
  subtitle: 'Dark Lord of the Sith',
  type: 'Leader',
  rarity: 'Common',
  aspects: ['Aggression', 'Villainy'],
  boxCount: 2,
});
const trooper = row({
  setKey: 'SOR',
  base: 130,
  name: 'Death Trooper',
  type: 'Unit',
  rarity: 'Common',
  aspects: ['Command', 'Villainy'],
  boxCount: 3,
});
const crate = row({
  setKey: 'SHD',
  base: 200,
  name: 'Smuggling Crate',
  type: 'Upgrade',
  rarity: 'Rare',
  aspects: [],
});
const luke = row({
  setKey: 'SHD',
  base: 50,
  name: 'Luke Skywalker',
  type: 'Unit',
  rarity: 'Legendary',
  aspects: ['Vigilance', 'Heroism'],
});
const all = [vader, trooper, luke, crate];

const none: BulkFilters = { setKey: '', query: '', chips: EMPTY_FILTERS };
const withChips = (chips: Partial<Filters>): BulkFilters => ({
  ...none,
  chips: { ...EMPTY_FILTERS, ...chips },
});
const names = (rows: BulkRow[]) => rows.map((r) => r.name);

describe('matchesBulkFilters', () => {
  it('lets every row through with nothing set', () => {
    expect(filterBulkRows(all, none)).toEqual(all);
  });

  it('keeps cards with any lit aspect, and treats no aspect as Neutral', () => {
    expect(names(filterBulkRows(all, withChips({ aspect: ['Villainy'] })))).toEqual([
      'Darth Vader',
      'Death Trooper',
    ]);
    expect(names(filterBulkRows(all, withChips({ aspect: ['Heroism', 'NEUTRAL'] })))).toEqual([
      'Luke Skywalker',
      'Smuggling Crate',
    ]);
  });

  it('filters by rarity and type, every lit group having to match', () => {
    expect(names(filterBulkRows(all, withChips({ rarity: ['Rare', 'Legendary'] })))).toEqual([
      'Luke Skywalker',
      'Smuggling Crate',
    ]);
    expect(names(filterBulkRows(all, withChips({ type: ['Unit'] })))).toEqual([
      'Death Trooper',
      'Luke Skywalker',
    ]);
    expect(names(filterBulkRows(all, withChips({ type: ['Unit'], aspect: ['Villainy'] })))).toEqual(
      ['Death Trooper'],
    );
  });

  it('combines the chips with the set picker and the search box', () => {
    const filters = { ...withChips({ aspect: ['Villainy'] }), setKey: 'SOR' };
    expect(names(filterBulkRows(all, filters))).toEqual(['Darth Vader', 'Death Trooper']);
    expect(names(filterBulkRows(all, { ...filters, query: 'lord' }))).toEqual(['Darth Vader']);
    expect(names(filterBulkRows(all, { ...filters, query: '130' }))).toEqual(['Death Trooper']);
    expect(matchesBulkFilters(luke, { ...none, setKey: 'SOR' })).toBe(false);
  });

  it('leaves out a row whose card has no rarity or type once those chips are lit', () => {
    const unknown = row({ setKey: 'SOR', base: 999 });
    expect(matchesBulkFilters(unknown, withChips({ rarity: ['Common'] }))).toBe(false);
    expect(matchesBulkFilters(unknown, withChips({ type: ['Unit'] }))).toBe(false);
    expect(matchesBulkFilters(unknown, withChips({ aspect: ['NEUTRAL'] }))).toBe(true);
  });

  it('ignores the status chips and Hide out in decks, which the Bulk tab does not show', () => {
    const filters = withChips({ status: ['none'], hideInDecks: true });
    expect(filterBulkRows(all, filters)).toEqual(all);
  });

  it('leaves sections holding only the rows that match, so their totals follow the filter', () => {
    const sections = groupBulkRows(filterBulkRows(all, withChips({ aspect: ['Villainy'] })));
    expect(sections.map((s) => [s.key, names(s.rows)])).toEqual([
      ['leaders', ['Darth Vader']],
      ['common', ['Death Trooper']],
    ]);
  });
});
