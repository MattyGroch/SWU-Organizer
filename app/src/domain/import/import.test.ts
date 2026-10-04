import { describe, expect, it } from 'vitest';

import { parseSetCatalog, toLoadedSet, type LoadedSet } from '~/domain/catalog';
import type { SetKey } from '~/domain/types';

import {
  detectFormat,
  importAppJson,
  importText,
  parseCsv,
  UnrecognizedImportError,
  type ImportResult,
} from './index';
import { columnMeaning } from './variantColumns';

/** SOR-era foils are suffixed; LOF-era sets number every printing as an integer. */
function makeCatalog(): Map<SetKey, LoadedSet> {
  const sor = toLoadedSet(
    parseSetCatalog({
      setKey: 'SOR',
      label: 'SOR',
      cards: [
        {
          base: 1,
          name: 'Director Krennic',
          type: 'Leader',
          aspects: [],
          printings: [
            { num: '001', variant: 'normal' },
            { num: '269', variant: 'hyperspace' },
            { num: '253', variant: 'showcase' },
          ],
        },
        {
          base: 59,
          name: '2-1B Surgical Droid',
          type: 'Unit',
          aspects: [],
          printings: [
            { num: '059', variant: 'normal' },
            { num: '059F', variant: 'foil' },
            { num: '324', variant: 'hyperspace' },
            { num: '324F', variant: 'hyperspace-foil' },
          ],
        },
      ],
    }),
    new Map(),
  );

  const lof = toLoadedSet(
    parseSetCatalog({
      setKey: 'LOF',
      label: 'LOF',
      cards: [
        {
          base: 142,
          name: 'Adi Gallia',
          type: 'Unit',
          aspects: [],
          printings: [
            { num: '142', variant: 'normal' },
            { num: '644', variant: 'foil' },
            { num: '406', variant: 'hyperspace' },
            { num: '882', variant: 'hyperspace-foil' },
            { num: '1060', variant: 'prestige' },
            { num: '1106', variant: 'prestige-foil' },
            { num: '1152', variant: 'prestige-serialized' },
          ],
        },
      ],
    }),
    new Map(),
  );

  return new Map([
    ['SOR', sor],
    ['LOF', lof],
  ]);
}

const catalog = makeCatalog();

function byNum(result: ImportResult) {
  return Object.fromEntries(result.printings.map((p) => [p.num, p.count]));
}

describe('parseCsv', () => {
  it('handles quoted fields containing commas', () => {
    // The legacy regex parser split this into the wrong number of fields.
    const table = parseCsv('Set,Name,Count\nSOR,"Krennic, Director",2');
    expect(table.rows[0]).toEqual(['SOR', 'Krennic, Director', '2']);
  });

  it('handles escaped quotes and embedded newlines', () => {
    const table = parseCsv('A,B\n"say ""hi""","line1\nline2"');
    expect(table.rows[0]).toEqual(['say "hi"', 'line1\nline2']);
  });

  it('preserves empty fields rather than collapsing them', () => {
    const table = parseCsv('A,B,C\n1,,3');
    expect(table.rows[0]).toEqual(['1', '', '3']);
  });

  it('pads short rows so trailing columns stay addressable', () => {
    const table = parseCsv('A,B,C\n1,2');
    expect(table.rows[0]).toEqual(['1', '2', '']);
  });

  it('strips a BOM and tolerates CRLF', () => {
    const table = parseCsv('﻿Set,Count\r\nSOR,2\r\n');
    expect(table.headers).toEqual(['Set', 'Count']);
    expect(table.rows[0]).toEqual(['SOR', '2']);
  });
});

describe('columnMeaning', () => {
  it('maps every SW-Unlimited variant column', () => {
    expect(columnMeaning('Normal')).toEqual({ kind: 'variant', variant: 'normal' });
    expect(columnMeaning('Foil')).toEqual({ kind: 'variant', variant: 'foil' });
    expect(columnMeaning('Hyperspace')).toEqual({ kind: 'variant', variant: 'hyperspace' });
    expect(columnMeaning('Foil & Hyperspace')).toEqual({
      kind: 'variant',
      variant: 'hyperspace-foil',
    });
    expect(columnMeaning('Showcase')).toEqual({ kind: 'variant', variant: 'showcase' });
    expect(columnMeaning('Standard Prestige')).toEqual({ kind: 'variant', variant: 'prestige' });
    expect(columnMeaning('Foil Prestige')).toEqual({ kind: 'variant', variant: 'prestige-foil' });
    expect(columnMeaning('Serialized Prestige')).toEqual({
      kind: 'variant',
      variant: 'prestige-serialized',
    });
  });

  it('treats promo columns as ordinary copies, not as a lost card', () => {
    expect(columnMeaning('Organized Play')).toEqual({ kind: 'promo' });
    expect(columnMeaning('Event Exclusive')).toEqual({ kind: 'promo' });
  });

  it('ignores bookkeeping columns', () => {
    expect(columnMeaning('Base card id')).toEqual({ kind: 'other' });
  });
});

