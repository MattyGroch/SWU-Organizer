import { applyDeconstruct } from '~/domain/deckBuild';
import { parseDeckLibrary, type DeckLibrary } from '~/domain/decks';

import { notifyDeckLibraryChanged, notifyInventoryChanged } from './changes';
import { db, type SwuDatabase } from './db';
import { spillCards, type QuotaOf } from './spill';

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

/**
 * Takes a built deck apart: every copy goes back where it came from, the binder or the
 * bulk box. A pocket that filled up while its copies were out keeps only its best playset;
 * the weakest extras go to the bulk box. Returns how many copies that sent to bulk.
 */
export async function deconstructDeck(
  deckId: string,
  quotaOf: QuotaOf,
  database: SwuDatabase = db,
  now = Date.now(),
): Promise<number> {
  let cards: Array<{ setKey: string; base: number }> = [];
  let moved = 0;
  await database.transaction('rw', database.owned, database.deckLibrary, async () => {
    const library = await readDeckLibrary(database);
    const deck = library.customDecks.find((d) => d.id === deckId);
    if (!deck) return;
    cards = deck.pulledCards.map((ref) => ({ setKey: ref.setKey, base: ref.baseNumber }));
    const next = applyDeconstruct(library, deckId, new Date(now).toISOString());
    await writeDeckLibraryQuietly(next, database, now);
    moved = await spillCards(database, cards, quotaOf, now);
  });
  notifyDeckLibraryChanged();
  if (moved)
    for (const setKey of new Set(cards.map((c) => c.setKey))) notifyInventoryChanged(setKey);
  return moved;
}
