import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LocatorPanel } from './LocatorPanel';

describe('LocatorPanel', () => {
  it('shows the readable physical location and adjusts quantity', () => {
    const onDecrease = vi.fn();
    const onIncrease = vi.fn();

    render(
      <LocatorPanel
        selection={{
          card: {
            Name: 'Darth Vader',
            Subtitle: 'Dark Lord of the Sith',
            Number: 10,
            Type: 'Leader',
            Set: 'SOR',
          },
          number: 10,
          page: 1,
          row: 3,
          column: 2,
          spreadCol: 6,
          spreadRow: 3,
        }}
        quantity={0}
        maximum={1}
        onDecrease={onDecrease}
        onIncrease={onIncrease}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Darth Vader' })).toBeTruthy();
    expect(screen.getByText('Page')).toBeTruthy();
    expect(screen.getByText('Column')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.queryByText('6')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Increase Darth Vader quantity' }));
    expect(onIncrease).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Decrease Darth Vader quantity' }));
    expect(onDecrease).not.toHaveBeenCalled();
  });
});
