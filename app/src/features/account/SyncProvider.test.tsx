import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetChangeListeners } from '~/data/changes';
import { db } from '~/data/db';
import { createDeckSync } from '~/data/sync/decks';
import type { SyncBundle } from '~/data/sync';
import { createInventorySync } from '~/data/sync/inventory';
import { parseSetCatalog, toLoadedSet } from '~/domain/catalog';
import { ToastProvider } from '~/ui/Toasts';

import { AccountMenu } from './AccountMenu';
import { FirstSyncDialog } from './FirstSyncDialog';
import { SyncProvider } from './SyncProvider';

const sor = toLoadedSet(
  parseSetCatalog({
    setKey: 'SOR',
    label: 'SOR',
    cards: [
      {
        base: 59,
        name: 'Card',
        type: 'Unit',
        aspects: [],
        printings: [{ num: '059', variant: 'normal' }],
      },
    ],
  }),
  new Map(),
);

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

type Server = {
  signedIn: boolean;
  inventories: Record<string, unknown>;
  puts: Array<{ url: string; body: unknown }>;
};

function fakeServer(server: Server) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/auth/me') {
      return server.signedIn
        ? new Response(JSON.stringify({ email: 'me@example.com' }), { status: 200 })
        : new Response('{}', { status: 401 });
    }
    if (url === '/api/inventories')
      return new Response(JSON.stringify({ sets: server.inventories }), { status: 200 });
    if (url === '/api/decks') {
      return new Response(
        JSON.stringify({ data: { customDecks: [], preconOwnership: {} }, version: 0 }),
        { status: 200 },
      );
    }
    if (init?.method === 'PUT') {
      server.puts.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ version: 1 }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  });
}

function renderSync(server: Server): SyncBundle {
  const fetchFn = fakeServer(server);
  vi.stubGlobal('fetch', fetchFn);
  const inventory = createInventorySync({
    getSet: () => sor,
    storage: memoryStorage(),
    fetchFn: fetchFn as typeof fetch,
  });
  const decks = createDeckSync({ storage: memoryStorage(), fetchFn: fetchFn as typeof fetch });
  const bundle: SyncBundle = {
    inventory,
    decks,
    setSignedIn: (v) => {
      inventory.setSignedIn(v);
      decks.setSignedIn(v);
    },
    ensureCatalog: async () => {},
    dispose: () => {
      inventory.dispose();
      decks.dispose();
    },
  };
  render(
    <ToastProvider>
      <SyncProvider bundle={bundle}>
        <AccountMenu />
        <FirstSyncDialog />
      </SyncProvider>
    </ToastProvider>,
  );
  return bundle;
}

const server = (over: Partial<Server> = {}): Server => ({
  signedIn: true,
  inventories: {},
  puts: [],
  ...over,
});

describe('cloud sync in the app', () => {
  beforeEach(async () => {
    await db.open();
    await db.owned.clear();
    await db.deckLibrary.clear();
    HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    resetChangeListeners();
    await db.owned.clear();
  });

  it('offers sign-in when signed out', async () => {
    renderSync(server({ signedIn: false }));
    expect(await screen.findByRole('link', { name: 'Sign in to sync' })).toHaveAttribute(
      'href',
      '/api/auth/login',
    );
  });

  it('uploads this device’s collection on the first sign-in to an empty cloud', async () => {
    await db.owned.put({
      id: 'SOR:059',
      setKey: 'SOR',
      base: 59,
      num: '059',
      variant: 'normal',
      count: 2,
      updatedAt: 0,
    });
    const s = server();
    const bundle = renderSync(s);
    await waitFor(
      () =>
        expect(s.puts).toContainEqual({
          url: '/api/inventories/SOR',
          body: { data: { '059': 2 } },
        }),
      {
        timeout: 4000,
      },
    );
    await waitFor(() => expect(screen.getByText('Synced')).toBeInTheDocument());
    bundle.dispose();
  });

  it('asks how to combine when this device and the cloud both have a collection', async () => {
    await db.owned.put({
      id: 'SOR:059',
      setKey: 'SOR',
      base: 59,
      num: '059',
      variant: 'normal',
      count: 3,
      updatedAt: 0,
    });
    const s = server({ inventories: { SOR: { data: { '059': 1 }, version: 4, updatedAt: 0 } } });
    const bundle = renderSync(s);

    const dialog = await screen.findByRole('dialog', { name: 'Turn on cloud sync' });
    expect(
      within(dialog).getByText('This device', { selector: 'dt' }).nextElementSibling,
    ).toHaveTextContent('3 cards in 1 sets');
    await userEvent.click(within(dialog).getByRole('button', { name: /Merge both/ }));

    await waitFor(
      () =>
        expect(s.puts).toContainEqual({
          url: '/api/inventories/SOR',
          body: { data: { '059': 3 } },
        }),
      {
        timeout: 4000,
      },
    );
    bundle.dispose();
  });
});
