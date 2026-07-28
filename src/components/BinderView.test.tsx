import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Binder } from '../App';
import type { Card } from '../core/types';

const card25: Card = {
  Name: 'Focused card',
  Number: 25,
  Set: 'SOR',
  Type: 'Unit',
};

afterEach(cleanup);

function renderBinder(viewSpread = 1, totalSpreads = 3) {
  const onActivateCard = vi.fn();
  const setViewSpread = vi.fn();

  const result = render(
    <Binder
      viewSpread={viewSpread}
      setViewSpread={setViewSpread}
      totalSpreads={totalSpreads}
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

  return { ...result, onActivateCard, setViewSpread };
}

describe('Binder spread view', () => {
  it('renders the eight-column spread geometry and activates the exact card', () => {
    const { container, onActivateCard, setViewSpread } = renderBinder();

    expect(container.querySelectorAll('.cell')).toHaveLength(24);
    expect(screen.getByText(/Spread: Page 2 \(left\) \| Page 3 \(right\)/)).toBeTruthy();
    expect(container.querySelector('.binder-divider')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Previous spread/ }));
    expect(setViewSpread).toHaveBeenCalled();

    const cells = Array.from(container.querySelectorAll('.cell'));
    for (const cell of cells) fireEvent.click(cell);
    expect(onActivateCard).toHaveBeenCalledTimes(1);
    expect(onActivateCard).toHaveBeenCalledWith(card25);
  });

  it('disables spread navigation at the first and last spread', () => {
    const first = renderBinder(0);
    expect(screen.getByRole('button', { name: /Previous spread/ })).toHaveProperty('disabled', true);
    first.unmount();

    renderBinder(2, 3);
    expect(screen.getByRole('button', { name: /Next spread/ })).toHaveProperty('disabled', true);
  });
});
