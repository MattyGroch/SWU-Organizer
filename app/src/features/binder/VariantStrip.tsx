import { variantHotkey, variantLabel, type Printing } from '~/domain/catalog';
import type { OwnedCounts } from '~/domain/ownership';

import styles from './VariantStrip.module.css';

type Props = {
  printings: readonly Printing[];
  counts: OwnedCounts;
  cardName: string;
  onAdjust: (printing: Printing, delta: number) => void;
};

/**
 * Per-printing counts for the selected card, each labelled with its digit hotkey.
 *
 * Only the printings this card actually has are shown — SOR units have no Prestige run,
 * and LAW/ASH/HMW list no plain Foil — so the strip doubles as the discoverable form of
 * the keyboard mapping. There is no help modal to memorise: the digit is on the control.
 */
export function VariantStrip({ printings, counts, cardName, onAdjust }: Props) {
  if (printings.length <= 1) return null;

  return (
    <ul className={styles.strip} aria-label={`Printings of ${cardName}`}>
      {printings.map((printing) => {
        const owned = counts.byVariant[printing.variant] ?? 0;
        const label = variantLabel(printing.variant);
        const digit = variantHotkey(printing.variant);

        return (
          <li key={printing.num} className={styles.item} data-owned={owned > 0}>
            <button
              type="button"
              className={styles.button}
              onClick={() => onAdjust(printing, 1)}
              onContextMenu={(event) => {
                // Right-click decrements, mirroring Shift+digit.
                event.preventDefault();
                onAdjust(printing, -1);
              }}
              aria-label={`Add one ${label} ${cardName}, number ${printing.num}. ${owned} owned. Keyboard ${digit}.`}
              title={`${label} · #${printing.num} · press ${digit} to add, Shift+${digit} to remove`}
            >
              <span className={styles.digit} aria-hidden="true">
                {digit}
              </span>
              <span className={styles.label}>{label}</span>
              <span className={styles.count} data-zero={owned === 0}>
                {owned}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
