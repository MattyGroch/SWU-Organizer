import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { manifestQuery } from '~/data/catalog';

import { AccountMenu } from './AccountMenu';

describe('AccountMenu', () => {
  it('opens import & export even when sync is unavailable', async () => {
    HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
    const queryClient = new QueryClient();
    queryClient.setQueryData(manifestQuery().queryKey, []);
    const user = userEvent.setup();
    // No SyncProvider: the default context is "unavailable".
    render(
      <QueryClientProvider client={queryClient}>
        <AccountMenu />
      </QueryClientProvider>,
    );

    await user.click(screen.getByLabelText('Sync unavailable: import & export'));
    await user.click(screen.getByRole('button', { name: 'Import & export' }));
    expect(await screen.findByRole('dialog', { name: 'Import & export' })).toBeInTheDocument();
  });
});
