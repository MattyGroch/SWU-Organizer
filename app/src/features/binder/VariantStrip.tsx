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
 * Per-printing counts for the selected card, each with − and + and its digit hotkey.
 *
 * Only the printings this card actually has are shown — SOR units have no Prestige run,
 * and LAW/ASH/HMW list no plain Foil — so the strip doubles as the discoverable form of
 * the keyboard mapping. The explicit − matters on touch screens, where neither
 * Shift+digit nor a right-click exists.
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
          <li
            key={printing.num}
            className={styles.item}
            data-owned={owned > 0}
            title={`${label} · #${printing.num} · press ${digit} to add, Shift+${digit} to remove`}
          >
            <button
              type="button"
              className={styles.step}
              disabled={owned === 0}
              onClick={() => onAdjust(printing, -1)}
              aria-label={`Remove one ${label} ${cardName}. Keyboard Shift+${digit}.`}
            >
              −
            </button>
            <span className={styles.badge}>
              <span className={styles.digit} aria-hidden="true">
                {digit}
              </span>
              <span className={styles.label}>{label}</span>
              <span className={styles.count} data-zero={owned === 0}>
                <span className="visually-hidden">, </span>
                {owned}
                <span className="visually-hidden"> owned</span>
              </span>
            </span>
            <button
              type="button"
              className={styles.step}
              onClick={() => onAdjust(printing, 1)}
              aria-label={`Add one ${label} ${cardName}, number ${printing.num}. ${owned} owned. Keyboard ${digit}.`}
            >
              +
            </button>
          </li>
        );
      })}
    </ul>
  );
}
