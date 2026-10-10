import { useRef, useState, type ReactNode } from 'react';

import { SIGN_IN_URL } from '~/data/sync/account';
import { CollectionImportDialog } from '~/features/import/CollectionImportDialog';

import styles from './AccountMenu.module.css';
import { useSync, type SyncView } from './syncContext';

const STATUS_LABEL: Record<SyncView['status'], string> = {
  off: 'Not syncing',
  synced: 'Synced',
  syncing: 'Syncing…',
  offline: 'Offline — changes are saved and will sync',
  error: 'Sync problem — retrying',
};

function timeAgo(at: number | null): string {
  if (!at) return 'not yet';
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * Sign in, or who is signed in and how sync is doing — and the collection's data
 * management (import / export), whichever the sync state. Lives in the app header.
 */
export function AccountMenu() {
  const { account, status, lastSyncedAt, syncNow, signOut } = useSync();
  const menuRef = useRef<HTMLDetailsElement>(null);
  const [importOpen, setImportOpen] = useState(false);

  if (account === undefined) return null;

  const importButton = (
    <button
      type="button"
      className={styles.button}
      onClick={() => {
        if (menuRef.current) menuRef.current.open = false;
        setImportOpen(true);
      }}
    >
      Import &amp; export
    </button>
  );

  let summary: ReactNode;
  let body: ReactNode;
  if (account === 'unavailable') {
    summary = (
      <>
        <span className={styles.long}>Sync unavailable</span>
        <span className={styles.short} role="img" aria-label="Sync unavailable">
          🚫
        </span>
      </>
    );
    body = (
      <p className={styles.detail}>
        The sync server could not be reached. Everything still saves on this device.
      </p>
    );
  } else if (account === 'signedOut') {
    summary = (
      <>
        <span className={styles.long}>Not syncing</span>
        <span className={styles.short}>Sync</span>
      </>
    );
    body = (
      <a className={styles.signIn} href={SIGN_IN_URL}>
        Sign in to sync
      </a>
    );
  } else {
    summary = (
      <>
        <span className={styles.dot} data-status={status} aria-hidden="true" />
        <span className={styles.statusText}>
          {status === 'synced' ? 'Synced' : STATUS_LABEL[status].split(' —')[0]}
        </span>
      </>
    );
    body = (
      <>
        <p className={styles.email}>{account.email}</p>
        <p className={styles.detail}>
          {STATUS_LABEL[status]} · last checked {timeAgo(lastSyncedAt)}
        </p>
        <div className={styles.buttons}>
          <button type="button" className={styles.button} onClick={syncNow}>
            Sync now
          </button>
          <button type="button" className={styles.button} onClick={signOut}>
            Sign out
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <details className={styles.menu} ref={menuRef}>
        <summary
          className={styles.summary}
          aria-label={
            typeof account === 'object'
              ? `Account: ${account.email}. ${STATUS_LABEL[status]}`
              : account === 'signedOut'
                ? 'Not syncing: sign in, import & export'
                : 'Sync unavailable: import & export'
          }
        >
          {summary}
        </summary>
        <div className={styles.panel}>
          {body}
          <div className={styles.dataSection}>
            <p className={styles.sectionLabel}>Your data</p>
            {importButton}
          </div>
        </div>
      </details>
      {importOpen && <CollectionImportDialog onClose={() => setImportOpen(false)} />}
    </>
  );
}
