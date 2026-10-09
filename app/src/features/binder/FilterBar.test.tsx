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

describe('FilterBar omit', () => {
  it('leaves out the Status and Name groups, keeping Clear all', async () => {
    const onChange = vi.fn();
    render(
      <FilterBar
        filters={{ ...EMPTY_FILTERS, rarity: ['Rare'] }}
        onChange={onChange}
        omit={['status', 'name']}
      />,
    );
    expect(screen.queryByText('Status')).not.toBeInTheDocument();
    expect(screen.queryByText('Hide out in decks')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Filter cards by name')).not.toBeInTheDocument();
    expect(screen.getByText('Aspect')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(onChange).toHaveBeenCalledWith(EMPTY_FILTERS);
  });
});
