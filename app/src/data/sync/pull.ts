import type { SetKey } from '~/domain/types';
import { mergeDeckLibraries, mergeInventory } from '~/domain/syncMerge';
import { parseDeckLibrary, type DeckLibrary } from '~/domain/decks';

import { db, type SwuDatabase } from '../db';
import { readDeckLibrary, writeDeckLibraryQuietly } from '../deckLibrary';

import { DECK_LIBRARY_KEY } from './decks';
import type { SyncBundle } from './index';
import { snapshotSet, type InventoryPayload } from './inventory';

/**
 * Bringing the cloud copy down, and the very first sync on a device.
 *
 * The engine only pushes; this is the other half. A pull applies every newer server
 * record (merging with anything unsent), and uploads records the server has never seen.
 */

type Versioned<T> = { data: T; version: number };

export type CloudSnapshot = {
  inventories: Record<SetKey, Versioned<InventoryPayload>>;
  decks: Versioned<DeckLibrary>;
};

export type FetchCloudResult = CloudSnapshot | 'signedOut' | 'unavailable';

export async function fetchCloud(fetchFn: typeof fetch = fetch): Promise<FetchCloudResult> {
  try {
    const [inv, decks] = await Promise.all([
      fetchFn('/api/inventories', { credentials: 'include' }),
      fetchFn('/api/decks', { credentials: 'include' }),
    ]);
    if (inv.status === 401 || decks.status === 401) return 'signedOut';
    if (!inv.ok || !decks.ok) return 'unavailable';
    const invBody = (await inv.json()) as { sets?: CloudSnapshot['inventories'] };
    const deckBody = (await decks.json()) as Partial<Versioned<unknown>>;
    return {
      inventories: invBody.sets ?? {},
      decks: {
        data: parseDeckLibrary(JSON.stringify(deckBody.data ?? null)),
        version: typeof deckBody.version === 'number' ? deckBody.version : 0,
      },
    };
  } catch {
    return 'unavailable';
  }
}

const hasCards = (payload: InventoryPayload) => Object.values(payload).some((n) => n > 0);
const hasDecks = (library: DeckLibrary) =>
  library.customDecks.length > 0 || Object.values(library.preconOwnership).some((n) => n > 0);

async function localSetKeys(database: SwuDatabase): Promise<SetKey[]> {
  return [...new Set((await database.owned.toArray()).map((row) => row.setKey))];
}

export type DataSummary = { cards: number; sets: number; decks: number };

export async function summarizeLocal(database: SwuDatabase = db): Promise<DataSummary> {
  const rows = await database.owned.toArray();
  const library = await readDeckLibrary(database);
  return {
    cards: rows.reduce((sum, row) => sum + row.count, 0),
    sets: new Set(rows.map((row) => row.setKey)).size,
    decks: library.customDecks.length,
  };
}

export function summarizeCloud(snapshot: CloudSnapshot): DataSummary {
  const sets = Object.values(snapshot.inventories).filter((s) => hasCards(s.data));
  return {
    cards: sets.reduce((sum, s) => sum + Object.values(s.data).reduce((a, b) => a + b, 0), 0),
    sets: sets.length,
    decks: snapshot.decks.data.customDecks.length,
  };
}

/**
 * True when this device has never synced and both it and the cloud hold data — the one
 * case where guessing could lose something, so the user is asked instead.
 */
export async function needsFirstSyncChoice(
  bundle: Pick<SyncBundle, 'inventory' | 'decks'>,
  snapshot: CloudSnapshot,
  database: SwuDatabase = db,
): Promise<boolean> {
  const neverSynced =
    bundle.inventory.getState().lastPulledAt === 0 && bundle.decks.getState().lastPulledAt === 0;
  if (!neverSynced) return false;
  const cloudHas =
    Object.values(snapshot.inventories).some((s) => hasCards(s.data)) ||
    hasDecks(snapshot.decks.data);
  if (!cloudHas) return false;
  const local = await summarizeLocal(database);
  const library = await readDeckLibrary(database);
  return local.cards > 0 || hasDecks(library);
}

/** A routine pull: take newer server copies; upload what the server has never seen. */
export async function applyPull(
  bundle: Pick<SyncBundle, 'inventory' | 'decks'>,
  snapshot: CloudSnapshot,
  database: SwuDatabase = db,
): Promise<void> {
  for (const [setKey, record] of Object.entries(snapshot.inventories)) {
    await bundle.inventory.receive(setKey, record.data, record.version);
  }
  for (const setKey of await localSetKeys(database)) {
    if (snapshot.inventories[setKey]) continue;
    const state = bundle.inventory.getState();
    if ((state.versions[setKey] ?? 0) === 0 && state.pending[setKey] === undefined) {
      bundle.inventory.queue(setKey, await snapshotSet(setKey, database));
    }
  }

  if (snapshot.decks.version > 0) {
    await bundle.decks.receive(DECK_LIBRARY_KEY, snapshot.decks.data, snapshot.decks.version);
  } else if (hasDecks(await readDeckLibrary(database))) {
    const state = bundle.decks.getState();
    if (state.pending[DECK_LIBRARY_KEY] === undefined) await bundle.decks.queueCurrent();
  }

  bundle.inventory.markPulled();
  bundle.decks.markPulled();
}

export type FirstSyncChoice = 'cloud' | 'device' | 'merge';

/**
 * Settles a device's first sync when both sides hold data.
 *
 * - `cloud`  — this device takes the cloud copy; anything only here is removed.
 * - `device` — the cloud takes this device's copy; anything only in the cloud is removed.
 * - `merge`  — both kept: the higher count per printing, every deck from both sides.
 */
export async function resolveFirstSync(
  bundle: Pick<SyncBundle, 'inventory' | 'decks'>,
  snapshot: CloudSnapshot,
  choice: FirstSyncChoice,
  database: SwuDatabase = db,
): Promise<void> {
  const setKeys = new Set([
    ...(await localSetKeys(database)),
    ...Object.keys(snapshot.inventories),
  ]);

  for (const setKey of setKeys) {
    const cloud = snapshot.inventories[setKey] ?? { data: {}, version: 0 };
    const local = await snapshotSet(setKey, database);

    if (choice === 'cloud') {
      if (cloud.version > 0) await bundle.inventory.applyRemote(setKey, cloud.data, cloud.version);
      else await database.owned.where('setKey').equals(setKey).delete();
      continue;
    }

    const next = choice === 'device' ? local : mergeInventory(local, cloud.data, undefined);
    // The server still holds the cloud copy; that is the base later merges compare with.
    if (cloud.version > 0) bundle.inventory.recordServer(setKey, cloud.data, cloud.version);
    if (choice === 'merge') await bundle.inventory.applyLocal(setKey, next);
    bundle.inventory.queue(setKey, next);
  }

  const localLibrary = await readDeckLibrary(database);
  const cloudDecks = snapshot.decks;
  if (choice === 'cloud') {
    if (cloudDecks.version > 0) {
      await bundle.decks.applyRemote(DECK_LIBRARY_KEY, cloudDecks.data, cloudDecks.version);
    }
  } else {
    const next =
      choice === 'device'
        ? localLibrary
        : mergeDeckLibraries(localLibrary, cloudDecks.data, undefined);
    if (choice === 'merge') await writeDeckLibraryQuietly(next, database);
    if (cloudDecks.version > 0) {
      bundle.decks.recordServer(DECK_LIBRARY_KEY, cloudDecks.data, cloudDecks.version);
    }
    bundle.decks.queue(DECK_LIBRARY_KEY, next);
  }

  bundle.inventory.markPulled();
  bundle.decks.markPulled();
}
