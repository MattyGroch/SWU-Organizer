import { SIGN_IN_URL } from '~/data/sync/account';

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

/** Sign in, or who is signed in and how sync is doing. Lives in the app header. */
export function AccountMenu() {
  const { account, status, lastSyncedAt, syncNow, signOut } = useSync();

  if (account === undefined) return null;

  if (account === 'unavailable') {
    return (
      <span
        className={styles.unavailable}
        title="The sync server could not be reached. Everything still saves on this device."
      >
        Sync unavailable
      </span>
    );
  }

  if (account === 'signedOut') {
    return (
      <a className={styles.signIn} href={SIGN_IN_URL} aria-label="Sign in to sync">
        <span className={styles.long}>Sign in to sync</span>
        <span className={styles.short}>Sign in</span>
      </a>
    );
  }

  return (
    <details className={styles.menu}>
      <summary
        className={styles.summary}
        aria-label={`Account: ${account.email}. ${STATUS_LABEL[status]}`}
      >
        <span className={styles.dot} data-status={status} aria-hidden="true" />
        <span className={styles.statusText}>
          {status === 'synced' ? 'Synced' : STATUS_LABEL[status].split(' —')[0]}
        </span>
      </summary>
      <div className={styles.panel}>
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
      </div>
    </details>
  );
}
