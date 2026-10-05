import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '~/data/db';
import { queueScan } from '~/data/intake';
import { parseSetCatalog, toLoadedSet } from '~/domain/catalog';

import { IntakePage } from './IntakePage';

const sor = toLoadedSet(
  parseSetCatalog({
    setKey: 'SOR',
    label: 'SOR',
    cards: [
      {
        base: 59,
        name: '2-1B Surgical Droid',
        type: 'Unit',
        aspects: [],
        printings: [
          { num: '059', variant: 'normal' },
          { num: '059F', variant: 'foil' },
          { num: '324', variant: 'hyperspace' },
        ],
      },
    ],
  }),
  new Map(),
);
const sets = new Map([['SOR', sor]]);
const normal = { setKey: 'SOR', base: 59, num: '059', variant: 'normal' } as const;

const linesByNum = async () =>
  Object.fromEntries((await db.intakeLines.toArray()).map((l) => [l.num, l.count]));

describe('Intake on a phone: the Fix sheet', () => {
  beforeEach(async () => {
    // jsdom implements <dialog> but not its modal API.
    HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    };
    await db.open();
    await db.intakeBatches.clear();
    await db.intakeLines.clear();
  });

  it('moves a single scanned copy to whichever printing is tapped', async () => {
    await queueScan(normal);
    render(<IntakePage sets={sets} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Fix 2-1B Surgical Droid' }));

    const sheet = screen.getByRole('dialog');
    const choices = within(sheet).getByRole('radiogroup', { name: /Printing of/ });
    expect(within(choices).getByRole('radio', { name: 'Normal' })).toBeChecked();

    await userEvent.click(within(choices).getByRole('radio', { name: 'Hyperspace' }));
    await waitFor(async () => expect(await linesByNum()).toEqual({ '324': 1 }));
    await waitFor(() =>
      expect(within(sheet).getByRole('radio', { name: 'Hyperspace' })).toBeChecked(),
    );

    await userEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('allocates copies one at a time when there are several, and can remove the card', async () => {
    await queueScan(normal);
    await queueScan(normal);
    render(<IntakePage sets={sets} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Fix 2-1B Surgical Droid' }));

    const sheet = screen.getByRole('dialog');
    await userEvent.click(within(sheet).getByRole('button', { name: /^Foil: 0/ }));
    await waitFor(async () => expect(await linesByNum()).toEqual({ '059': 1, '059F': 1 }));

    await userEvent.click(within(sheet).getByRole('button', { name: 'Remove from batch' }));
    await waitFor(async () => expect(await db.intakeLines.count()).toBe(0));
  });
});
