import { printingNumbers, type LoadedSet } from '~/domain/catalog';
import { BULK_KEY_SUFFIX } from '~/domain/ownership';
import { mergeInventory } from '~/domain/syncMerge';
import type { SetKey } from '~/domain/types';

import { onInventoryChanged } from '../changes';
import { db, printingId, type OwnedPrinting, type SwuDatabase } from '../db';
import { createSyncEngine, makeBroadcastPort, type SyncEngine } from './engine';

/**
 * Inventory sync adapter.
 *
 * The wire format is `{ printingNumber: count }`, the `Record<string, number>` the server
 * accepts. Pulled payloads are resolved back through the catalog.
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
 * A promo alias (`1050`, written by a device on an older catalog) is stored under the
 * printing it now belongs to (`P25-79`).
 *
 * Throws rather than store part of the payload: when the set's catalog is not loaded, or
 * a printing is one this catalog does not know (another device on a newer catalog). The
 * sync engine then leaves this device at its old version, so its next write merges with
 * the server's copy instead of replacing it with one missing those cards.
 */
export async function applyInventoryPayload(
  setKey: SetKey,
  payload: InventoryPayload,
  set: LoadedSet | undefined,
  database: SwuDatabase = db,
  now = Date.now(),
): Promise<number> {
  if (!set) throw new Error(`Cannot apply ${setKey}: its catalog is not loaded.`);

  const byNum = new Map<string, OwnedPrinting>();
  const unknown: string[] = [];
  for (const [num, rawCount] of Object.entries(payload)) {
    if (num.endsWith(BULK_KEY_SUFFIX)) continue;
    const count = Number(rawCount);
    if (!Number.isFinite(count) || count <= 0) continue;

    const base = set.baseByPrinting.get(num);
    const printing =
      base === undefined
        ? undefined
        : set.cardsByBase.get(base)?.printings.find((p) => printingNumbers(p).includes(num));
    if (base === undefined || !printing) {
      unknown.push(num);
      continue;
    }

    // Two devices' merged edits can leave more in bulk than owned; the total wins.
    const bulk = Math.min(Number(payload[num + BULK_KEY_SUFFIX]) || 0, count);
    const seen = byNum.get(printing.num);
    const total = (seen?.count ?? 0) + count;
    const totalBulk = (seen?.bulk ?? 0) + bulk;
    byNum.set(printing.num, {
      id: printingId(setKey, printing.num),
      setKey,
      base,
      num: printing.num,
      variant: printing.variant,
      count: total,
      ...(totalBulk > 0 && { bulk: totalBulk }),
      updatedAt: now,
    });
  }
  if (unknown.length) {
    throw new Error(`Cannot apply ${setKey}: unknown printings ${unknown.join(', ')}.`);
  }
  const rows = [...byNum.values()];

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
