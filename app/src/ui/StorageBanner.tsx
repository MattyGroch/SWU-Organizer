import { useState, useSyncExternalStore } from 'react';

import { storageHealth, type HealthStore } from '~/data/storageHealth';

import styles from './StorageBanner.module.css';

/**
 * Says when storage stops answering, and when another copy of the app is open — the usual
 * reason it stops. Without it a stuck database looks like a page that never loads, or a
 * scan that is recognised and then recorded nowhere.
 */
export function StorageBanner({ store = storageHealth }: { store?: HealthStore }) {
  const { stalled, others } = useSyncExternalStore(store.subscribe, store.get);
  /** How many other copies were open when the notice was dismissed; one more shows it again. */
  const [dismissedAt, setDismissedAt] = useState(0);
  // Copies closed since: forget the dismissal, so a copy opened later shows it again.
  if (others < dismissedAt) setDismissedAt(others);
  const elsewhere =
    others === 1 ? 'in another tab or window' : `in ${others} other tabs or windows`;

  if (stalled) {
    return (
      <div className={styles.banner} data-tone="danger" role="alert">
        <p>
          <strong>Saving and loading are stuck</strong> — this device’s storage isn’t answering.
          {others > 0 && ` The app is also open ${elsewhere}.`} Close every other tab or window with
          SWU Organizer open, Chrome included, then reopen the app.
        </p>
      </div>
    );
  }
  if (others > dismissedAt) {
    return (
      <div className={styles.banner} data-tone="warning" role="status">
        <p>
          SWU Organizer is also open {elsewhere}. If saving or scanning stops working, close the
          other copy.
        </p>
        <button type="button" className={styles.dismiss} onClick={() => setDismissedAt(others)}>
          Dismiss
        </button>
      </div>
    );
  }
  return null;
}
