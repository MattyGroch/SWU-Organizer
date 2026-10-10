import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { CollectionTotals } from './cardRows';
import { CollectionProgress } from './CollectionProgress';

const totals = (over: Partial<CollectionTotals>): CollectionTotals => ({
  cards: 0,
  complete: 0,
  partial: 0,
  missing: 0,
  value: 0,
  missingCost: 0,
  inBulk: 0,
  ...over,
});

/** The blade's lit segments, by width; empty ones aren't drawn. */
const segmentWidths = (bar: HTMLElement) =>
  [...bar.querySelectorAll<HTMLElement>('[style*="width"]')].map((s) => s.style.width);

describe('CollectionProgress', () => {
  it('sizes each segment as its share of the filtered cards', () => {
    render(
      <CollectionProgress totals={totals({ cards: 4, complete: 2, partial: 1, missing: 1 })} />,
    );
    const bar = screen.getByRole('img');
    expect(bar).toHaveAccessibleName('2 complete, 1 in progress, 1 not collected, of 4 cards');
    expect(segmentWidths(bar)).toEqual(['50%', '25%', '25%']);
    expect(screen.getByText('50% complete')).toBeInTheDocument();
  });

  it('shows an unlit blade rather than NaN when the filters match nothing', () => {
    render(<CollectionProgress totals={totals({})} />);
    expect(segmentWidths(screen.getByRole('img'))).toEqual([]);
    expect(screen.getByText('0% complete')).toBeInTheDocument();
  });
});
