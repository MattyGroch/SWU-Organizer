import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Binder, type BinderViewMode } from '../App';
import { LocatorPanel } from './LocatorPanel';
import { pageToSpread } from '../core/binder';
import { focusedPageForSpread } from '../core/binderView';
import type { Card } from '../core/types';

const card25: Card = {
  Name: 'Focused card',
  Number: 25,
  Set: 'SOR',
  Type: 'Unit',
};

afterEach(cleanup);

function renderBinder(
  viewMode: 'single' | 'spread',
  focusedPage = 3,
  totalPages = 5,
) {
  const onActivateCard = vi.fn();
  const onFocusedPageChange = vi.fn();
  const onViewModeChange = vi.fn();
  const setViewSpread = vi.fn();

  const result = render(
    <Binder
      viewSpread={1}
      setViewSpread={setViewSpread}
      totalSpreads={3}
      totalPages={totalPages}
      viewMode={viewMode}
      focusedPage={focusedPage}
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

  it('disables physical-page navigation at the first and last page', () => {
    const firstPage = renderBinder('single', 1, 5);
    expect(screen.getByRole('button', { name: 'Previous page' })).toHaveProperty('disabled', true);
    firstPage.unmount();

    renderBinder('single', 5, 5);
    expect(screen.getByRole('button', { name: 'Next page' })).toHaveProperty('disabled', true);
  });

  it('keeps one physical-page anchor across parent-controlled modes without changing selection', () => {
    function BinderHarness() {
      const [viewMode, setViewMode] = useState<BinderViewMode>('single');
      const [focusedPage, setFocusedPage] = useState(3);
      const totalPages = 9;
      const viewSpread = pageToSpread(focusedPage);
      const setViewSpread: React.Dispatch<React.SetStateAction<number>> = next => {
        setFocusedPage(currentPage => {
          const currentSpread = pageToSpread(currentPage);
          const targetSpread = typeof next === 'function' ? next(currentSpread) : next;
          return focusedPageForSpread(currentPage, targetSpread, totalPages);
        });
      };
      const active = {
        card: card25,
        number: 25,
        page: 3,
        row: 1,
        column: 1,
        spreadCol: 5,
        spreadRow: 1,
      };

      return (
        <>
          <LocatorPanel
            selection={active}
            quantity={0}
            maximum={3}
            onDecrease={vi.fn()}
            onIncrease={vi.fn()}
          />
          <Binder
            viewSpread={viewSpread}
            setViewSpread={setViewSpread}
            totalSpreads={5}
            totalPages={totalPages}
            viewMode={viewMode}
            focusedPage={focusedPage}
            onFocusedPageChange={setFocusedPage}
            onViewModeChange={setViewMode}
            onActivateCard={vi.fn()}
            active={active}
            presentNumbers={new Set([25])}
            numToAspectSpec={new Map()}
            byNumber={new Map([[25, card25]])}
            inventory={{}}
            inc={vi.fn()}
            dec={vi.fn()}
            setKey="SOR"
            showHelpModal={false}
            setShowHelpModal={vi.fn()}
          />
        </>
      );
    }

    const { container } = render(<BinderHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(container.querySelector('.binder-subtitle')?.textContent).toContain('Page 4');
    expect(container.querySelector('.locator-panel')?.textContent).toContain('Page3');
    expect(container.querySelectorAll('rect[stroke="#ffffff"]')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Spread' }));
    expect(container.querySelector('.binder-subtitle')?.textContent).toContain('Page 4 (left) | Page 5 (right)');

    fireEvent.click(screen.getByRole('button', { name: /Next spread/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Single Page' }));
    expect(container.querySelector('.binder-subtitle')?.textContent).toContain('Page 6');
    expect(container.querySelector('.locator-panel')?.textContent).toContain('Page3');
  });
});
