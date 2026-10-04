import type { LoadedSet } from '~/domain/catalog';
import type { SetKey } from '~/domain/types';

import {
  META_KEYS,
  printingId,
  readMeta,
  writeMeta,
  type OwnedPrinting,
  type SwuDatabase,
} from './db';

/**
 * One-time import of the legacy app's `localStorage` inventory into IndexedDB.
 *
 * The legacy format is `inv:{SET}` → `{ [baseNumber]: count }`. It records how many
 * copies of a card you own but not which printings, so every count lands on that card's
 * Normal printing. That is the honest reading of the old data, and it means the binder
 * looks identical on first run. Re-importing a SW-Unlimited export (Phase 3) is what
 * corrects the variant breakdown afterwards.
 *
 * Non-destructive: localStorage is left untouched, so the legacy app keeps working and
 * the old data stays available as a fallback.
 */

export const LEGACY_INVENTORY_PREFIX = 'inv:';
/** Legacy bookkeeping keys that live under the same prefix but are not sets. */
const LEGACY_RESERVED = new Set(['inv:schema-version', 'inv:migration:v2:backup']);

export type MigrationReport = {
  ran: boolean;
  setsImported: number;
  printingsWritten: number;
  copiesWritten: number;
  /** Base numbers found in storage that no longer exist in the catalog. */
  unknownCards: Array<{ setKey: SetKey; base: number; count: number }>;
};

const EMPTY_REPORT: MigrationReport = {
  ran: false,
  setsImported: 0,
  printingsWritten: 0,
  copiesWritten: 0,
  unknownCards: [],
};

function readLegacyInventory(storage: Storage, setKey: SetKey): Record<string, unknown> {
  try {
    const raw = storage.getItem(`${LEGACY_INVENTORY_PREFIX}${setKey}`);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Every set key that has a legacy inventory record, ignoring bookkeeping keys. */
export function legacySetKeys(storage: Storage): SetKey[] {
  const keys: SetKey[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key || !key.startsWith(LEGACY_INVENTORY_PREFIX) || LEGACY_RESERVED.has(key)) continue;
    keys.push(key.slice(LEGACY_INVENTORY_PREFIX.length));
  }
  return keys;
}

/**
 * Translates legacy per-base counts into per-printing rows. Pure, so the mapping is
 * testable without a database.
 */
export function planMigration(
  storage: Storage,
  sets: Map<SetKey, LoadedSet>,
  now = Date.now(),
): { rows: OwnedPrinting[]; report: Omit<MigrationReport, 'ran'> } {
  const rows: OwnedPrinting[] = [];
  const unknownCards: MigrationReport['unknownCards'] = [];
  const touchedSets = new Set<SetKey>();
  let copiesWritten = 0;

  for (const setKey of legacySetKeys(storage)) {
    const set = sets.get(setKey);
    const inventory = readLegacyInventory(storage, setKey);

    for (const [rawBase, rawCount] of Object.entries(inventory)) {
      const base = Number(rawBase);
      const count = Number(rawCount);
      if (!Number.isInteger(base) || base <= 0 || !Number.isFinite(count) || count <= 0) continue;

      const card = set?.cardsByBase.get(base);
      const normal = card?.printings.find((p) => p.variant === 'normal') ?? card?.printings[0];
      if (!set || !card || !normal) {
        unknownCards.push({ setKey, base, count });
        continue;
      }

      touchedSets.add(setKey);
      copiesWritten += count;
      rows.push({
        id: printingId(setKey, normal.num),
        setKey,
        base,
        num: normal.num,
        variant: normal.variant,
        count,
        updatedAt: now,
      });
    }
  }

  return {
    rows,
    report: {
      setsImported: touchedSets.size,
      printingsWritten: rows.length,
      copiesWritten,
      unknownCards,
    },
  };
}

/**
 * Runs the import once. Safe to call on every boot: it no-ops if it has already run, or
 * if IndexedDB already holds data (so a user who starts fresh on a new device and syncs
 * from the cloud is never overwritten by stale localStorage).
 */
export async function migrateLocalStorage(
  database: SwuDatabase,
  storage: Storage,
  sets: Map<SetKey, LoadedSet>,
  now = Date.now(),
): Promise<MigrationReport> {
  if (await readMeta(database, META_KEYS.localStorageMigration)) return EMPTY_REPORT;

  if ((await database.owned.count()) > 0) {
    await writeMeta(database, META_KEYS.localStorageMigration, new Date(now).toISOString());
    return EMPTY_REPORT;
  }

  const { rows, report } = planMigration(storage, sets, now);
  if (rows.length) await database.owned.bulkPut(rows);
  await writeMeta(database, META_KEYS.localStorageMigration, new Date(now).toISOString());

  return { ran: true, ...report };
}
