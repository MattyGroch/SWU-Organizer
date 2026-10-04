import { parseDeckLibrary, type DeckLibrary } from '~/domain/decks';
import { mergeDeckLibraries } from '~/domain/syncMerge';

import { onDeckLibraryChanged } from '../changes';
import { db, type SwuDatabase } from '../db';
import { readDeckLibrary, writeDeckLibraryQuietly } from '../deckLibrary';
import { createSyncEngine, makeBroadcastPort, type SyncEngine } from './engine';

/**
 * Deck library sync adapter.
 *
 * The library is a single record, so the engine's key is a constant. That is the whole
 * difference from the inventory adapter — which is the point of having one engine.
 */

export const DECK_LIBRARY_KEY = 'library';

export type DeckSyncDeps = {
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  fetchFn?: typeof fetch;
  database?: SwuDatabase;
};

export function createDeckSync(deps: DeckSyncDeps = {}): SyncEngine<DeckLibrary> & {
  start: () => () => void;
  queueCurrent: () => Promise<void>;
} {
  const database = deps.database ?? db;

  const engine = createSyncEngine<DeckLibrary>({
    name: 'decks',
    recordUrl: () => '/api/decks',
    storage: deps.storage ?? localStorage,
    fetch: deps.fetchFn ?? ((input, init) => fetch(input, init)),
    broadcast: makeBroadcastPort<DeckLibrary>('decks'),
    isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine),
    onApply: async (_key, data) => {
      // Re-parse rather than trusting the wire: a server payload is untrusted input.
      await writeDeckLibraryQuietly(parseDeckLibrary(JSON.stringify(data)), database);
    },
    // Two devices' libraries combine deck by deck instead of one replacing the other.
    merge: (local, remote, base) =>
      mergeDeckLibraries(local, parseDeckLibrary(JSON.stringify(remote)), base),
  });

  async function queueCurrent(): Promise<void> {
    engine.queue(DECK_LIBRARY_KEY, await readDeckLibrary(database));
  }

  return {
    ...engine,
    queueCurrent,
    start() {
      return onDeckLibraryChanged(() => void queueCurrent());
    },
  };
}
