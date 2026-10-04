import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { db } from '~/data/db';
import { parseSetCatalog, toLoadedSet } from '~/domain/catalog';

import { ImportDialog } from './ImportDialog';

const set = (setKey: string, base: number, num: string) =>
  toLoadedSet(
    parseSetCatalog({
      setKey,
      label: setKey,
      cards: [
        {
          base,
          name: 'Card',
          type: 'Unit',
          rarity: 'Common',
          aspects: [],
          printings: [{ num, variant: 'normal' }],
        },
      ],
    }),
    new Map(),
  );
const catalog = new Map([
  ['SOR', set('SOR', 1, '001')],
  ['HMW', set('HMW', 1, '001')],
]);

const vaultCsv = [
  '# swu-inv-export v1',
  'swuapi_uuid,set_code,card_number,variant_type,quantity,name,subtitle',
  'a,SOR,1,Standard,3,Card,',
  'b,HMW,1,Standard,1,Card,',
].join('\n');

beforeEach(async () => {
  await db.open();
  await db.owned.clear();
  // jsdom implements <dialog> but not its modal API.
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  // The binder's HMW count is already right; SOR has stale test data.
  await db.owned.bulkPut([
    {
      id: 'HMW:001',
      setKey: 'HMW',
      base: 1,
      num: '001',
      variant: 'normal',
      count: 2,
      updatedAt: 0,
    },
    {
      id: 'SOR:001',
      setKey: 'SOR',
      base: 1,
      num: '001',
      variant: 'normal',
      count: 9,
      updatedAt: 0,
    },
  ]);
});

afterEach(async () => {
  await db.owned.clear();
});

describe('ImportDialog', () => {
  it('replaces only the sets left ticked', async () => {
    const user = userEvent.setup();
    render(<ImportDialog catalog={catalog} onClose={() => {}} />);

    const file = new File([vaultCsv], 'hyperspacevault-inventory.csv', { type: 'text/csv' });
    await user.upload(screen.getByLabelText('Choose a file'), file);

    await user.click(await screen.findByRole('button', { name: /^HMW, 1 copies — included/ }));
    expect(screen.getByRole('button', { name: /^HMW, 1 copies — skipped/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await user.click(screen.getByRole('radio', { name: /Replace these sets/ }));
    expect(screen.getByText(/HMW stays as it is/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Import 3 copies' }));

    await waitFor(async () => expect((await db.owned.get('SOR:001'))?.count).toBe(3));
    expect((await db.owned.get('HMW:001'))?.count).toBe(2);
  });
});
