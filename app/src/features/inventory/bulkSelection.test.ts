import { describe, expect, it } from 'vitest';

import type { BulkRow } from './bulkRows';
import {
  checkState,
  copiesIn,
  pruneSelection,
  removalsFor,
  rowId,
  selectableIds,
  selectedRows,
  toggleMany,
  toggleOne,
} from './bulkSelection';

function row(setKey: string, base: number, inBox: BulkRow['inBox'], inDecks = 0): BulkRow {
  const boxCount = Object.values(inBox).reduce((sum, n) => sum + (n ?? 0), 0);
  return { setKey, base, name: `${setKey} ${base}`, aspects: [], inBox, boxCount, inDecks };
}

const a = row('SOR', 1, { normal: 2 });
const b = row('SOR', 2, { normal: 1, foil: 1 });
const c = row('SHD', 3, { hyperspace: 1 }, 1);
const outInDecks = row('TWI', 4, {}, 2);
const rows = [a, b, c, outInDecks];

describe('bulk selection', () => {
  it('only rows with copies in the box can be ticked', () => {
    expect(selectableIds(rows)).toEqual(['SOR:1', 'SOR:2', 'SHD:3']);
  });

  it('reports none, some or all for a check-all box', () => {
    const ids = selectableIds(rows);
    expect(checkState(ids, new Set())).toBe('none');
    expect(checkState(ids, new Set(['SOR:1']))).toBe('some');
    expect(checkState(ids, new Set(ids))).toBe('all');
  });

  it('check-all ticks the rest of a partly ticked group, then unticks it all', () => {
    const section = ['SOR:1', 'SOR:2'];
    const other = 'SHD:3';
    const once = toggleMany(new Set(['SOR:1', other]), section);
    expect([...once].sort()).toEqual(['SHD:3', 'SOR:1', 'SOR:2']);
    const twice = toggleMany(once, section);
    expect([...twice]).toEqual([other]);
  });

  it('toggles one row', () => {
    expect([...toggleOne(new Set(), 'SOR:1')]).toEqual(['SOR:1']);
    expect([...toggleOne(new Set(['SOR:1']), 'SOR:1')]).toEqual([]);
  });

  it('drops ticks on rows that are no longer shown or emptied', () => {
    const selected = new Set(['SOR:1', 'SHD:3', 'TWI:4']);
    expect([...pruneSelection(selected, [a, b, outInDecks])]).toEqual(['SOR:1']);
  });

  it('returns the same set when nothing needs dropping', () => {
    const selected = new Set(['SOR:1']);
    expect(pruneSelection(selected, rows)).toBe(selected);
  });

  it('lists the ticked rows in list order', () => {
    expect(selectedRows(rows, new Set(['SHD:3', 'SOR:1'])).map(rowId)).toEqual(['SOR:1', 'SHD:3']);
  });

  it('removes every copy in the box and none of those out in decks', () => {
    expect(removalsFor([b, c])).toEqual([
      { setKey: 'SOR', base: 2, remove: { normal: 1, foil: 1 } },
      { setKey: 'SHD', base: 3, remove: { hyperspace: 1 } },
    ]);
    expect(copiesIn([a, b, c])).toBe(5);
  });
});
