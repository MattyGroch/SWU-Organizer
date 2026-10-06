import { useEffect, useRef } from 'react';

import { variantLabel, type Printing } from '~/domain/catalog';
import type { Card } from '~/domain/types';

import styles from './AddToBulkDialog.module.css';

type Props = {
  card: Card;
  printing: Printing;
  /** Copies of this printing already in the bulk box. */
  inBulk: number;
  onConfirm: () => void;
  onClose: () => void;
};

/**
 * Asks before a copy refused by a full pocket goes in the bulk box. A copy keyed in by
 * mistake would otherwise have to be found again in an unsorted box, so this is a gate
 * rather than an Undo. Cancel has focus, so a stray Enter does nothing.
 */
export function AddToBulkDialog({ card, printing, inBulk, onConfirm, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const label = variantLabel(printing.variant);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onClose={onClose}
      aria-labelledby="add-to-bulk-title"
      aria-describedby="add-to-bulk-detail"
    >
      <h2 id="add-to-bulk-title" className={styles.title}>
        Add a {label} {card.Name} to the bulk box?
      </h2>
      <p id="add-to-bulk-detail" className={styles.detail}>
        Its binder pocket is full. The bulk box will then hold {inBulk + 1} {label}{' '}
        {inBulk + 1 === 1 ? 'copy' : 'copies'} of it.
      </p>
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
          className={`${styles.button} ${styles.primary}`}
          onClick={() => {
            onConfirm();
            dialogRef.current?.close();
          }}
        >
          Add to bulk
        </button>
      </div>
    </dialog>
  );
}
