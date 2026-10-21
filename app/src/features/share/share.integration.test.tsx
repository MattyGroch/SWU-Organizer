import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '~/data/db';
import { buildRouter } from '~/router';
import { ToastProvider } from '~/ui/Toasts';

/**
 * A share link over the real stack: route → share fetch → catalog resolve → binder render,
 * with the visitor's own IndexedDB left exactly as it was.
 */

const setsDir = join(dirname(fileURLToPath(import.meta.url)), '../../../public/sets');
const TOKEN = 'tok_abc123';

const cell = (name: RegExp) => within(screen.getByRole('grid')).getByRole('button', { name });

let shared: {
  sets: Record<string, { data: Record<string, number> }>;
  decks: unknown;
  hiddenSets: string[];
};

async function renderAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const router = buildRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { router };
}

beforeEach(async () => {
  await db.open();
  await db.owned.clear();
  // SOR #1 (Director Krennic): one in the binder, one more in the owner's bulk box.
  shared = {
    sets: { SOR: { data: { '001': 2, '001@bulk': 1 } } },
    decks: { customDecks: [], preconOwnership: {} },
    hiddenSets: ['IBH', 'TS26', 'SHD'],
  };

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === `/api/shared/${TOKEN}`) return new Response(JSON.stringify(shared));
      if (url.startsWith('/api/')) return new Response('{}', { status: 404 });
      try {
        const file = url.replace(/^\/sets\//, '');
        return new Response(readFileSync(join(setsDir, file), 'utf8'));
      } catch {
        return new Response('not found', { status: 404 });
      }
    }),
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await db.owned.clear();
  await db.meta.clear();
});

describe('share link', () => {
  it('shows the owner’s binder, not this device’s', async () => {
    // The visitor owns a Krennic of their own, which the share must not show.
    await db.owned.put({
      id: 'SOR:001',
      setKey: 'SOR',
      base: 1,
      num: '001',
      variant: 'normal',
      count: 4,
      updatedAt: 1,
    });
    await renderAt(`/share/${TOKEN}/SOR/binder`);

    await waitFor(() => expect(screen.getByRole('grid')).toBeInTheDocument(), { timeout: 5000 });
    expect(cell(/Director Krennic.*1 of 1 in binder/)).toBeInTheDocument();
    expect(screen.getByText('Shared collection')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Exit' })).toHaveAttribute('href', '/');
    // None of your own app's tabs or account.
    expect(screen.queryByRole('link', { name: 'Scan' })).not.toBeInTheDocument();
    // And the visitor's own row is just as it was.
    expect(await db.owned.toArray()).toMatchObject([{ id: 'SOR:001', count: 4 }]);
  });

  it('offers no way to change anything, and the keys do nothing', async () => {
    const user = userEvent.setup();
    await renderAt(`/share/${TOKEN}/SOR/binder`);
    await waitFor(() => expect(screen.getByRole('grid')).toBeInTheDocument(), { timeout: 5000 });

    await user.click(cell(/Director Krennic/));
    expect(
      screen.queryByRole('button', { name: /Add one Director Krennic/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove one/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mass edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Hide sets/ })).not.toBeInTheDocument();

    await user.keyboard('+');
    await user.keyboard('{Shift>}_{/Shift}');
    expect(await db.owned.count()).toBe(0);
    expect(cell(/Director Krennic.*1 of 1 in binder/)).toBeInTheDocument();
  });

  it('opens on the owner’s newest set they haven’t hidden', async () => {
    const { router } = await renderAt(`/share/${TOKEN}`);
    await waitFor(() => expect(screen.getByText('Shared collection')).toBeInTheDocument());
    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(new RegExp(`^/share/${TOKEN}/[A-Z0-9]+/`)),
    );
    const setKey = router.state.location.pathname.split('/')[3];
    expect(shared.hiddenSets).not.toContain(setKey);
  });

  it('keeps a hidden set hidden', async () => {
    const { router } = await renderAt(`/share/${TOKEN}/SHD/binder`);
    await waitFor(() =>
      expect(router.state.location.pathname).not.toBe(`/share/${TOKEN}/SHD/binder`),
    );
    expect(router.state.location.pathname).toMatch(new RegExp(`^/share/${TOKEN}/`));
  });

  it('stays inside the share when changing set or tab', async () => {
    const user = userEvent.setup();
    const { router } = await renderAt(`/share/${TOKEN}/SOR/binder`);
    await waitFor(() => expect(screen.getByRole('grid')).toBeInTheDocument(), { timeout: 5000 });

    await user.click(screen.getByRole('button', { name: 'Next set' }));
    await waitFor(() =>
      expect(router.state.location.pathname).not.toBe(`/share/${TOKEN}/SOR/binder`),
    );
    expect(router.state.location.pathname).toMatch(
      new RegExp(`^/share/${TOKEN}/[A-Z0-9]+/binder$`),
    );

    await user.click(screen.getByRole('link', { name: 'Bulk' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/share/${TOKEN}/bulk`));
    await waitFor(() =>
      expect(screen.getByText(/1 copy of 1 card in the bulk box/)).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('button', { name: /Remove .* from the bulk box/ }),
    ).not.toBeInTheDocument();
  });

  it('says so when the link has been turned off', async () => {
    await renderAt('/share/not-a-real-token');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /isn’t shared any more/ })).toBeInTheDocument(),
    );
    expect(screen.getByRole('link', { name: 'Go to your collection' })).toHaveAttribute(
      'href',
      '/',
    );
  });
});
