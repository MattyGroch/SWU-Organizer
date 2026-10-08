import { useEffect, useRef, useState } from 'react';

import styles from './BinderDialog.module.css';

type Props = {
  /** Missing copies, and missing cards, among the cards shown. */
  copies: number;
  cards: number;
  /** The list as text, in TCGplayer mass-entry format. */
  listText: (mode: 'fullNeeded' | 'oneEach') => string;
  onClose: () => void;
};

/** Copy buy list: what's still needed, onto the clipboard for TCGplayer mass entry. */
export function BuyListDialog({ copies, cards, listText, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  async function send(mode: 'fullNeeded' | 'oneEach', what: string) {
    try {
      await navigator.clipboard.writeText(listText(mode));
      setStatus(`Copied ${what} — paste it into TCGplayer’s mass entry.`);
    } catch {
      setStatus('Couldn’t reach the clipboard.');
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onClose={onClose}
      aria-labelledby="buy-list-title"
    >
      <h2 id="buy-list-title" className={styles.title}>
        Copy buy list
      </h2>
      <p className={styles.note}>
        The cards shown that you still need, in TCGplayer mass-entry format.
      </p>
      <div className={styles.choices}>
        <button
          type="button"
          className={styles.button}
          disabled={copies === 0}
          onClick={() => void send('fullNeeded', `${copies} copies`)}
        >
          Send all missing cards to clipboard ({copies})
        </button>
        <button
          type="button"
          className={styles.button}
          disabled={cards === 0}
          onClick={() => void send('oneEach', `${cards} cards`)}
        >
          Send 1 of each missing card to clipboard ({cards})
        </button>
        <p role="status" className={styles.status}>
          {status}
        </p>
      </div>
      <div className={styles.footer}>
        <button type="button" className={styles.button} onClick={() => dialogRef.current?.close()}>
          Close
        </button>
      </div>
    </dialog>
  );
}
