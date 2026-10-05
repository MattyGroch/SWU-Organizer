import { artUrl, type CatalogCard } from '~/domain/catalog';
import { isLandscapeArt, selectArtPrinting } from '~/domain/artSelection';
import {
  binderCount,
  pocketCounts,
  sumVariants,
  type Homes,
  type OwnedCounts,
} from '~/domain/ownership';
import type { Card } from '~/domain/types';

import { aspectBackground, isLightFill, rarityStyle } from './aspect';
import styles from './BinderCell.module.css';
import { useCardImage } from './useCardImage';

type Props = {
  colIndex: number;
  card: Card;
  catalogCard: CatalogCard | undefined;
  setKey: string;
  page: number;
  row: number;
  column: number;
  selected: boolean;
  counts: OwnedCounts;
  /** Printings pulled out into built decks — owned, but not in this pocket. */
  held: Homes;
  /** The card's binder playset. */
  quota: number;
  onSelect: (card: Card) => void;
};

/**
 * One binder slot.
 *
 * Shows the real card art for the most premium printing owned, greyscaled when the slot is
 * empty — so a page reads like the physical page rather than a wall of colour blocks. The
 * text layout underneath is not a fallback bolted on: it is what shows while the image
 * loads, and permanently if the image cannot be fetched, so the binder stays usable
 * offline and on a cold cache.
 */
export function BinderCell({
  colIndex,
  card,
  catalogCard,
  setKey,
  page,
  row,
  column,
  selected,
  counts,
  held,
  quota,
  onSelect,
}: Props) {
  // The cell mirrors the physical pocket. Copies out in decks leave most valuable first,
  // so the art and foil mark come from what is actually still in the pages — and a pocket
  // emptied by decks looks exactly like a card you do not have.
  const pocket = pocketCounts(counts, held);
  // The slot shows its pocket only: bulk-box copies live in the List and Bulk pages.
  const inDecks = sumVariants(held.binder);
  const choice = catalogCard ? selectArtPrinting(catalogCard, pocket) : undefined;
  const { src, state } = useCardImage(choice ? artUrl(setKey, choice.printing.num) : undefined);

  const onHand = pocket.total;
  const inBinder = binderCount(onHand, quota);
  const pocketEmpty = onHand === 0;
  const rarity = rarityStyle(card.Rarity);
  const light = isLightFill(card.Aspects);
  const showArt = state === 'ready' && src;
  // Leaders and Bases are printed landscape; they sit turned sideways in a binder pocket.
  const rotated = isLandscapeArt(card.Type);

  const description =
    `${card.Name}${card.Subtitle ? `, ${card.Subtitle}` : ''}. ` +
    `Number ${card.Number}. Page ${page}, row ${row}, column ${column}. ` +
    `${inBinder} of ${quota} in binder` +
    `${inDecks > 0 ? `, ${inDecks} in decks` : ''}.` +
    // The sparkle is decorative, so the finish is announced in words instead.
    (choice?.foil && !pocketEmpty ? ' Includes a foil.' : '');

  return (
    <div role="gridcell" aria-colindex={colIndex} className={styles.cell}>
      <button
        type="button"
        // Roving tabindex: only the selected cell is in the tab order.
        tabIndex={selected ? 0 : -1}
        data-selected={selected}
        data-owned={!pocketEmpty}
        aria-pressed={selected}
        aria-label={description}
        className={`${styles.card} ${light && !showArt ? styles.lightFill : ''}`}
        style={showArt ? undefined : { background: aspectBackground(card.Aspects) }}
        onClick={() => onSelect(card)}
      >
        {showArt && (
          <img
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            className={styles.art}
            // Unowned slots are desaturated, so a page shows at a glance what is missing.
            data-unowned={!choice?.owned || pocketEmpty}
            data-rotated={rotated}
          />
        )}

        {choice?.foil && !pocketEmpty && (
          /*
           * An SVG rather than a text glyph: a percentage `font-size` resolves against the
           * parent font size, not the cell, so a character could not be sized relative to
           * the card. A vector scales to its box directly.
           */
          <svg className={styles.foil} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
            <title>Foil</title>
            <path
              d="M50 2 C54 30 70 46 98 50 C70 54 54 70 50 98 C46 70 30 54 2 50 C30 46 46 30 50 2 Z"
              fill="currentColor"
            />
          </svg>
        )}

        {!showArt && (
          <span className={styles.text}>
            <span className={styles.type}>{card.Type}</span>
            <span className={styles.name}>
              {card.Name}
              {card.Subtitle && <span className={styles.subtitle}>{card.Subtitle}</span>}
            </span>
          </span>
        )}

        <span className={styles.overlay}>
          <span
            className={styles.qty}
            data-complete={inBinder >= quota}
            data-empty={inBinder === 0}
          >
            {inBinder}/{quota}
            {inDecks > 0 && (
              <span className={styles.inDecks} title={`${inDecks} pulled into built decks`}>
                ⇢{inDecks}
              </span>
            )}
          </span>
          <span className={styles.number}>{card.Number}</span>
          {rarity && (
            <span
              className={styles.rarity}
              style={{ color: `var(${rarity.colorVar})` }}
              data-rarity={card.Rarity}
            >
              {rarity.letter}
            </span>
          )}
        </span>
      </button>
    </div>
  );
}
