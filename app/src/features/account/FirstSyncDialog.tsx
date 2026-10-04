import { useEffect, useRef } from 'react';

import type { DataSummary } from '~/data/sync/pull';
import { downloadBackup } from '~/features/import/downloadBackup';

import styles from './FirstSyncDialog.module.css';
import { useSync } from './syncContext';

function describe(summary: DataSummary): string {
  return `${summary.cards.toLocaleString()} cards in ${summary.sets} sets · ${summary.decks} saved decks`;
}

/**
 * Asked once per device, only when it has never synced and both it and the cloud already
 * hold a collection — the one case where picking automatically could lose something.
 */
export function FirstSyncDialog() {
  const { firstSync, chooseFirstSync } = useSync();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (firstSync && dialog && !dialog.open) dialog.showModal();
  }, [firstSync]);

  if (!firstSync) return null;

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="first-sync-title"
      onCancel={(event) => {
        // Escape means "not now", not "pick something".
        event.preventDefault();
        chooseFirstSync('later');
      }}
    >
      <div className={styles.body}>
        <h2 id="first-sync-title" className={styles.title}>
          Turn on cloud sync
        </h2>
        <p className={styles.lead}>
          This device and your cloud copy both have a collection. Choose how to combine them — this
          is only asked once per device.
        </p>

        <dl className={styles.compare}>
          <div>
            <dt>This device</dt>
            <dd>{describe(firstSync.local)}</dd>
          </div>
          <div>
            <dt>Cloud</dt>
            <dd>{describe(firstSync.cloud)}</dd>
          </div>
        </dl>

        <div className={styles.choices}>
          <button type="button" className={styles.choice} onClick={() => chooseFirstSync('merge')}>
            <strong>Merge both</strong>
            <span>Keep the higher count of every printing, and every deck from both.</span>
          </button>
          <button type="button" className={styles.choice} onClick={() => chooseFirstSync('cloud')}>
            <strong>Use the cloud copy</strong>
            <span>Replace what is on this device with the cloud.</span>
          </button>
          <button type="button" className={styles.choice} onClick={() => chooseFirstSync('device')}>
            <strong>Use this device</strong>
            <span>Replace the cloud with what is on this device.</span>
          </button>
        </div>

        <p className={styles.footer}>
          <button type="button" className={styles.link} onClick={() => void downloadBackup()}>
            Download a backup of this device first
          </button>
          <button type="button" className={styles.link} onClick={() => chooseFirstSync('later')}>
            Not now
          </button>
        </p>
      </div>
    </dialog>
  );
}
