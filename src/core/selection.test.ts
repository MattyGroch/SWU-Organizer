import { describe, expect, it } from 'vitest';
import type { ActiveSelection, Card } from './types';
import { selectionAfterMove, viewModeAfterSelection } from './selection';

const active: ActiveSelection = {
  card: {
    Name: 'Page Two Card',
    Number: 16,
    Set: 'SOR',
  },
  number: 16,
  page: 2,
  row: 1,
  column: 4,
  spreadCol: 4,
  spreadRow: 1,
};

describe('selection state', () => {
  it('uses automatic single-page mode only when enabled', () => {
    expect(viewModeAfterSelection({ autoOpenSinglePage: true }, 'spread')).toBe('single');
    expect(viewModeAfterSelection({ autoOpenSinglePage: false }, 'spread')).toBe('spread');
    expect(viewModeAfterSelection({ autoOpenSinglePage: false }, 'single')).toBe('single');
  });

  it('moves right across the page boundary and follows the exact card', () => {
    const destination: Card = {
      Name: 'Page Three Card',
      Number: 25,
      Set: 'SOR',
    };
    const byNumber = new Map([[destination.Number, destination]]);

    expect(selectionAfterMove(active, 'right', 3, byNumber)).toEqual({
      card: destination,
      number: 25,
      page: 3,
      row: 1,
      column: 1,
      spreadCol: 5,
      spreadRow: 1,
    });
  });

  it('keeps the current selection when the target slot has no card', () => {
    expect(selectionAfterMove(active, 'right', 3, new Map())).toBe(active);
  });
});
