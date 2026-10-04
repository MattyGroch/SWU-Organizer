import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EMPTY_FILTERS } from './cardRows';
import { FilterBar } from './FilterBar';

const panel = () => screen.getByText('Filters').closest('details')!;

describe('FilterBar', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('starts open on a wide screen', () => {
    render(<FilterBar filters={EMPTY_FILTERS} onChange={vi.fn()} />);
    expect(panel()).toHaveAttribute('open');
  });

  it('starts folded away on a phone, and opens on tap', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width') }));
    render(<FilterBar filters={EMPTY_FILTERS} onChange={vi.fn()} />);
    expect(panel()).not.toHaveAttribute('open');

    await userEvent.click(screen.getByText('Filters'));
    expect(panel()).toHaveAttribute('open');
  });

  it('says how many filters are on, so a folded panel cannot hide them', () => {
    render(
      <FilterBar
        filters={{ ...EMPTY_FILTERS, rarity: ['Rare', 'Legendary'], text: 'vader' }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('3 active')).toBeInTheDocument();
  });
});
