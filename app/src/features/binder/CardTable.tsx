import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { DeckHold } from '~/domain/deckBuild';
import { formatUsd } from '~/ui/format';

import { STATUS_GLYPH, STATUS_LABEL, type CardRow } from './cardRows';
import styles from './CardTable.module.css';
import { pocketDecksTitle } from './deckHolds';
import { AspectIcons } from './AspectIcons';
import { RarityBadge } from './RarityBadge';
import { UniqueMark } from './UniqueMark';

const ROW_HEIGHT = 44;
const OVERSCAN = 8;

type Props = {
  rows: CardRow[];
  selectedBase: number | null;
  onSelect: (base: number) => void;
  /** Base number → the built decks holding it, named in the ⇠ badge's tooltip. */
  decks: ReadonlyMap<number, readonly DeckHold[]>;
  /** Where to scroll to on mount, so the list reopens where it was left. */
  initialScrollTop?: number;
  onScrollTopChange?: (scrollTop: number) => void;
};

/**
 * Windowed card table.
 *
 * Only the rows near the viewport are in the DOM. The legacy tables rendered every row of
 * a 250-card set — and did it again on every quantity change, because the row list was
 * recomputed from `inventory` on each keystroke.
 *
 * Virtualization is hand-rolled rather than pulled from a library: rows are a fixed
 * height, so the whole implementation is a slice and two spacer rows.
 */
export function CardTable({
  rows,
  selectedBase,
  onSelect,
  decks,
  initialScrollTop = 0,
  onScrollTopChange,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(initialScrollTop);

  // Before paint, so a restored list never flashes its first rows. The browser clamps an
  // offset past the end, e.g. when filters have since shortened the list.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && initialScrollTop > 0) {
      element.scrollTop = initialScrollTop;
      setScrollTop(element.scrollTop);
    }
    // Mount only: later changes come from the user scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [viewportHeight, setViewportHeight] = useState(600);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setViewportHeight(entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { start, end } = useMemo(() => {
    const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const visible = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
    return { start: first, end: Math.min(rows.length, first + visible) };
  }, [scrollTop, viewportHeight, rows.length]);

  const visibleRows = rows.slice(start, end);
  const padTop = start * ROW_HEIGHT;
  const padBottom = Math.max(0, (rows.length - end) * ROW_HEIGHT);

  if (rows.length === 0) {
    return <p className={styles.empty}>No cards match these filters.</p>;
  }

  return (
    <div
      ref={scrollRef}
      className={styles.scroller}
      onScroll={(event) => {
        setScrollTop(event.currentTarget.scrollTop);
        onScrollTopChange?.(event.currentTarget.scrollTop);
      }}
    >
      <table className={styles.table}>
        <caption className="visually-hidden">Cards in this set — {rows.length} rows</caption>
        <thead>
          <tr>
            <th scope="col" className={styles.numCol}>
              #
            </th>
            <th scope="col" className={styles.dotCol}>
              <span className="visually-hidden">Aspect</span>
            </th>
            <th scope="col" className={styles.rarCol}>
              <span className="visually-hidden">Rarity</span>
            </th>
            <th scope="col">Name</th>
            <th scope="col" className={styles.typeCol}>
              Type
            </th>
            <th scope="col" className={styles.statusCol}>
              Status
            </th>
            <th
              scope="col"
              className={styles.numericCol}
              title="Copies in the binder pocket, of its playset"
            >
              Binder
            </th>
            <th
              scope="col"
              className={`${styles.numericCol} ${styles.wideOnly}`}
              title="Copies in the bulk box"
            >
              Bulk
            </th>
            <th
              scope="col"
              className={`${styles.numericCol} ${styles.wideOnly}`}
              title="Copies out in built decks, from the binder or the bulk box"
            >
              Decks
            </th>
            <th
              scope="col"
              className={`${styles.numericCol} ${styles.wideOnly}`}
              title="Copies still needed for a playset"
            >
              Need
            </th>
            <th scope="col" className={`${styles.numericCol} ${styles.wideOnly}`}>
              Value
            </th>
            <th
              scope="col"
              className={`${styles.numericCol} ${styles.wideOnly}`}
              title="Cost of the copies still needed"
            >
              Cost
            </th>
          </tr>
        </thead>
        <tbody>
          {padTop > 0 && (
            <tr aria-hidden="true" style={{ height: padTop }}>
              <td colSpan={12} />
            </tr>
          )}

          {visibleRows.map((row) => {
            return (
              <tr
                key={row.base}
                className={styles.row}
                aria-selected={row.base === selectedBase}
                onClick={() => onSelect(row.base)}
              >
                <td className={styles.numCol}>
                  <button
                    type="button"
                    className={styles.jump}
                    onClick={() => onSelect(row.base)}
                    aria-label={`Show ${row.name} in the binder`}
                  >
                    {row.base}
                  </button>
                </td>
                <td className={styles.dotCol}>
                  <AspectIcons className={styles.aspects} aspects={row.aspects} />
                </td>
                <td className={styles.rarCol}>
                  <RarityBadge className={styles.rarity} rarity={row.rarity} title={row.rarity}>
                    <span className="visually-hidden">{row.rarity}</span>
                  </RarityBadge>
                </td>
                <td className={styles.nameCell}>
                  {row.unique && <UniqueMark />}
                  {row.name}
                  {row.subtitle && <span className={styles.subtitle}>{row.subtitle}</span>}
                </td>
                <td className={styles.typeCol}>{row.type}</td>
                <td className={styles.statusCol}>
                  <span
                    className={styles.status}
                    data-status={row.status}
                    title={STATUS_LABEL[row.status]}
                  >
                    <span aria-hidden="true">{STATUS_GLYPH[row.status]}</span>
                    <span className="visually-hidden">{STATUS_LABEL[row.status]}</span>
                  </span>
                </td>

                <td className={`${styles.numericCol} ${styles.owned}`} data-status={row.status}>
                  {row.pocketInDecks > 0 && (
                    <span
                      className={styles.inDecks}
                      title={pocketDecksTitle(row.pocketInDecks, decks.get(row.base) ?? [])}
                    >
                      {row.pocketInDecks}⇠<span className="visually-hidden"> in decks, </span>
                    </span>
                  )}
                  {row.inBinder}/{row.quota}
                </td>
                <td className={`${styles.numericCol} ${styles.wideOnly}`}>{row.inBulk || ''}</td>
                <td className={`${styles.numericCol} ${styles.wideOnly}`}>{row.inDecks || ''}</td>
                <td className={`${styles.numericCol} ${styles.wideOnly}`}>{row.needed || ''}</td>
                <td className={`${styles.numericCol} ${styles.wideOnly}`}>
                  {row.value ? formatUsd(row.value) : ''}
                </td>
                <td className={`${styles.numericCol} ${styles.wideOnly}`}>
                  {row.missingCost ? formatUsd(row.missingCost) : ''}
                </td>
              </tr>
            );
          })}

          {padBottom > 0 && (
            <tr aria-hidden="true" style={{ height: padBottom }}>
              <td colSpan={12} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
