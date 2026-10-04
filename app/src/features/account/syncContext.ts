import { createContext, useContext } from 'react';

import type { Account } from '~/data/sync/account';
import type { DataSummary, FirstSyncChoice } from '~/data/sync/pull';

/** What the header and dialogs need to know about cloud sync. */
export type SyncView = {
  /** `undefined` while the first check is running. */
  account: Account | 'signedOut' | 'unavailable' | undefined;
  status: 'off' | 'synced' | 'syncing' | 'offline' | 'error';
  lastSyncedAt: number | null;
  /** Set when this device's first sync needs a decision. */
  firstSync: { local: DataSummary; cloud: DataSummary } | null;
  syncNow: () => void;
  signOut: () => void;
  chooseFirstSync: (choice: FirstSyncChoice | 'later') => void;
};

const offline: SyncView = {
  account: 'unavailable',
  status: 'off',
  lastSyncedAt: null,
  firstSync: null,
  syncNow: () => {},
  signOut: () => {},
  chooseFirstSync: () => {},
};

export const SyncContext = createContext<SyncView>(offline);

/** Defaults to "sync unavailable" without a provider, so components render in isolation. */
export function useSync(): SyncView {
  return useContext(SyncContext);
}
