import type { LoadedSet } from '~/domain/catalog';
import { BULK_KEY_SUFFIX } from '~/domain/ownership';
import { mergeInventory } from '~/domain/syncMerge';
import type { SetKey } from '~/domain/types';

import { onInventoryChanged } from '../changes';
import { db, printingId, type OwnedPrinting, type SwuDatabase } from '../db';
import { createSyncEngine, makeBroadcastPort, type SyncEngine } from './engine';

/**
 * Inventory sync adapter.
 *
 * The wire format is `{ printingNumber: count }`, which is the same `Record<string,
 * number>` the server already accepts — so moving from base-number keys to printing-number
 * keys needs no server change. Pulled payloads are resolved back through the catalog,
 * which also lets a pre-existing cloud backup written with base numbers ("59") load
 * correctly against the new printing numbers ("059").
 *
 * Copies in the bulk box ride along under their own key, "059@bulk", so a merge treats
 * them like any other count.
 */

export type InventoryPayload = Record<string, number>;

export async function snapshotSet(
  setKey: SetKey,
  database: SwuDatabase = db,
): Promise<InventoryPayload> {
  const rows = await database.owned.where('setKey').equals(setKey).toArray();
  const payload: InventoryPayload = {};
  for (const row of rows) {
    payload[row.num] = row.count;
    if (row.bulk) payload[row.num + BULK_KEY_SUFFIX] = row.bulk;
  }
  return payload;
}

/**
 * Writes a server payload into the local database, replacing that set.
 *
 * Entries that no longer resolve against the catalog are dropped rather than written as
 * orphans — but the set is only replaced when at least something resolved, so a catalog
 * that failed to load cannot wipe a set.
 */
export async function applyInventoryPayload(
  setKey: SetKey,
  payload: InventoryPayload,
  set: LoadedSet | undefined,
  database: SwuDatabase = db,
  now = Date.now(),
): Promise<number> {
  if (!set) return 0;

  const rows: OwnedPrinting[] = [];
  for (const [num, rawCount] of Object.entries(payload)) {
    if (num.endsWith(BULK_KEY_SUFFIX)) continue;
    const count = Number(rawCount);
    if (!Number.isFinite(count) || count <= 0) continue;

    // Accept "059", "59" and "059F"; older backups wrote base numbers without padding.
    const candidates = [num, num.toUpperCase(), String(Number(num)).padStart(3, '0')];
    let resolved: { base: number; num: string } | undefined;
    for (const candidate of candidates) {
      const base = set.baseByPrinting.get(candidate);
      if (base !== undefined) {
        resolved = { base, num: candidate };
        break;
      }
    }
    if (!resolved) continue;

    const printing = set.cardsByBase
      .get(resolved.base)
      ?.printings.find((p) => p.num === resolved.num);
    if (!printing) continue;

    // Two devices' merged edits can leave more in bulk than owned; the total wins.
    const bulk = Math.min(Number(payload[num + BULK_KEY_SUFFIX]) || 0, count);
    rows.push({
      id: printingId(setKey, printing.num),
      setKey,
      base: resolved.base,
      num: printing.num,
      variant: printing.variant,
      count,
      ...(bulk > 0 && { bulk }),
      updatedAt: now,
    });
  }

  await database.transaction('rw', database.owned, async () => {
    await database.owned.where('setKey').equals(setKey).delete();
    if (rows.length) await database.owned.bulkPut(rows);
  });

  return rows.length;
}

export type InventorySyncDeps = {
  /** Resolves a set's catalog, needed to turn wire keys back into printings. */
  getSet: (setKey: SetKey) => LoadedSet | undefined;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  fetchFn?: typeof fetch;
  database?: SwuDatabase;
};

export function createInventorySync(deps: InventorySyncDeps): SyncEngine<InventoryPayload> & {
  start: () => () => void;
} {
  const database = deps.database ?? db;

  const engine = createSyncEngine<InventoryPayload>({
    name: 'inventory',
    recordUrl: (key) => `/api/inventories/${encodeURIComponent(key)}`,
    storage: deps.storage ?? localStorage,
    fetch: deps.fetchFn ?? ((input, init) => fetch(input, init)),
    broadcast: makeBroadcastPort<InventoryPayload>('inventory'),
    isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine),
    onApply: async (key, data) => {
      await applyInventoryPayload(key, data, deps.getSet(key), database);
    },
    // Edits to the same set on two devices both survive, printing by printing.
    merge: mergeInventory,
  });

  return {
    ...engine,
    /** Subscribes to local writes; returns an unsubscribe. */
    start() {
      return onInventoryChanged((setKey) => {
        void snapshotSet(setKey, database).then((payload) => engine.queue(setKey, payload));
      });
    },
  };
}