describe('detectFormat', () => {
  it('recognises each supported header shape', () => {
    expect(detectFormat(['Set', 'CardNumber', 'Count'])).toBe('swudb-csv');
    expect(detectFormat(['Set', 'Base card id', 'Normal'])).toBe('sw-unlimited');
    expect(detectFormat(['Name', 'Qty'])).toBe('unknown');
  });
});

describe('SW-Unlimited import', () => {
  const header = 'Set,Base card id,Normal,Foil,Hyperspace,Foil & Hyperspace';

  it('maps each variant column to its own printing instead of summing them', () => {
    const result = importText(`${header}\nSOR,59,3,1,2,1`, catalog);

    // The legacy importer turned this row into the single number 7, then clamped it to 3.
    expect(byNum(result)).toEqual({ '059': 3, '059F': 1, '324': 2, '324F': 1 });
    expect(result.copies).toBe(7);
    expect(result.recognized).toBe(4);
  });

  it('does not clamp to the playset quota', () => {
    const result = importText(`${header}\nSOR,59,9,0,0,0`, catalog);
    expect(byNum(result)['059']).toBe(9);
  });

  it('skips blank and zero columns without counting them', () => {
    const result = importText(`${header}\nSOR,59,2,,0,`, catalog);
    expect(byNum(result)).toEqual({ '059': 2 });
    expect(result.recognized).toBe(1);
  });

  it('handles prestige columns on a set that has them', () => {
    const result = importText(
      'Set,Base card id,Normal,Standard Prestige,Foil Prestige,Serialized Prestige\nLOF,142,1,1,1,1',
      catalog,
    );
    expect(byNum(result)).toEqual({ '142': 1, '1060': 1, '1106': 1, '1152': 1 });
  });

  it('records a variant the card was never printed in as a skip, not a silent loss', () => {
    // SOR units have no Prestige run.
    const result = importText('Set,Base card id,Normal,Standard Prestige\nSOR,59,1,2', catalog);
    expect(byNum(result)).toEqual({ '059': 1 });
    expect(result.skipped).toEqual([
      { reason: 'unknown-variant', detail: 'SOR 59 (Standard Prestige)' },
    ]);
  });

  it('folds promo columns into ordinary copies', () => {
    const result = importText(
      'Set,Base card id,Normal,Organized Play,Event Exclusive\nSOR,59,1,1,2',
      catalog,
    );
    expect(byNum(result)).toEqual({ '059': 4 });
  });

  it('reports unknown sets and cards with a reason', () => {
    const result = importText(`${header}\nZZZ,59,1,0,0,0\nSOR,9999,1,0,0,0`, catalog);
    expect(result.printings).toEqual([]);
    expect(result.skipped.map((s) => s.reason)).toEqual(['unknown-set', 'unknown-card']);
  });

  it('never imports a reserved storage key as a set', () => {
    const result = importText(`${header}\nschema-version,59,1,0,0,0`, catalog);
    expect(result.printings).toEqual([]);
    expect(result.skipped[0]!.reason).toBe('reserved-key');
  });
});

describe('SWUDB CSV import', () => {
  it('records the printing that the card number actually names', () => {
    // 324 is the Hyperspace printing of #59, not a second card.
    const result = importText('Set,CardNumber,Count\nSOR,324,2', catalog);
    expect(result.printings[0]).toMatchObject({
      base: 59,
      num: '324',
      variant: 'hyperspace',
      count: 2,
    });
  });

  it('tolerates leading zeros in either direction', () => {
    expect(byNum(importText('Set,CardNumber,Count\nSOR,059,1', catalog))).toEqual({ '059': 1 });
    expect(byNum(importText('Set,CardNumber,Count\nSOR,59,1', catalog))).toEqual({ '059': 1 });
  });

  it('resolves suffixed foil numbers', () => {
    const result = importText('Set,CardNumber,Count\nSOR,059F,2', catalog);
    expect(result.printings[0]).toMatchObject({ num: '059F', variant: 'foil', count: 2 });
  });

  it('counts malformed numbers and quantities as skips', () => {
    const result = importText(
      ['Set,CardNumber,Count', 'SOR,059,1', 'SOR,not-a-number,2', 'SOR,324,not-a-quantity'].join(
        '\n',
      ),
      catalog,
    );

    expect(byNum(result)).toEqual({ '059': 1 });
    expect(result.recognized).toBe(1);
    expect(result.skipped).toHaveLength(2);
  });

  it('merges duplicate rows for the same printing', () => {
    const result = importText('Set,CardNumber,Count\nSOR,059,1\nSOR,059,2', catalog);
    expect(byNum(result)).toEqual({ '059': 3 });
  });
});

