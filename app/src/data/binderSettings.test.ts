import { beforeEach, describe, expect, it } from 'vitest';

import type { SetManifestEntry } from '~/domain/catalog';

import { binderEntries, readHiddenSets, writeHiddenSets } from './binderSettings';
import { SwuDatabase } from './db';

const entry = (key: string) => ({ key, label: key, file: `SWU-${key}.json` }) as SetManifestEntry;

describe('binder set visibility', () => {
  let database: SwuDatabase;

  beforeEach(async () => {
    database = new SwuDatabase(`test-${crypto.randomUUID()}`);
    await database.open();
  });

  it('hides TS26 and IBH until the setting is first changed', async () => {
    expect([...(await readHiddenSets(database))]).toEqual(['IBH', 'TS26']);
  });

  it('remembers what was chosen, including showing everything', async () => {
    await writeHiddenSets(['IBH', 'TS26'], database);
    expect([...(await readHiddenSets(database))]).toEqual(['IBH', 'TS26']);
    await writeHiddenSets([], database);
    expect((await readHiddenSets(database)).size).toBe(0);
  });

  it('keeps manifest order, and never hides every set', () => {
    const entries = ['SOR', 'TS26', 'HMW'].map(entry);
    expect(binderEntries(entries, new Set(['TS26'])).map((e) => e.key)).toEqual(['SOR', 'HMW']);
    expect(binderEntries(entries, new Set(['SOR', 'TS26', 'HMW'])).map((e) => e.key)).toEqual([
      'SOR',
      'TS26',
      'HMW',
    ]);
  });
});
