import { useRef, type PointerEvent } from 'react';

import { artUrl, type CatalogCard } from '~/domain/catalog';
import { isLandscapeArt, selectArtPrinting } from '~/domain/artSelection';
import {
  binderCount,
  pocketCounts,
  quotaForCard,
  spareCount,
  sumVariants,
  type OwnedCounts,
  type VariantCounts,
} from '~/domain/ownership';
import type { Card } from '~/domain/types';

import { aspectBackground, isLightFill, rarityStyle } from './aspect';
import styles from './BinderCell.module.css';
import { useCardImage } from './useCardImage';

/*
 * Dev-only foil experiment: `?foil=<variant>` picks how foil slots are marked, and is
 * remembered across navigation. `?foil=sparkle` (or clearing storage) returns to normal.
 * Production always gets the sparkle.
 */
type FoilVariant = 'sparkle' | 'rainbow' | 'rainbow-sparkle' | 'holo';
const FOIL_VARIANTS: readonly FoilVariant[] = ['sparkle', 'rainbow', 'rainbow-sparkle', 'holo'];

function devFoilVariant(): FoilVariant {
  if (!import.meta.env.DEV) return 'sparkle';
  try {
    const param = new URLSearchParams(location.search).get('foil');
    if (param) localStorage.setItem('dev:foil', param);
    const stored = localStorage.getItem('dev:foil') as FoilVariant | null;
    return stored && FOIL_VARIANTS.includes(stored) ? stored : 'sparkle';
  } catch {
    return 'sparkle';
  }
}

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
  held: VariantCounts;
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
  onSelect,
}: Props) {
  // The cell mirrors the physical pocket. Copies out in decks leave most valuable first,
  // so the art and foil mark come from what is actually still in the pages — and a pocket
  // emptied by decks looks exactly like a card you do not have.
  const pocket = pocketCounts(counts, held);
  const inDecks = sumVariants(held);
  const choice = catalogCard ? selectArtPrinting(catalogCard, pocket) : undefined;
  const foilVariant = devFoilVariant();
  // Holo: the sheen follows the pointer. Written straight to the element's style rather than
  // through state, so tracking the mouse never re-renders the cell.
  const sheenRef = useRef<HTMLSpanElement>(null);
  const trackSheen = (event: PointerEvent<HTMLElement>) => {
    const sheen = sheenRef.current;
    if (!sheen) return;
    const box = event.currentTarget.getBoundingClientRect();
    sheen.style.setProperty('--mx', `${((event.clientX - box.left) / box.width) * 100}%`);
    sheen.style.setProperty('--my', `${((event.clientY - box.top) / box.height) * 100}%`);
    sheen.dataset.active = 'true';
  };
  const resetSheen = () => {
    const sheen = sheenRef.current;
    if (!sheen) return;
    sheen.style.removeProperty('--mx');
    sheen.style.removeProperty('--my');
    sheen.dataset.active = 'false';
  };
  const { src, state } = useCardImage(choice ? artUrl(setKey, choice.printing.num) : undefined);

  const quota = quotaForCard({ type: card.Type, maxCopies: card.MaxCopies });
  const onHand = pocket.total;
  const inBinder = binderCount(onHand, quota);
  const spares = spareCount(onHand, quota);
  const pocketEmpty = onHand === 0;
  const rarity = rarityStyle(card.Rarity);
  const light = isLightFill(card.Aspects);
  const showArt = state === 'ready' && src;
  // Leaders and Bases are printed landscape; they sit turned sideways in a binder pocket.
  const rotated = isLandscapeArt(card.Type);

  const description =
    `${card.Name}${card.Subtitle ? `, ${card.Subtitle}` : ''}. ` +
    `Number ${card.Number}. Page ${page}, row ${row}, column ${column}. ` +
    `${inBinder} of ${quota} in binder${spares > 0 ? `, ${spares} spare` : ''}` +
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
        onPointerMove={trackSheen}
        onPointerLeave={resetSheen}
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

        {choice?.foil && !pocketEmpty && foilVariant !== 'sparkle' && (
          <span
            ref={sheenRef}
            className={styles.foilSheen}
            data-variant={foilVariant}
            aria-hidden="true"
          />
        )}

        {choice?.foil && !pocketEmpty && foilVariant !== 'rainbow' && foilVariant !== 'holo' && (
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
            {spares > 0 && <span className={styles.spares}>+{spares}</span>}
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
