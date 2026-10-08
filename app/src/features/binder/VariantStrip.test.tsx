import { render, screen, within } from '@testing-library/react';
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

    expect(screen.getByText('Normal').closest('li')).toHaveTextContent('1');
    expect(screen.getByText('Foil').closest('li')).toHaveTextContent('2');
    expect(screen.getByText('Hyperspace').closest('li')).toHaveTextContent('3');
    expect(screen.getByText('Hyperspace Foil').closest('li')).toHaveTextContent('4');
  });

  it('keeps a variant on its own digit even when earlier ones are absent', () => {
    // LAW/ASH/HMW list no plain Foil, so 2 is unused and Hyperspace stays on 3.
    renderStrip([
      { num: '001', variant: 'normal' },
      { num: '300', variant: 'hyperspace' },
      { num: '900', variant: 'prestige' },
    ]);

    expect(screen.getByText('Hyperspace').closest('li')).toHaveTextContent('3');
    expect(screen.getByText('Prestige').closest('li')).toHaveTextContent('5');
  });

  it('names each control for screen readers with its count and key', () => {
    renderStrip(sorDroid, [['hyperspace', 2]]);

    expect(
      screen.getByRole('button', {
        name: 'Add one Hyperspace 2-1B Surgical Droid, number 324. 2 in binder. Keyboard 3.',
      }),
    ).toBeInTheDocument();
  });

  it('shows per-variant counts', () => {
    renderStrip(sorDroid, [
      ['normal', 3],
      ['hyperspace-foil', 1],
    ]);

    expect(screen.getByText('Normal').closest('li')).toHaveTextContent('3');
    expect(screen.getByText('Hyperspace Foil').closest('li')).toHaveTextContent('1');
    expect(screen.getByText('Foil').closest('li')).toHaveTextContent('0');
  });

  it('adds and removes a copy of a printing with + and −, for mouse and touch', async () => {
    const user = userEvent.setup();
    const { onAdjust } = renderStrip(sorDroid, [['hyperspace', 2]]);
    const hyperspace = screen.getByText('Hyperspace').closest('li')!;

    await user.click(within(hyperspace).getByRole('button', { name: /^Add one Hyperspace/ }));
    expect(onAdjust).toHaveBeenLastCalledWith({ num: '324', variant: 'hyperspace' }, 1);

    await user.click(within(hyperspace).getByRole('button', { name: /^Remove one Hyperspace/ }));
    expect(onAdjust).toHaveBeenLastCalledWith({ num: '324', variant: 'hyperspace' }, -1);
  });

  it('cannot remove a printing you own none of', () => {
    renderStrip(sorDroid);
    const foil = screen.getByText('Foil').closest('li')!;
    expect(within(foil).getByRole('button', { name: /^Remove one Foil/ })).toBeDisabled();
  });

  it('still shows the strip for a card with only one printing', () => {
    renderStrip([{ num: '010', variant: 'normal' }]);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^Add one Normal/ })).toBeInTheDocument();
  });

  it("steps a promo's name through its pictures, back round to the default", async () => {
    const user = userEvent.setup();
    const promo: Printing = { num: 'P26-14', variant: 'promo', aliases: ['G25-3', 'P26-228'] };
    const onChoosePromoArt = vi.fn();
    const props = {
      printings: [{ num: '031', variant: 'normal' } as Printing, promo],
      counts: { total: 1, byVariant: { promo: 1 } },
      cardName: 'Hera Syndulla',
      onAdjust: vi.fn(),
      onChoosePromoArt,
    };
    const { rerender } = render(<VariantStrip {...props} />);

    await user.click(screen.getByRole('button', { name: /^Promo art 1 of 3/ }));
    expect(onChoosePromoArt).toHaveBeenLastCalledWith('G25-3');

    rerender(<VariantStrip {...props} promoArt="P26-228" />);
    await user.click(screen.getByRole('button', { name: /^Promo art 3 of 3/ }));
    expect(onChoosePromoArt).toHaveBeenLastCalledWith(undefined);
    // The count is unaffected: the picture is cosmetic.
    expect(screen.getByText('Promo').closest('li')).toHaveTextContent('1');
  });

  it('offers no picker for a promo with one picture', () => {
    render(
      <VariantStrip
        printings={[{ num: 'SOROP-015', variant: 'promo' }]}
        counts={{ total: 0, byVariant: {} }}
        cardName="Bossk"
        onAdjust={vi.fn()}
        onChoosePromoArt={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /art 1 of/ })).toBeNull();
  });
});
