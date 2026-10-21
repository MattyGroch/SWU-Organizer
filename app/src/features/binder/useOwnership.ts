import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';

import { db, type OwnedPrinting } from '~/data/db';
import { useSharedCollection } from '~/data/shared';
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
  // Viewing a share, the counts are the owner's, and the local database is never read.
  const shared = useSharedCollection();
  const rows = useLiveQuery<OwnedPrinting[] | undefined>(
    () => (shared ? undefined : db.owned.where('setKey').equals(setKey).toArray()),
    [setKey, shared],
  );
  return useMemo(() => {
    const source = shared ? shared.owned.filter((row) => row.setKey === setKey) : rows;
    return source ? indexOwnership(source) : EMPTY;
  }, [rows, shared, setKey]);
}

/** Every owned printing in every set: yours, or the share's. `undefined` while loading. */
export function useAllOwned(): OwnedPrinting[] | undefined {
  const shared = useSharedCollection();
  const rows = useLiveQuery<OwnedPrinting[] | undefined>(
    () => (shared ? undefined : db.owned.toArray()),
    [shared],
  );
  return shared ? shared.owned : rows;
}
