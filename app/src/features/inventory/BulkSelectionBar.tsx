import { useState } from 'react';

import { copiesIn } from './bulkSelection';
import styles from './BulkSelectionBar.module.css';
import { RemoveSelectedDialog } from './RemoveSelectedDialog';
import type { BulkSelection } from './useBulkSelection';

type Props = { selection: BulkSelection };

/** Pinned under the list while anything is ticked: the count, and what to do with it. */
export function BulkSelectionBar({ selection }: Props) {
  const [confirming, setConfirming] = useState(false);
  const { rows } = selection;
  if (rows.length === 0 && !confirming) return null;
  const copies = copiesIn(rows);

  return (
    <>
      {rows.length > 0 && (
        <div className={styles.bar} role="region" aria-label="Selected cards">
          <p className={styles.count} aria-live="polite">
            <strong>
              {rows.length} {rows.length === 1 ? 'card' : 'cards'}
            </strong>{' '}
            · {copies} {copies === 1 ? 'copy' : 'copies'}
          </p>
          <button type="button" className={styles.button} onClick={selection.clear}>
            Clear
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.danger}`}
            onClick={() => setConfirming(true)}
          >
            Remove from bulk…
          </button>
        </div>
      )}
      {confirming && (
        <RemoveSelectedDialog
          rows={rows}
          onRemoved={selection.clear}
          onClose={() => setConfirming(false)}
        />
      )}
    </>
  );
}
