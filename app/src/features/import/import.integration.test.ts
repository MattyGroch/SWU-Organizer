import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyImport } from '~/data/applyImport';
import { SwuDatabase } from '~/data/db';
import { readSetOwnership } from '~/data/inventory';
import { parseSetCatalog, toLoadedSet, type LoadedSet } from '~/domain/catalog';
import { importText } from '~/domain/import';
import { binderCount, quotaForCard, spareCount } from '~/domain/ownership';
import type { SetKey } from '~/domain/types';

/**
 * The re-import flow, against the real committed catalog: take a SW-Unlimited style
 * export with variant columns, and land it in the database with each printing intact.
 */

const setsDir = join(dirname(fileURLToPath(import.meta.url)), '../../../public/sets');

function loadSet(setKey: string): LoadedSet {
  const catalog = parseSetCatalog(
    JSON.parse(readFileSync(join(setsDir, `SWU-${setKey}.json`), 'utf8')),
  );
  return toLoadedSet(catalog, new Map());
}

const catalog = new Map<SetKey, LoadedSet>([
  ['SOR', loadSet('SOR')],
  ['LOF', loadSet('LOF')],
]);

let database: SwuDatabase;

beforeEach(async () => {
  database = new SwuDatabase(`test-${crypto.randomUUID()}`);
  await database.open();
});

describe('re-importing a collection with variants', () => {
  const header =
    'Set,Base card id,Normal,Foil,Hyperspace,Foil & Hyperspace,Showcase,Standard Prestige,Foil Prestige,Serialized Prestige';

  it('keeps every printing separate instead of summing them', async () => {
    // Krennic: 1 Normal, 1 Hyperspace, 1 Showcase.
    // 2-1B:    3 Normal, 1 Foil, 2 Hyperspace, 1 Hyperspace Foil.
    const csv = [header, 'SOR,1,1,0,1,0,1,0,0,0', 'SOR,59,3,1,2,1,0,0,0,0'].join('\n');

    const result = importText(csv, catalog);
    await applyImport(result.printings, 'replaceSets', { database });

    const rows = await database.owned.where('setKey').equals('SOR').toArray();
    const byNum = Object.fromEntries(rows.map((r) => [r.num, r.count]));

    expect(byNum).toEqual({
      '001': 1,
      '269': 1,
      '253': 1,
      '059': 3,
      '059F': 1,
      '324': 2,
      '324F': 1,
    });
    // 3 copies of Krennic + 7 of the droid. The legacy importer would have summed these
    // into SOR:1 = 3 and SOR:59 = 7, then clamped both to the playset quota (1 and 3),
    // discarding 6 of the 10 copies and all of the finish information.
    expect(result.copies).toBe(10);
  });

  it('files every printing of a card into one binder slot', async () => {
    const csv = [header, 'SOR,59,3,1,2,1,0,0,0,0'].join('\n');
    await applyImport(importText(csv, catalog).printings, 'replaceSets', { database });

    const ownership = await readSetOwnership('SOR', database);
    const droid = ownership.get(59)!;

    expect(droid.total).toBe(7);
    expect(droid.byVariant).toEqual({
      normal: 3,
      foil: 1,
      hyperspace: 2,
      'hyperspace-foil': 1,
    });

    // One slot, one playset, four spares.
    const quota = quotaForCard(catalog.get('SOR')!.cardsByBase.get(59)!);
    expect(binderCount(droid.total, quota)).toBe(3);
    expect(spareCount(droid.total, quota)).toBe(4);
  });

  it('handles prestige runs in the sets that have them', async () => {
    const csv = [header, 'LOF,142,1,1,1,1,0,1,1,1'].join('\n');
    await applyImport(importText(csv, catalog).printings, 'replaceSets', { database });

    const rows = await database.owned.where('setKey').equals('LOF').toArray();
    expect(rows.map((r) => r.variant).sort()).toEqual([
      'foil',
      'hyperspace',
      'hyperspace-foil',
      'normal',
      'prestige',
      'prestige-foil',
      'prestige-serialized',
    ]);
  });

  it('re-importing replaces rather than doubling', async () => {
    const csv = [header, 'SOR,59,3,1,0,0,0,0,0,0'].join('\n');

    await applyImport(importText(csv, catalog).printings, 'replaceSets', { database });
    await applyImport(importText(csv, catalog).printings, 'replaceSets', { database });

    const ownership = await readSetOwnership('SOR', database);
    expect(ownership.get(59)!.total).toBe(4);
  });

  it('leaves other sets untouched when re-importing one set', async () => {
    await applyImport(
      importText([header, 'LOF,142,2,0,0,0,0,0,0,0'].join('\n'), catalog).printings,
      'replaceSets',
      { database },
    );
    await applyImport(
      importText([header, 'SOR,59,3,0,0,0,0,0,0,0'].join('\n'), catalog).printings,
      'replaceSets',
      { database },
    );

    expect((await readSetOwnership('LOF', database)).get(142)!.total).toBe(2);
    expect((await readSetOwnership('SOR', database)).get(59)!.total).toBe(3);
  });

  it('reports variants a card was never printed in, rather than losing the copies silently', () => {
    // SOR units have no Prestige run at all.
    const result = importText([header, 'SOR,59,1,0,0,0,0,4,0,0'].join('\n'), catalog);

    expect(result.copies).toBe(1);
    expect(result.skipped).toEqual([
      { reason: 'unknown-variant', detail: 'SOR 59 (Standard Prestige)' },
    ]);
  });

  it('migrates a legacy v1 JSON backup onto Normal printings', async () => {
    const legacy = JSON.stringify({ version: 1, sets: { SOR: { 1: 1, 59: 3 } } });
    await applyImport(importText(legacy, catalog).printings, 'replaceSets', { database });

    const rows = await database.owned.toArray();
    expect(rows.every((r) => r.variant === 'normal')).toBe(true);
    expect(Object.fromEntries(rows.map((r) => [r.num, r.count]))).toEqual({ '001': 1, '059': 3 });
  });
});
