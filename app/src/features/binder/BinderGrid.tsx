import { useEffect, useRef } from 'react';

import { numberFromPagePosition, spreadToPrimaryPage } from '~/domain/binder';
import { promoArtKey, type PromoArtChoices } from '~/data/binderSettings';
import type { LoadedSet } from '~/domain/catalog';
import { type Homes, NO_HOMES, type OwnedCounts, ownedFor, quotaForCard } from '~/domain/ownership';
import type { DeckHold } from '~/domain/deckBuild';
import type { ActiveSelection, Card } from '~/domain/types';

import { BinderCell } from './BinderCell';
import styles from './BinderGrid.module.css';

const NO_DECKS: readonly DeckHold[] = [];
const ROWS = 3;
const COLS_PER_PAGE = 4;
const SPREAD_COLS = COLS_PER_PAGE * 2;

type Props = {
  set: LoadedSet;
  viewSpread: number;
  active: ActiveSelection | null;
  ownership: ReadonlyMap<number, OwnedCounts>;
  /** Base number → printings pulled into built decks. */
  held: ReadonlyMap<number, Homes>;
  /** Base number → the built decks holding it. */
  decks: ReadonlyMap<number, readonly DeckHold[]>;
  focusRequest: number;
  promoArt?: PromoArtChoices;
  onSelect: (card: Card) => void;
  /** On a phone: show only this page, four columns wide, instead of the spread. */
  singlePage?: number;
};

/**
 * The two-page binder spread — or, on a phone, the one page on screen.
 *
 * A real `role="grid"` of buttons with a roving tabindex. The legacy version was an SVG
 * whose cells were `<g onClick>` elements: not focusable, no roles, no labels, and
 * unreachable by keyboard or screen reader.
 *
 * Each cell is a single button. Quantity controls live in the selected-card panel rather
 * than inside the cell, because nesting several widgets per gridcell breaks the grid
 * keyboard pattern — and the `+`/`-` and digit shortcuts are the fast path anyway.
 */
export function BinderGrid({
  set,
  viewSpread,
  active,
  ownership,
  held,
  decks,
  focusRequest,
  promoArt,
  onSelect,
  singlePage,
}: Props) {
  const primaryPage = spreadToPrimaryPage(viewSpread);
  const leftPage = primaryPage % 2 === 0 ? primaryPage : primaryPage - 1;
  const rightPage = singlePage ?? (primaryPage % 2 === 1 ? primaryPage : primaryPage + 1);
  const showLeft = singlePage === undefined && leftPage >= 2;
  // One page fills the row on its own; a spread keeps page 1 on the right, as it opens.
  const columns = singlePage === undefined ? SPREAD_COLS : COLS_PER_PAGE;
  const leftColumns = columns - COLS_PER_PAGE;

  const gridRef = useRef<HTMLDivElement>(null);

  // Move DOM focus to the selected cell whenever the selection changes, so keyboard
  // navigation and screen-reader focus stay on the card the user is actually filing.
  useEffect(() => {
    if (!focusRequest || !active) return;
    const cell = gridRef.current?.querySelector<HTMLButtonElement>('[data-selected="true"]');
    cell?.focus({ preventScroll: false });
  }, [focusRequest, active]);

  // Cells dim only to make a selection stand out. With nothing selected on this spread —
  // no selection at all, or one on another page — the dimming hides the art for no gain.
  const hasVisibleSelection =
    !!active && (active.page === rightPage || (showLeft && active.page === leftPage));

  const label = showLeft
    ? `Binder spread, pages ${leftPage} and ${rightPage}`
    : `Binder, page ${rightPage}`;

  return (
    <div
      ref={gridRef}
      role="grid"
      aria-label={label}
      aria-rowcount={ROWS}
      aria-colcount={columns}
      className={styles.grid}
      data-single={singlePage !== undefined}
      data-has-selection={hasVisibleSelection}
    >
      {Array.from({ length: ROWS }, (_, rowIndex) => {
        const row = rowIndex + 1;
        return (
          <div key={row} role="row" className={styles.row} aria-rowindex={row}>
            {Array.from({ length: columns }, (_, colIndex) => {
              const spreadCol = colIndex + 1;
              const onLeftPage = spreadCol <= leftColumns;
              const page = onLeftPage ? leftPage : rightPage;
              const column = onLeftPage ? spreadCol : spreadCol - leftColumns;
              const hidden = onLeftPage && !showLeft;
              const number = numberFromPagePosition(page, row, column);
              const card = hidden ? undefined : set.byNumber.get(number);

              if (!card) {
                return (
                  <div
                    key={spreadCol}
                    role="gridcell"
                    aria-colindex={spreadCol}
                    aria-disabled="true"
                    className={`${styles.cell} ${styles.empty}`}
                  >
                    {!hidden && <span className={styles.emptyNumber}>{number}</span>}
                  </div>
                );
              }

              return (
                <BinderCell
                  key={spreadCol}
                  colIndex={spreadCol}
                  card={card}
                  catalogCard={set.cardsByBase.get(card.Number)}
                  setKey={set.setKey}
                  page={page}
                  row={row}
                  column={column}
                  selected={
                    !!active &&
                    active.page === page &&
                    active.row === row &&
                    active.column === column
                  }
                  counts={ownedFor(ownership, card.Number)}
                  held={held.get(card.Number) ?? NO_HOMES}
                  decks={decks.get(card.Number) ?? NO_DECKS}
                  quota={quotaForCard({ type: card.Type, maxCopies: card.MaxCopies })}
                  promoArt={promoArt?.[promoArtKey(set.setKey, card.Number)]}
                  onSelect={onSelect}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
