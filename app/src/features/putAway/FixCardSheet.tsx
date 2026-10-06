import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';

import { sourcePrinting } from '~/data/intake';
import { artUrl, toSearchCatalog, variantLabel, type LoadedSet } from '~/domain/catalog';
import type { StackCardInput } from '~/domain/putAway';
import type { SetKey } from '~/domain/types';
import type { Printing } from '~/features/scan/usePlaceScan';
import { CardSearch } from '~/features/search/CardSearch';

import styles from './PutAwayPage.module.css';

type Props = {
  card: StackCardInput;
  sets: Map<SetKey, LoadedSet>;
  onCorrect: (printing: Printing) => void;
  onMissedCopy: () => void;
  onRemove: () => void;
  onClose: () => void;
};

/**
 * The card in hand isn't the one on screen: another printing, another card, a second copy
 * the scanner never read, or a card scanned twice that isn't there at all. Each fix updates
 * Intake too, since the stack is usually put away before it is added.
 */
export function FixCardSheet({ card, sets, onCorrect, onMissedCopy, onRemove, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const set = sets.get(card.setKey);
  const name = set?.byNumber.get(card.base)?.Name ?? `${card.setKey} #${card.base}`;
  const printings = set?.printingsByBase.get(card.base) ?? [];
  const unsure = card.fate === 'unsure';
  const catalogs = useMemo(() => [...sets.values()].map(toSearchCatalog), [sets]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const pick = (fix: () => void) => {
    dialogRef.current?.close();
    fix();
  };

  return createPortal(
    <dialog
      ref={dialogRef}
      className={styles.sheet}
      onClose={onClose}
      aria-labelledby="fix-card-title"
    >
      <div className={styles.sheetHeader}>
        <img className={styles.sheetArt} src={artUrl(card.setKey, card.num)} alt="" />
        <div>
          <h2 id="fix-card-title" className={styles.sheetTitle}>
            Wrong card?
          </h2>
          <p className={styles.cardMeta}>
            Scanned as {name} · {card.setKey} · {variantLabel(card.variant)}
          </p>
        </div>
      </div>

      {printings.length > 1 && (
        <fieldset className={styles.fieldset}>
          <legend className={styles.sheetLegend}>
            {unsure ? 'If it is this card:' : 'Another printing:'}
          </legend>
          <div className={styles.choiceGrid}>
            {printings.map((p) => (
              <button
                key={p.num}
                type="button"
                className={styles.sheetChoice}
                aria-pressed={!unsure && p.num === card.num}
                onClick={() =>
                  (unsure || p.num !== card.num) &&
                  pick(() =>
                    onCorrect({
                      setKey: card.setKey,
                      base: card.base,
                      num: p.num,
                      variant: p.variant,
                    }),
                  )
                }
              >
                {variantLabel(p.variant)}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <div>
        <p className={styles.sheetLegend}>A different card:</p>
        <CardSearch
          catalogs={catalogs}
          currentSetKey={card.setKey}
          inputRef={inputRef}
          onChoose={(s) => {
            const printing = sourcePrinting(
              sets.get(s.setKey)?.printingsByBase.get(s.baseNumber) ?? [],
            );
            if (printing) {
              const { num, variant } = printing;
              pick(() => onCorrect({ setKey: s.setKey, base: s.baseNumber, num, variant }));
            }
          }}
        />
      </div>

      <div className={styles.sheetActions}>
        {!unsure && (
          <button type="button" className={styles.sheetAction} onClick={() => pick(onMissedCopy)}>
            There’s another copy — the scanner missed it
          </button>
        )}
        <button type="button" className={styles.sheetDanger} onClick={() => pick(onRemove)}>
          It isn’t here — scanned twice, remove it
        </button>
        <button
          type="button"
          className={styles.sheetAction}
          onClick={() => dialogRef.current?.close()}
        >
          Cancel
        </button>
      </div>
    </dialog>,
    document.body,
  );
}
