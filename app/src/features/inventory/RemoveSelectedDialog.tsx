import { useEffect, useRef, useState } from 'react';

import { removeManyFromBulkBox, restoreSnapshots } from '~/data/bulk';
import { useToast } from '~/ui/toastContext';

import { printingsLabel, type BulkRow } from './bulkRows';
import { copiesIn, removalsFor } from './bulkSelection';
import styles from './RemoveFromBulkDialog.module.css';
import own from './RemoveSelectedDialog.module.css';

type Props = {
  rows: BulkRow[];
  /** After a removal went through, so the page can let go of the ticks. */
  onRemoved: () => void;
  onClose: () => void;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Confirms taking every ticked card's box copies out of the collection, then does it in
 * one transaction. Binder copies stay, as do bulk copies out in decks. Undo follows.
 */
export function RemoveSelectedDialog({ rows, onRemoved, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const showToast = useToast();
  const [busy, setBusy] = useState(false);
  // Fixed when the dialog opens, so a live update can't change what Remove means.
  const [picked] = useState(rows);
  const copies = copiesIn(picked);
  const inDecks = picked.reduce((sum, row) => sum + row.inDecks, 0);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  async function confirm() {
    setBusy(true);
    try {
      const result = await removeManyFromBulkBox(removalsFor(picked));
      showToast({
        tone: 'success',
        message: `Removed ${plural(result.removed, 'copy', 'copies')} of ${plural(
          result.cards,
          'card',
          'cards',
        )} from the bulk box.`,
        durationMs: 10000,
        action: { label: 'Undo', onAction: () => restoreSnapshots(result.undo) },
      });
      onRemoved();
      dialogRef.current?.close();
    } catch {
      showToast({ tone: 'danger', message: 'Nothing was removed: the change could not be saved.' });
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onClose={onClose}
      aria-labelledby="remove-selected-title"
      aria-describedby="remove-selected-detail"
    >
      <h2 id="remove-selected-title" className={styles.title}>
        Remove {plural(copies, 'copy', 'copies')} of {plural(picked.length, 'card', 'cards')} from
        the bulk box?
      </h2>
      <p id="remove-selected-detail" className={styles.detail}>
        Sold, traded or given away. Every copy of these cards in the box leaves your collection; the
        binder keeps its own.
        {inDecks > 0 &&
          ` ${inDecks} more ${inDecks === 1 ? 'is' : 'are'} out in decks and will stay.`}
      </p>

      <ul className={own.list} aria-label="Cards to remove" tabIndex={0}>
        {picked.map((row) => (
          <li key={`${row.setKey}:${row.base}`} className={own.item}>
            <span className={own.name}>
              {row.name}
              <span className={own.meta}>
                {row.setKey} #{row.base} · {printingsLabel(row.inBox)}
              </span>
            </span>
            <span className={own.count}>{row.boxCount}</span>
          </li>
        ))}
      </ul>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.button}
          autoFocus
          onClick={() => dialogRef.current?.close()}
        >
          Cancel
        </button>
        <button
          type="button"
          className={`${styles.button} ${styles.danger}`}
          disabled={busy || copies === 0}
          onClick={() => void confirm()}
        >
          Remove {plural(copies, 'copy', 'copies')}
        </button>
      </div>
    </dialog>
  );
}
