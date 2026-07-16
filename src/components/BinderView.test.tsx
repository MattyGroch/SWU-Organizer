import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Binder } from '../App';
import type { Card } from '../core/types';

const card25: Card = {
  Name: 'Focused card',
  Number: 25,
  Set: 'SOR',
  Type: 'Unit',
};

function renderBinder(viewMode: 'single' | 'spread') {
  const onActivateCard = vi.fn();
  const onFocusedPageChange = vi.fn();
  const onViewModeChange = vi.fn();
  const setViewSpread = vi.fn();

  const result = render(
    <Binder
      viewSpread={1}
      setViewSpread={setViewSpread}
      totalSpreads={3}
      totalPages={5}
      viewMode={viewMode}
      focusedPage={3}
      onFocusedPageChange={onFocusedPageChange}
      onViewModeChange={onViewModeChange}
      onActivateCard={onActivateCard}
      active={null}
      presentNumbers={new Set([25])}
      numToAspectSpec={new Map()}
      byNumber={new Map([[25, card25]])}
      inventory={{}}
      inc={vi.fn()}
      dec={vi.fn()}
      setKey="SOR"
      showHelpModal={false}
      setShowHelpModal={vi.fn()}
    />,
  );

  return {
    ...result,
    onActivateCard,
    onFocusedPageChange,
    onViewModeChange,
    setViewSpread,
  };
}

describe('Binder view modes', () => {
  it('renders exactly one four-column physical page and navigates page by page', () => {
    const { container, onActivateCard, onFocusedPageChange, onViewModeChange } =
      renderBinder('single');

    expect(container.querySelectorAll('.cell')).toHaveLength(12);
    expect(container.querySelector('.binder-subtitle')?.textContent).toContain('Binder — Page 3');
    expect(screen.queryByText(/Spread:/)).toBeNull();
    expect(container.querySelector('.binder-divider')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Spread' }));
    expect(onViewModeChange).toHaveBeenCalledWith('spread');

    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(onFocusedPageChange).toHaveBeenCalledWith(2);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onFocusedPageChange).toHaveBeenCalledWith(4);

    fireEvent.click(container.querySelector('.cell')!);
    expect(onActivateCard).toHaveBeenCalledWith(card25);
  });

  it('preserves the eight-column spread geometry and spread navigation', () => {
    const { container, setViewSpread } = renderBinder('spread');

    expect(container.querySelectorAll('.cell')).toHaveLength(24);
    expect(screen.getByText(/Spread: Page 2 \(left\) \| Page 3 \(right\)/)).toBeTruthy();
    expect(container.querySelector('.binder-divider')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Previous spread/ }));
    expect(setViewSpread).toHaveBeenCalled();
  });
});