describe('Hyperspace Vault import', () => {
  const csv = [
    '# swu-inv-export v1',
    'swuapi_uuid,set_code,card_number,variant_type,quantity,name,subtitle',
    'a,SOR,1,Standard,1,Director Krennic,Aspiring to Authority',
    'b,SOR,59,Standard,2,2-1B Surgical Droid,',
    'c,LOF,1060,Standard Prestige,1,Name,',
  ].join('\n');

  it('skips the comment line, detects the format and resolves by printing number', () => {
    const result = importText(csv, catalog);
    expect(result.format).toBe('hyperspace-vault');
    expect(result.skipped).toEqual([]);
    expect(result.printings).toEqual(
      expect.arrayContaining([
        { setKey: 'SOR', base: 1, num: '001', variant: 'normal', count: 1 },
        { setKey: 'SOR', base: 59, num: '059', variant: 'normal', count: 2 },
        // 1060 is the Prestige printing of base card 142, not a card numbered 1060.
        { setKey: 'LOF', base: 142, num: '1060', variant: 'prestige', count: 1 },
      ]),
    );
  });

  it('reads the JSON export the same way', () => {
    const json = JSON.stringify({
      format_version: 'swu-inv/1',
      source: 'hyperspacevault',
      cards: [
        { set_code: 'SOR', card_number: '59', variant_type: 'Standard', quantity: 2, name: 'x' },
        { set_code: 'LOF', card_number: '1060', variant_type: 'Standard Prestige', quantity: 1 },
      ],
    });
    const result = importText(json, catalog);
    expect(result.format).toBe('hyperspace-vault');
    expect(result.copies).toBe(3);
    expect(result.printings.find((p) => p.num === '1060')?.variant).toBe('prestige');
  });

  it('reports rows it cannot place instead of dropping them', () => {
    const result = importText(csv + '\nd,XYZ,5,Standard,1,Nope,', catalog);
    expect(result.skipped).toEqual([expect.objectContaining({ reason: 'unknown-set' })]);
  });
});

describe('app JSON import', () => {
  it('reads a legacy v1 backup, treating base numbers as Normal printings', () => {
    const result = importAppJson({ version: 1, sets: { SOR: { 1: 1, 59: 3 } } }, catalog);
    expect(byNum(result)).toEqual({ '001': 1, '059': 3 });
  });

  it('reads printing-level numbers when a backup has them', () => {
    const result = importAppJson({ version: 2, sets: { SOR: { '324F': 2 } } }, catalog);
    expect(result.printings[0]).toMatchObject({ variant: 'hyperspace-foil', count: 2 });
  });

  it('carries the deck library from a v3 backup', () => {
    const decks = { customDecks: [], preconOwnership: { 'SOR-Vader': 1 } };
    const result = importAppJson({ version: 3, sets: {}, decks }, catalog);
    expect(result.deckLibrary).toEqual(decks);
  });

  it('has no deck library for a counts-only backup', () => {
    const result = importAppJson({ version: 2, sets: {} }, catalog);
    expect(result.deckLibrary).toBeUndefined();
  });

  it('counts malformed and reserved entries as skips', () => {
    const result = importAppJson(
      {
        version: 1,
        sets: {
          SOR: { 59: 1, invalid: 2, 324: 'not-a-quantity' },
          'migration:v2:backup': { 59: 1 },
        },
      },
      catalog,
    );

    expect(byNum(result)).toEqual({ '059': 1 });
    expect(result.recognized).toBe(1);
    expect(result.skipped).toHaveLength(3);
  });

  it.each([
    ['null root', null],
    ['array root', []],
    ['boolean sets', { version: 1, sets: true }],
    ['null sets', { version: 1, sets: null }],
    ['array sets', { version: 1, sets: [] }],
    ['boolean set inventory', { version: 1, sets: { SOR: true } }],
    ['null set inventory', { version: 1, sets: { SOR: null } }],
    ['array set inventory', { version: 1, sets: { SOR: [] } }],
  ])('rejects malformed structure: %s', (_label, payload) => {
    expect(() => importAppJson(payload, catalog)).toThrow(UnrecognizedImportError);
  });
});

describe('importText dispatch', () => {
  it('rejects an unrecognised file', () => {
    expect(() => importText('Name,Qty\nVader,3', catalog)).toThrow(UnrecognizedImportError);
    expect(() => importText('{not json', catalog)).toThrow(UnrecognizedImportError);
  });

  it('returns an empty result for an empty file', () => {
    expect(importText('   ', catalog).printings).toEqual([]);
  });
});
