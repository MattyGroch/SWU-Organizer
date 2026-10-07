import { describe, expect, it } from 'vitest';

import { compareBulkRows, type BulkRow } from './bulkRows';

function row(setKey: string, base: number, type: string, rarity: string, aspects: string[] = []) {
  return {
    setKey,
    base,
    name: `${setKey} ${base}`,
    type,
    rarity,
    aspects,
    inBox: { normal: 1 },
    boxCount: 1,
    inDecks: 0,
  } satisfies BulkRow;
}

const label = (r: BulkRow) => `${r.setKey}#${r.base}`;

describe('compareBulkRows', () => {
  it('orders leaders, bases, Legendaries, Rares, Specials, then Commons and Uncommons', () => {
    const rows = [
      row('SOR', 30, 'Unit', 'Common'),
      row('SOR', 20, 'Unit', 'Uncommon'),
      row('SOR', 60, 'Unit', 'Special'),
      row('SOR', 40, 'Unit', 'Rare'),
      row('SOR', 50, 'Event', 'Legendary'),
      row('SOR', 25, 'Base', 'Common', ['Vigilance']),
      row('SOR', 5, 'Leader', 'Rare', ['Vigilance', 'Heroism']),
    ];
    expect(rows.sort(compareBulkRows(['SOR'])).map(label)).toEqual([
      'SOR#5',
      'SOR#25',
      'SOR#50',
      'SOR#40',
      'SOR#60',
      'SOR#20',
      'SOR#30',
    ]);
  });

  it('groups each section by set, oldest first, then by card number', () => {
    const rows = [
      row('SHD', 10, 'Unit', 'Legendary'),
      row('SOR', 90, 'Unit', 'Legendary'),
      row('SOR', 12, 'Unit', 'Legendary'),
      row('SHD', 3, 'Unit', 'Common'),
      row('SOR', 200, 'Unit', 'Uncommon'),
    ];
    expect(rows.sort(compareBulkRows(['SOR', 'SHD'])).map(label)).toEqual([
      'SOR#12',
      'SOR#90',
      'SHD#10',
      'SOR#200',
      'SHD#3',
    ]);
  });

  it('sorts leaders by set, then dual-aspect first, then alphabetically by first aspect', () => {
    const rows = [
      row('SHD', 1, 'Leader', 'Common', ['Aggression', 'Villainy']),
      row('SOR', 2, 'Leader', 'Common', ['Vigilance', 'Villainy']),
      row('SOR', 3, 'Leader', 'Common', ['Aggression', 'Heroism']),
      row('SOR', 4, 'Leader', 'Rare', ['Vigilance', 'Command']),
      row('SOR', 5, 'Leader', 'Rare', ['Command', 'Cunning']),
      row('SOR', 6, 'Leader', 'Rare', ['Heroism']),
      row('SOR', 7, 'Leader', 'Common', ['Cunning', 'Villainy']),
    ];
    expect(rows.sort(compareBulkRows(['SOR', 'SHD'])).map(label)).toEqual([
      'SOR#5', // Command / Cunning
      'SOR#4', // Vigilance / Command
      'SOR#3', // Aggression
      'SOR#7', // Cunning
      'SOR#2', // Vigilance
      'SOR#6', // no primary aspect
      'SHD#1',
    ]);
  });
});
