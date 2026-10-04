import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';

import { db } from '~/data/db';
import { indexOwnership, type OwnedCounts } from '~/domain/ownership';
import type { SetKey } from '~/domain/types';

const EMPTY = new Map<number, OwnedCounts>();

/**
 * Live per-card ownership for a set.
 *
 * The database is the single source of truth — there is no second copy of the inventory
 * in React state to keep in sync. The legacy app held one in `useState` and another in
 * localStorage, and reconciled them by hand through `readSetInv` / `writeSetInv` /
 * `createInventoryExportSnapshot`, which read storage back out inside render callbacks.
 *
 * `useLiveQuery` also means a write from anywhere — a bulk action, an import, the scanner
 * — re-renders the binder without any explicit notification plumbing.
 */
export function useSetOwnership(setKey: SetKey): ReadonlyMap<number, OwnedCounts> {
  const rows = useLiveQuery(() => db.owned.where('setKey').equals(setKey).toArray(), [setKey]);
  return useMemo(() => (rows ? indexOwnership(rows) : EMPTY), [rows]);
}
