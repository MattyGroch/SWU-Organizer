import { describe, expect, it } from 'vitest';
import { buildSearchSuggestions, submittedSuggestion } from './search';

const catalogs = [
  {
    setKey: 'SOR',
    cards: [
      {
        Name: 'Darth Vader',
        Subtitle: 'Dark Lord of the Sith',
        Number: 10,
        Type: 'Leader',
        Set: 'SOR',
      },
      {
        Name: 'Darth Vader',
        Subtitle: 'Commanding the First Legion',
        Number: 87,
        Type: 'Unit',
        Set: 'SOR',
      },
    ],
    printingNumbersByBase: new Map([
      [10, [10]],
      [87, [87, 351]],
    ]),
    baseByPrintingNumber: new Map([
      [10, 10],
      [87, 87],
      [351, 87],
    ]),
    promosByBase: new Map([[87, [{ set: 'SOROP', number: 15 }]]]),
  },
  {
    setKey: 'TWI',
    cards: [{ Name: 'Brain Invaders', Number: 255, Type: 'Unit', Set: 'TWI' }],
    printingNumbersByBase: new Map([[255, [255]]]),
    baseByPrintingNumber: new Map([[255, 255]]),
  },
];

describe('search suggestions', () => {
  it('keeps duplicate names as distinct stable card identities', () => {
    const results = buildSearchSuggestions('Darth Vader', catalogs, 'SOR');
    expect(results.map((result) => result.baseNumber)).toEqual([87, 10]);
  });

  it('ranks intentional word starts before incidental normalized substrings', () => {
    const results = buildSearchSuggestions('Vader', catalogs, 'SOR');
    expect(results[0]).toMatchObject({ setKey: 'SOR', name: 'Darth Vader' });
    expect(results[results.length - 1]?.name).toBe('Brain Invaders');
  });

  it('resolves an alternate printing number to its base card', () => {
    expect(buildSearchSuggestions('351', catalogs, 'SOR')[0]).toMatchObject({
      setKey: 'SOR',
      baseNumber: 87,
    });
  });

  it('submits the highlighted result and falls back to the first', () => {
    const results = buildSearchSuggestions('Darth Vader', catalogs, 'SOR');
    expect(submittedSuggestion(results, 1)?.baseNumber).toBe(10);
    expect(submittedSuggestion(results, 99)?.baseNumber).toBe(87);
  });

  it('finds a weekly-play promo by its own number, with OP or its set code', () => {
    for (const query of ['OP 15', 'op15', 'SOROP 15', 'sorop-015']) {
      const [hit] = buildSearchSuggestions(query, catalogs, 'SOR');
      expect(hit, query).toMatchObject({ setKey: 'SOR', baseNumber: 87, kind: 'number' });
      expect(hit!.label).toContain('SOROP #15');
    }
    expect(buildSearchSuggestions('OP 16', catalogs, 'SOR')).toEqual([]);
  });

  it('leaves plain numbers and ordinary names alone', () => {
    expect(buildSearchSuggestions('15', catalogs, 'SOR')).toEqual([]);
    expect(buildSearchSuggestions('vader', catalogs, 'SOR').map((s) => s.kind)).not.toContain(
      'number',
    );
  });
});
