import { parseDeckLibrary, type DeckLibrary } from '~/domain/decks';

import { notifyDeckLibraryChanged } from './changes';
import { db, type SwuDatabase } from './db';

/**
 * The deck library is stored as one record rather than a row per deck.
 *
 * It is small, always read and written whole, and syncs as a single versioned blob — so
 * splitting it into rows would buy nothing and make conflict resolution harder.
 */

const LIBRARY_ID = 'library' as const;

export async function readDeckLibrary(database: SwuDatabase = db): Promise<DeckLibrary> {
  const row = await database.deckLibrary.get(LIBRARY_ID);
  // `parseDeckLibrary` takes the raw JSON text and already tolerates malformed input.
  return parseDeckLibrary(row?.json ?? null);
}

export async function writeDeckLibrary(
  library: DeckLibrary,
  database: SwuDatabase = db,
  now = Date.now(),
): Promise<void> {
  await database.deckLibrary.put({
    id: LIBRARY_ID,
    json: JSON.stringify(library),
    updatedAt: now,
  });
  notifyDeckLibraryChanged();
}

/** Writes without announcing a local change — used when applying a server value. */
export async function writeDeckLibraryQuietly(
  library: DeckLibrary,
  database: SwuDatabase = db,
  now = Date.now(),
): Promise<void> {
  await database.deckLibrary.put({
    id: LIBRARY_ID,
    json: JSON.stringify(library),
    updatedAt: now,
  });
}

export async function updateDeckLibrary(
  update: (current: DeckLibrary) => DeckLibrary,
  database: SwuDatabase = db,
  now = Date.now(),
): Promise<DeckLibrary> {
  const next = update(await readDeckLibrary(database));
  await writeDeckLibrary(next, database, now);
  return next;
}
