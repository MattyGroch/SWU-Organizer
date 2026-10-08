import type { LoadedSet, Printing } from '~/domain/catalog';
import {
  binderCount,
  boxCounts,
  pocketCounts,
  sumVariants,
  type Homes,
  type OwnedCounts,
} from '~/domain/ownership';
import type { ActiveSelection } from '~/domain/types';

import { AspectIcons } from './AspectIcons';
import styles from './SelectedCardPanel.module.css';
import { UniqueMark } from './UniqueMark';
import { VariantStrip } from './VariantStrip';

type Props = {
  set: LoadedSet;
  active: ActiveSelection | null;
  counts: OwnedCounts;
  /** What built decks hold of this card, by the home each copy returns to. */
  held: Homes;
  /** The card's binder playset. */
  quota: number;
  onAdjust: (delta: number) => void;
  onAdjustPrinting: (printing: Printing, delta: number) => void;
  /** The promo picture chosen for this card's binder pocket, if any. */
  promoArt?: string;
  onChoosePromoArt?: (num: string | undefined) => void;
  /** Deselects the card. Phones show a close button for it: they have no Escape key. */
  onClose?: () => void;
};

/**
 * Where the selected card lives: its binder location and its quantity controls.
 *
 * The legacy app put +/- inside each binder cell, which made every cell a cluster of
 * three nested interactive elements — unusable by keyboard and incompatible with the
 * grid pattern. Hoisting them here keeps the grid navigable and gives the controls a
 * stable position, so they do not move under the pointer as the selection changes.
 */
export function SelectedCardPanel({
  set,
  active,
  counts,
  held,
  quota,
  onAdjust,
  onAdjustPrinting,
  promoArt,
  onChoosePromoArt,
  onClose,
}: Props) {
  if (!active) {
    return (
      <div className={styles.panel} aria-live="polite">
        <p className={styles.placeholder}>
          No card selected — search above, or pick a slot. Press <kbd>/</kbd> to search.
        </p>
      </div>
    );
  }

  const { card } = active;
  const pocket = pocketCounts(counts, held);
  const inBinder = binderCount(pocket.total, quota);
  const inBulk = sumVariants(boxCounts(counts, held));
  const inDecks = sumVariants(held.binder) + sumVariants(held.bulk);
  const printings = set.printingsByBase.get(card.Number) ?? [];

  return (
    <div className={styles.panel}>
      <div className={styles.identity}>
        <AspectIcons className={styles.aspects} aspects={card.Aspects} />
        <div className={styles.names}>
          <h2 className={styles.name}>
            {card.Unique && <UniqueMark />}
            {card.Name}
          </h2>
          {card.Subtitle && <p className={styles.subtitle}>{card.Subtitle}</p>}
        </div>
        {onClose && (
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label={`Close ${card.Name}`}
          >
            ✕
          </button>
        )}
      </div>

      <dl className={styles.location} aria-label="Binder location">
        <div className={styles.locationItem}>
          <dt>Page</dt>
          <dd>{active.page}</dd>
        </div>
        <div className={styles.locationItem}>
          <dt>Row</dt>
          <dd>{active.row}</dd>
        </div>
        <div className={styles.locationItem}>
          <dt>Column</dt>
          <dd>{active.column}</dd>
        </div>
        <div className={styles.locationItem}>
          <dt>Number</dt>
          <dd>{card.Number}</dd>
        </div>
      </dl>

      <div className={styles.quantity}>
        <button
          type="button"
          className={styles.qtyButton}
          onClick={() => onAdjust(-1)}
          disabled={pocket.total === 0}
          aria-label={`Remove one ${card.Name}`}
          title="Remove one — keyboard -"
        >
          −
        </button>

        <p className={styles.qtyValue} aria-live="polite">
          <span className={styles.qtyNumbers}>
            {inBinder}
            <span className={styles.qtyOf}>/{quota}</span>
          </span>
          <span className={styles.qtyCaption}>
            in binder
            {inBulk > 0 && ` · ${inBulk} in bulk`}
            {inDecks > 0 && ` · ${inDecks} in decks`}
          </span>
        </p>

        <button
          type="button"
          className={styles.qtyButton}
          onClick={() => onAdjust(1)}
          aria-label={`Add one ${card.Name}`}
          title="Add one — keyboard +"
        >
          +
        </button>
      </div>

      <VariantStrip
        printings={printings}
        counts={pocket}
        cardName={card.Name}
        onAdjust={onAdjustPrinting}
        promoArt={promoArt}
        onChoosePromoArt={onChoosePromoArt}
      />
    </div>
  );
}
