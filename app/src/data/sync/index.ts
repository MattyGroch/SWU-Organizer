import type { QueryClient } from '@tanstack/react-query';

import { loadedSets, manifestQuery, setQuery } from '~/data/catalog';
import type { SetKey } from '~/domain/types';

import { createDeckSync } from './decks';
import { createInventorySync } from './inventory';

export type { SyncStatus } from './engine';

export type SyncBundle = {
  inventory: ReturnType<typeof createInventorySync>;
  decks: ReturnType<typeof createDeckSync>;
  setSignedIn: (value: boolean) => void;
  /**
   * Loads every set's catalog. Pulled card counts can only be stored once their set has
   * loaded — applied earlier, they would be dropped while still marked as received.
   */
  ensureCatalog: () => Promise<void>;
  dispose: () => void;
};

/**
 * Wires both synced resources to the same engine and starts listening for local writes.
 *
 * Both start signed out. Nothing is sent until `setSignedIn(true)`, but writes still queue
 * and persist, so a session that begins offline or unauthenticated loses nothing.
 */
export function startSync(queryClient: QueryClient): SyncBundle {
  const getSet = (setKey: SetKey) => {
    const entries = queryClient.getQueryData(manifestQuery().queryKey) ?? [];
    return loadedSets(queryClient, entries).get(setKey);
  };

  const inventory = createInventorySync({ getSet });
  const decks = createDeckSync();

  const stopInventory = inventory.start();
  const stopDecks = decks.start();

  const onOnline = () => {
    void inventory.flush();
    void decks.flush();
  };
  window.addEventListener('online', onOnline);

  return {
    inventory,
    decks,
    setSignedIn(value: boolean) {
      inventory.setSignedIn(value);
      decks.setSignedIn(value);
    },
    async ensureCatalog() {
      const entries = await queryClient.ensureQueryData(manifestQuery());
      await Promise.all(entries.map((entry) => queryClient.ensureQueryData(setQuery(entry))));
    },
    dispose() {
      stopInventory();
      stopDecks();
      window.removeEventListener('online', onOnline);
      inventory.dispose();
      decks.dispose();
    },
  };
}
