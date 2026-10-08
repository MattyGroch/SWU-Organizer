import { promoArtOptions, shownArtNumber } from '~/domain/artSelection';
import { variantHotkey, variantLabel, variantShortLabel, type Printing } from '~/domain/catalog';
import type { OwnedCounts } from '~/domain/ownership';

import styles from './VariantStrip.module.css';

type Props = {
  printings: readonly Printing[];
  /** What is in the binder pocket — bulk and deck copies are not counted here. */
  counts: OwnedCounts;
  cardName: string;
  onAdjust: (printing: Printing, delta: number) => void;
  /** The promo picture chosen for the binder pocket, if any. */
  promoArt?: string;
  /** Picks the promo picture; `undefined` is the default. Without it, no picker shows. */
  onChoosePromoArt?: (num: string | undefined) => void;
};

/**
 * Per-printing binder counts for the selected card, each with − and + and its digit hotkey.
 *
 * Only the printings this card actually has are shown — SOR units have no Prestige run,
 * and LAW/ASH/HMW list no plain Foil — so the strip doubles as the discoverable form of
 * the keyboard mapping. The explicit − matters on touch screens, where neither
 * Shift+digit nor a right-click exists.
 *
 * A card with a single printing (SOR's starter-deck Vader, #010) still gets its one-chip
 * strip: hiding it made that card look broken next to its neighbours.
 *
 * A Promo given out at several events (weekly play, Store Showdown, a gift box) is one
 * count, but its name steps through those pictures for the binder pocket: cosmetic only.
 */
export function VariantStrip({
  printings,
  counts,
  cardName,
  onAdjust,
  promoArt,
  onChoosePromoArt,
}: Props) {
  if (printings.length === 0) return null;

  return (
    <ul className={styles.strip} aria-label={`Printings of ${cardName}`}>
      {printings.map((printing) => {
        const owned = counts.byVariant[printing.variant] ?? 0;
        const label = variantLabel(printing.variant);
        const digit = variantHotkey(printing.variant);
        const artOptions = onChoosePromoArt ? promoArtOptions(printing) : [];
        const artIndex = artOptions.indexOf(shownArtNumber(printing, promoArt));
        const badge = (
          <>
            <span className={styles.digit} aria-hidden="true">
              {digit}
            </span>
            <span className={styles.label}>{label}</span>
            <span className={styles.shortLabel} aria-hidden="true">
              {variantShortLabel(printing.variant)}
            </span>
            {artOptions.length > 1 && (
              <span className={styles.artIndex} aria-hidden="true">
                {artIndex + 1}/{artOptions.length}
              </span>
            )}
            <span className={styles.count} data-zero={owned === 0}>
              <span className="visually-hidden">, </span>
              {owned}
              <span className="visually-hidden"> in binder</span>
            </span>
          </>
        );

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
            {artOptions.length > 1 && onChoosePromoArt ? (
              <button
                type="button"
                className={`${styles.badge} ${styles.artButton}`}
                onClick={() => {
                  const next = artOptions[(artIndex + 1) % artOptions.length];
                  onChoosePromoArt(next === printing.num ? undefined : next);
                }}
                aria-label={`${label} art ${artIndex + 1} of ${artOptions.length} for ${cardName}, ${owned} in binder. Show the next promo art.`}
                title={`Showing ${artOptions[artIndex]} — click for the next promo art`}
              >
                {badge}
              </button>
            ) : (
              <span className={styles.badge}>{badge}</span>
            )}
            <button
              type="button"
              className={styles.step}
              onClick={() => onAdjust(printing, 1)}
              aria-label={`Add one ${label} ${cardName}, number ${printing.num}. ${owned} in binder. Keyboard ${digit}.`}
            >
              +
            </button>
          </li>
        );
      })}
    </ul>
  );
}
