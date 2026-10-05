import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { parseSetCatalog, toLoadedSet, type LoadedSet } from '~/domain/catalog';
import { indexOwnership } from '~/domain/ownership';

import { BinderGrid } from './BinderGrid';
import { selectionForCard } from './useBinder';

function makeSet(): LoadedSet {
  // Page 1 holds 1-12; page 2 holds 13-24; page 3 holds 25-36.
  const cards = [1, 2, 5, 13, 14, 25].map((base) => ({
    base,
    name: `Card ${base}`,
    type: base === 1 ? 'Leader' : 'Unit',
    rarity: 'Common',
    aspects: base % 2 === 0 ? ['Command'] : ['Vigilance'],
    printings: [{ num: String(base).padStart(3, '0'), variant: 'normal' }],
  }));

  return toLoadedSet(parseSetCatalog({ setKey: 'SOR', label: 'SOR', cards }), new Map());
}

const set = makeSet();

function renderGrid(options: { viewSpread?: number; activeBase?: number; owned?: number } = {}) {
  const onSelect = vi.fn();
  const activeCard = options.activeBase ? set.byNumber.get(options.activeBase) : undefined;
  const ownership = indexOwnership(
    options.owned && options.activeBase
      ? [{ base: options.activeBase, variant: 'normal', count: options.owned }]
      : [],
  );

  render(
    <BinderGrid
      set={set}
      viewSpread={options.viewSpread ?? 0}
      active={activeCard ? selectionForCard(activeCard) : null}
      ownership={ownership}
      held={new Map()}
      focusRequest={0}
      onSelect={onSelect}
    />,
  );
  return { onSelect };
}

describe('BinderGrid accessibility', () => {
  it('is a real grid with rows and labelled cells', () => {
    renderGrid();

    const grid = screen.getByRole('grid');
    expect(grid).toHaveAttribute('aria-colcount', '8');
    expect(grid).toHaveAttribute('aria-rowcount', '3');
    expect(within(grid).getAllByRole('row')).toHaveLength(3);
    // 3 rows x 8 columns, filled or not.
    expect(within(grid).getAllByRole('gridcell')).toHaveLength(24);
  });

  it('names the spread so a screen reader announces which pages are open', () => {
    renderGrid({ viewSpread: 0 });
    expect(screen.getByRole('grid')).toHaveAccessibleName('Binder, page 1');
  });

  it('announces a facing pair on later spreads', () => {
    renderGrid({ viewSpread: 1 });
    expect(screen.getByRole('grid')).toHaveAccessibleName('Binder spread, pages 2 and 3');
  });

  it('describes each card with its location and how many are filed', () => {
    renderGrid({ activeBase: 5, owned: 2 });

    expect(
      screen.getByRole('button', {
        name: /Card 5\. Number 5\. Page 1, row 2, column 1\. 2 of 3 in binder\./,
      }),
    ).toBeInTheDocument();
  });

  it('never reports more than the playset in the binder', () => {
    renderGrid({ activeBase: 5, owned: 5 });
    expect(screen.getByRole('button', { name: /3 of 3 in binder\./ })).toBeInTheDocument();
  });

  it('keeps exactly one cell in the tab order (roving tabindex)', () => {
    renderGrid({ activeBase: 5 });

    const buttons = screen.getAllByRole('button');
    const tabbable = buttons.filter((b) => b.getAttribute('tabindex') === '0');
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAttribute('aria-pressed', 'true');
  });

  it('marks empty slots as disabled rather than making them focusable', () => {
    renderGrid();

    const cells = screen.getAllByRole('gridcell');
    const empty = cells.filter((cell) => cell.getAttribute('aria-disabled') === 'true');
    // Only 1, 2 and 5 exist on page 1, and the left half is hidden on spread 0.
    expect(empty.length).toBe(24 - 3);
    for (const cell of empty) {
      expect(within(cell).queryByRole('button')).toBeNull();
    }
  });

  it('selects a card when its cell is activated', async () => {
    const user = userEvent.setup();
    const { onSelect } = renderGrid();

    await user.click(screen.getByRole('button', { name: /Card 2\./ }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]![0]).toMatchObject({ Number: 2, Name: 'Card 2' });
  });

  it('is reachable by keyboard alone', async () => {
    const user = userEvent.setup();
    const { onSelect } = renderGrid({ activeBase: 5 });

    await user.tab();
    expect(screen.getByRole('button', { name: /Card 5\./ })).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalled();
  });
});
