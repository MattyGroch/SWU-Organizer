import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { SyncBundle } from '~/data/sync';
import { fetchAccount, signOut as requestSignOut } from '~/data/sync/account';
import {
  applyPull,
  fetchCloud,
  needsFirstSyncChoice,
  resolveFirstSync,
  summarizeCloud,
  summarizeLocal,
  type CloudSnapshot,
  type FirstSyncChoice,
} from '~/data/sync/pull';
import { useToast } from '~/ui/toastContext';

import { SyncContext, type SyncView } from './syncContext';

/** How often to look for changes made on another device while the app is open. */
const PULL_EVERY_MS = 5 * 60 * 1000;

/**
 * Owns cloud sync for the running app: who is signed in, pulling, and the first-sync
 * decision. Pushing is the engines' job — they send local edits as they happen.
 */
export function SyncProvider({ bundle, children }: { bundle: SyncBundle; children: ReactNode }) {
  const showToast = useToast();
  const [account, setAccount] = useState<SyncView['account']>(undefined);
  const [engineStatus, setEngineStatus] = useState<
    'off' | 'idle' | 'pushing' | 'error' | 'offline'
  >('off');
  const [pulling, setPulling] = useState(false);
  const [pullFailed, setPullFailed] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [firstSync, setFirstSync] = useState<SyncView['firstSync']>(null);
  const pendingSnapshot = useRef<CloudSnapshot | null>(null);
  const busy = useRef(false);
  const signedIn = typeof account === 'object';

  // Either engine's status, worst first.
  useEffect(() => {
    const rank = { error: 4, offline: 3, pushing: 2, idle: 1, off: 0 } as const;
    const statuses = { inventory: bundle.inventory.getStatus(), decks: bundle.decks.getStatus() };
    const update = () =>
      setEngineStatus(
        [statuses.inventory, statuses.decks].sort((a, b) => rank[b] - rank[a])[0] ?? 'off',
      );
    const offInventory = bundle.inventory.subscribe((event) => {
      if (event.type === 'status') statuses.inventory = event.status;
      if (event.type === 'signout') setAccount('signedOut');
      update();
    });
    const offDecks = bundle.decks.subscribe((event) => {
      if (event.type === 'status') statuses.decks = event.status;
      if (event.type === 'signout') setAccount('signedOut');
      update();
    });
    update();
    return () => {
      offInventory();
      offDecks();
    };
  }, [bundle]);

  const pull = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setPulling(true);
    try {
      const snapshot = await fetchCloud();
      if (snapshot === 'signedOut') {
        bundle.setSignedIn(false);
        setAccount('signedOut');
        return;
      }
      if (snapshot === 'unavailable') {
        setPullFailed(true);
        return;
      }
      setPullFailed(false);
      // Pulled counts can only be stored once every set's catalog has loaded.
      await bundle.ensureCatalog();
      if (await needsFirstSyncChoice(bundle, snapshot)) {
        pendingSnapshot.current = snapshot;
        setFirstSync({ local: await summarizeLocal(), cloud: summarizeCloud(snapshot) });
        return;
      }
      await applyPull(bundle, snapshot);
      setLastSyncedAt(Date.now());
    } finally {
      busy.current = false;
      setPulling(false);
    }
  }, [bundle]);

  // Who is signed in, once at start-up. Sign-in itself is a full-page round trip.
  useEffect(() => {
    let cancelled = false;
    void fetchAccount().then((result) => {
      if (cancelled) return;
      setAccount(result);
      if (typeof result === 'object') {
        bundle.setSignedIn(true);
        void pull();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [bundle, pull]);

  // Changes from another device: on focus, on reconnect, and every few minutes.
  useEffect(() => {
    if (!signedIn || firstSync) return;
    const onFocus = () => void pull();
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    const timer = window.setInterval(() => void pull(), PULL_EVERY_MS);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
      window.clearInterval(timer);
    };
  }, [signedIn, firstSync, pull]);

  const chooseFirstSync = useCallback(
    (choice: FirstSyncChoice | 'later') => {
      const snapshot = pendingSnapshot.current;
      setFirstSync(null);
      pendingSnapshot.current = null;
      if (choice === 'later' || !snapshot) {
        // Nothing is sent or pulled until the question is answered; it is asked again on
        // the next visit.
        bundle.setSignedIn(false);
        return;
      }
      void resolveFirstSync(bundle, snapshot, choice).then(() => {
        setLastSyncedAt(Date.now());
        showToast({ tone: 'success', message: 'Cloud sync is on.' });
      });
    },
    [bundle, showToast],
  );

  const signOut = useCallback(() => {
    bundle.setSignedIn(false);
    setAccount('signedOut');
    void requestSignOut();
  }, [bundle]);

  const status: SyncView['status'] = !signedIn
    ? 'off'
    : engineStatus === 'offline'
      ? 'offline'
      : engineStatus === 'error' || pullFailed
        ? 'error'
        : pulling || engineStatus === 'pushing'
          ? 'syncing'
          : 'synced';

  const value = useMemo<SyncView>(
    () => ({
      account,
      status,
      lastSyncedAt,
      firstSync,
      syncNow: () =>
        void pull().then(() => Promise.all([bundle.inventory.flush(), bundle.decks.flush()])),
      signOut,
      chooseFirstSync,
    }),
    [account, status, lastSyncedAt, firstSync, pull, bundle, signOut, chooseFirstSync],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}
