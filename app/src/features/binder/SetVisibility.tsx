import { useEffect, useRef, useState } from 'react';

import { writeHiddenSets } from '~/data/binderSettings';
import type { SetManifestEntry } from '~/domain/catalog';
import type { SetKey } from '~/domain/types';
import { Checkbox } from '~/ui/Checkbox';

import styles from './BinderDialog.module.css';

type Props = {
  entries: SetManifestEntry[];
  hidden: ReadonlySet<SetKey>;
  onClose: () => void;
};

/**
 * Binder settings: which sets get a binder. A set with no physical binder — TS26 and IBH
 * live only in precon decks — can be dropped from the picker, `[`/`]` and search without
 * losing its cards.
 *
 * Ticks are a draft until Apply saves them and closes; Cancel and Close both close without
 * saving.
 */
export function SetVisibility({ entries, hidden, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<ReadonlySet<SetKey>>(hidden);
  const shownCount = entries.filter((e) => !draft.has(e.key)).length;
  const changed = draft.size !== hidden.size || [...draft].some((key) => !hidden.has(key));

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  function toggle(key: SetKey) {
    const next = new Set(draft);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setDraft(next);
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onClose={onClose}
      aria-labelledby="hide-sets-title"
    >
      <h2 id="hide-sets-title" className={styles.title}>
        Hide sets
      </h2>
      <fieldset className={styles.group}>
        <legend className={styles.legend}>Show in the binder</legend>
        {entries.map((entry) => {
          const shown = !draft.has(entry.key);
          return (
            <label key={entry.key} className={styles.option}>
              <Checkbox
                checked={shown}
                // Keep at least one binder.
                disabled={shown && shownCount === 1}
                onChange={() => toggle(entry.key)}
              />
              <span>{entry.label}</span>
            </label>
          );
        })}
      </fieldset>
      <p className={styles.note}>
        Hidden sets keep their cards — they still count in decks, imports and backups.
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.apply}
          disabled={!changed}
          onClick={() => {
            void writeHiddenSets(new Set(draft));
            dialogRef.current?.close();
          }}
        >
          Apply
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={() => {
            setDraft(hidden);
            dialogRef.current?.close();
          }}
        >
          Cancel
        </button>
        <button type="button" className={styles.button} onClick={() => dialogRef.current?.close()}>
          Close
        </button>
      </div>
    </dialog>
  );
}
