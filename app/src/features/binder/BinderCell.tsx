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
import type { CSSProperties, PointerEvent } from 'react';

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
  const isFoil = !!choice?.foil && !pocketEmpty;

  const description =
    `${card.Name}${card.Subtitle ? `, ${card.Subtitle}` : ''}. ` +
    `Number ${card.Number}. Page ${page}, row ${row}, column ${column}. ` +
    `${inBinder} of ${quota} in binder` +
    `${inDecks > 0 ? `, ${inDecks} in decks` : ''}.` +
    // The foil finish is decorative, so it is announced in words instead.
    (isFoil ? ' Includes a foil.' : '');

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
        data-foil={isFoil}
        onClick={() => onSelect(card)}
        onPointerMove={isFoil ? trackFoilLight : undefined}
        onPointerLeave={isFoil ? releaseFoilLight : undefined}
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

        {isFoil && (
          <span
            className={styles.holo}
            aria-hidden="true"
            // Where the matte text box sits depends on the card's layout (see the CSS).
            data-card-type={card.Type}
            data-full-foil={choice?.fullFoil}
            // Staggers the idle animation, so a page of foils doesn't shimmer in lockstep.
            style={{ '--foil-seed': (parseInt(String(card.Number), 10) || 0) % 7 } as CSSProperties}
          />
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

/*
 * The foil light follows the pointer. Written straight to the element's style rather than
 * through state, so moving the mouse over a card never re-renders it. `data-tracking`
 * stops the idle drift animation, which would otherwise win over the inline values.
 */
function trackFoilLight(event: PointerEvent<HTMLButtonElement>) {
  if (event.pointerType !== 'mouse') return;
  const el = event.currentTarget;
  const box = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${((event.clientX - box.left) / box.width) * 100}%`);
  el.style.setProperty('--my', `${((event.clientY - box.top) / box.height) * 100}%`);
  el.dataset.tracking = 'true';
}

function releaseFoilLight(event: PointerEvent<HTMLButtonElement>) {
  const el = event.currentTarget;
  el.style.removeProperty('--mx');
  el.style.removeProperty('--my');
  delete el.dataset.tracking;
}
