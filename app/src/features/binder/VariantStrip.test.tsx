import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Printing } from '~/domain/catalog';
import { indexOwnership } from '~/domain/ownership';

import { VariantStrip } from './VariantStrip';

const sorDroid: Printing[] = [
  { num: '059', variant: 'normal' },
  { num: '059F', variant: 'foil' },
  { num: '324', variant: 'hyperspace' },
  { num: '324F', variant: 'hyperspace-foil' },
];

function renderStrip(printings: Printing[], owned: Array<[Printing['variant'], number]> = []) {
  const onAdjust = vi.fn();
  const counts = indexOwnership(
    owned.map(([variant, count]) => ({ base: 59, variant, count })),
  ).get(59) ?? { total: 0, byVariant: {} };

  render(
    <VariantStrip
      printings={printings}
      counts={counts}
      cardName="2-1B Surgical Droid"
      onAdjust={onAdjust}
    />,
  );
  return { onAdjust };
}

describe('VariantStrip', () => {
  it('lists only the printings the card actually has', () => {
    renderStrip(sorDroid);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(4);
    // SOR units have no Prestige or Showcase run, so those keys are absent entirely.
    expect(screen.queryByText('Prestige')).toBeNull();
    expect(screen.queryByText('Showcase')).toBeNull();
  });

  it('shows the digit hotkey on each control, so the mapping is discoverable', () => {
    renderStrip(sorDroid);

    expect(screen.getByText('Normal').closest('button')).toHaveTextContent('1');
    expect(screen.getByText('Foil').closest('button')).toHaveTextContent('2');
    expect(screen.getByText('Hyperspace').closest('button')).toHaveTextContent('3');
    expect(screen.getByText('Hyperspace Foil').closest('button')).toHaveTextContent('4');
  });

  it('keeps a variant on its own digit even when earlier ones are absent', () => {
    // LAW/ASH/HMW list no plain Foil, so 2 is unused and Hyperspace stays on 3.
    renderStrip([
      { num: '001', variant: 'normal' },
      { num: '300', variant: 'hyperspace' },
      { num: '900', variant: 'prestige' },
    ]);

    expect(screen.getByText('Hyperspace').closest('button')).toHaveTextContent('3');
    expect(screen.getByText('Prestige').closest('button')).toHaveTextContent('5');
  });

  it('names each control for screen readers with its count and key', () => {
    renderStrip(sorDroid, [['hyperspace', 2]]);

    expect(
      screen.getByRole('button', {
        name: 'Add one Hyperspace 2-1B Surgical Droid, number 324. 2 owned. Keyboard 3.',
      }),
    ).toBeInTheDocument();
  });

  it('shows per-variant counts', () => {
    renderStrip(sorDroid, [
      ['normal', 3],
      ['hyperspace-foil', 1],
    ]);

    expect(screen.getByText('Normal').closest('button')).toHaveTextContent('3');
    expect(screen.getByText('Hyperspace Foil').closest('button')).toHaveTextContent('1');
    expect(screen.getByText('Foil').closest('button')).toHaveTextContent('0');
  });

  it('adds a copy of the clicked printing', async () => {
    const user = userEvent.setup();
    const { onAdjust } = renderStrip(sorDroid);

    await user.click(screen.getByText('Hyperspace').closest('button')!);

    expect(onAdjust).toHaveBeenCalledWith({ num: '324', variant: 'hyperspace' }, 1);
  });

  it('is hidden for a card with only one printing', () => {
    renderStrip([{ num: '001', variant: 'normal' }]);
    expect(screen.queryByRole('list')).toBeNull();
  });
});
