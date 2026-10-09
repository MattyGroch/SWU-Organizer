import { useEffect, useRef, useState } from 'react';

import { removeFromBulkBox, restoreSnapshot } from '~/data/bulk';
import { VARIANTS, variantLabel } from '~/domain/catalog';
import { sumVariants, type VariantCounts } from '~/domain/ownership';
import { useToast } from '~/ui/toastContext';

import type { BulkRow } from './bulkRows';
import styles from './RemoveFromBulkDialog.module.css';

type Props = {
  row: BulkRow;
  onClose: () => void;
};

/**
 * Takes copies of one card out of the bulk box and the collection — sold, traded or given
 * away. Only copies physically in the box can go; bulk copies out in decks are not there.
 * A lone copy is picked already, so the common case is one tap. Undo follows.
 */
export function RemoveFromBulkDialog({ row, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const showToast = useToast();
  const [busy, setBusy] = useState(false);
  const printings = VARIANTS.filter((v) => (row.inBox[v] ?? 0) > 0);
  const [draft, setDraft] = useState<VariantCounts>(() =>
    row.boxCount === 1 && printings[0] ? { [printings[0]]: 1 } : {},
  );
  const total = sumVariants(draft);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const step = (variant: (typeof printings)[number], delta: number) => {
    const max = row.inBox[variant] ?? 0;
    const next = Math.max(0, Math.min(max, (draft[variant] ?? 0) + delta));
    setDraft({ ...draft, [variant]: next });
  };

  async function confirm() {
    setBusy(true);
    try {
      const { removed, undo } = await removeFromBulkBox(row.setKey, row.base, draft);
      showToast({
        tone: 'success',
        message: `Removed ${removed} ${removed === 1 ? 'copy' : 'copies'} of ${row.name} from the bulk box.`,
        durationMs: 10000,
        action: { label: 'Undo', onAction: () => restoreSnapshot(undo) },
      });
      dialogRef.current?.close();
    } catch {
      showToast({ tone: 'danger', message: 'The removal could not be saved.' });
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onClose={onClose}
      aria-labelledby="remove-bulk-title"
      aria-describedby="remove-bulk-detail"
    >
      <h2 id="remove-bulk-title" className={styles.title}>
        Remove {row.name} from the bulk box
      </h2>
      <p id="remove-bulk-detail" className={styles.detail}>
        Sold, traded or given away. These copies leave your collection; the binder keeps its own.
        {row.inDecks > 0 &&
          ` ${row.inDecks} more ${row.inDecks === 1 ? 'is' : 'are'} out in decks and can't be removed here.`}
      </p>

      <ul className={styles.printings}>
        {printings.map((variant) => {
          const n = draft[variant] ?? 0;
          const max = row.inBox[variant] ?? 0;
          const label = variantLabel(variant);
          return (
            <li key={variant} className={styles.printing}>
              <span className={styles.printingName}>
                {label}
                <span className={styles.inBox}>{max} in the box</span>
              </span>
              <span className={styles.stepper}>
                <button
                  type="button"
                  className={styles.step}
                  disabled={busy || n === 0}
                  aria-label={`One fewer ${label}`}
                  onClick={() => step(variant, -1)}
                >
                  −
                </button>
                <output className={styles.value} aria-label={`${label} to remove`}>
                  {n}
                </output>
                <button
                  type="button"
                  className={styles.step}
                  disabled={busy || n >= max}
                  aria-label={`One more ${label}`}
                  onClick={() => step(variant, 1)}
                >
                  +
                </button>
              </span>
            </li>
          );
        })}
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
          disabled={busy || total === 0}
          onClick={() => void confirm()}
        >
          {total > 0 ? `Remove ${total} ${total === 1 ? 'copy' : 'copies'}` : 'Remove'}
        </button>
      </div>
    </dialog>
  );
}
