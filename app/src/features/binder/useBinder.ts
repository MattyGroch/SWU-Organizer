import { useCallback, useMemo, useRef, useState } from 'react';

import {
  binderLayout,
  getSpreadCoords,
  pageToSpread,
  spreadToPrimaryPage,
  type MoveDirection,
} from '~/domain/binder';
import type { LoadedSet } from '~/domain/catalog';
import { selectionAfterMove } from '~/domain/selection';
import type { ActiveSelection, Card } from '~/domain/types';

const SLOTS_PER_PAGE = 12;

export type BinderGeometry = {
  maxNumber: number;
  totalPages: number;
  totalSpreads: number;
};

/**
 * Binder geometry for a set.
 *
 * Page 1 stands alone, then pages pair up into spreads (2/3, 4/5, …) the way a physical
 * binder opens.
 */
export function binderGeometry(set: LoadedSet): BinderGeometry {
  let maxNumber = 0;
  for (const card of set.baseCards) {
    if (card.Number > maxNumber) maxNumber = card.Number;
  }
  const totalPages = Math.max(1, Math.ceil(maxNumber / SLOTS_PER_PAGE));
  return {
    maxNumber,
    totalPages,
    totalSpreads: 1 + Math.ceil(Math.max(0, totalPages - 1) / 2),
  };
}

export function selectionForCard(card: Card): ActiveSelection {
  const { page, row, column } = binderLayout(card.Number);
  return { number: card.Number, card, page, row, column, ...getSpreadCoords(page, row, column) };
}

export type BinderState = {
  active: ActiveSelection | null;
  /** The page on screen: alone on a phone, or as part of its spread. */
  viewPage: number;
  /** The spread holding `viewPage`. */
  viewSpread: number;
  geometry: BinderGeometry;
  /** Set when selection changes, so the grid can move DOM focus to the new cell. */
  focusRequest: number;
  selectCard: (card: Card) => void;
  selectNumber: (baseNumber: number) => void;
  clearSelection: () => void;
  move: (direction: MoveDirection) => void;
  goToSpread: (spread: number) => void;
  stepSpread: (delta: number) => void;
  goToPage: (page: number) => void;
  stepPage: (delta: number) => void;
};

export function useBinder(set: LoadedSet): BinderState {
  const geometry = useMemo(() => binderGeometry(set), [set]);
  const [active, setActive] = useState<ActiveSelection | null>(null);
  const [viewPage, setViewPage] = useState(1);
  const viewSpread = pageToSpread(viewPage);
  const clampPage = useCallback(
    (page: number) => Math.max(1, Math.min(geometry.totalPages, page)),
    [geometry.totalPages],
  );

  /**
   * Reset when the set changes.
   *
   * The route reuses this component across sets, so without this the binder keeps the
   * previous set's open spread and a selection pointing at a card that is not on the
   * page — switching from SOR page 12 to another set would land you on its page 12 with
   * a stale highlight. Adjusting state during render is React's documented pattern for
   * this; an effect would paint the wrong page first.
   */
  const [renderedSetKey, setRenderedSetKey] = useState(set.setKey);
  if (renderedSetKey !== set.setKey) {
    setRenderedSetKey(set.setKey);
    setActive(null);
    setViewPage(1);
  }
  const focusRequestRef = useRef(0);
  const [focusRequest, setFocusRequest] = useState(0);

  const requestFocus = useCallback(() => {
    focusRequestRef.current += 1;
    setFocusRequest(focusRequestRef.current);
  }, []);

  const selectCard = useCallback(
    (card: Card) => {
      const next = selectionForCard(card);
      setActive(next);
      setViewPage(next.page);
      requestFocus();
    },
    [requestFocus],
  );

  const selectNumber = useCallback(
    (baseNumber: number) => {
      const card = set.byNumber.get(baseNumber);
      if (card) selectCard(card);
    },
    [set, selectCard],
  );

  const clearSelection = useCallback(() => setActive(null), []);

  const move = useCallback(
    (direction: MoveDirection) => {
      setActive((current) => {
        if (!current) return current;
        const next = selectionAfterMove(current, direction, geometry.totalPages, set.byNumber);
        if (next === current) return current;
        setViewPage(next.page);
        requestFocus();
        return next;
      });
    },
    [geometry.totalPages, set.byNumber, requestFocus],
  );

  const goToSpread = useCallback(
    (spread: number) => {
      const clamped = Math.max(0, Math.min(geometry.totalSpreads - 1, spread));
      setViewPage(clampPage(spreadToPrimaryPage(clamped)));
    },
    [geometry.totalSpreads, clampPage],
  );

  /** Browsing moves the viewed pages only; the selection stays where it was. */
  const stepSpread = useCallback(
    (delta: number) => {
      setViewPage((current) => {
        const spread = Math.max(
          0,
          Math.min(geometry.totalSpreads - 1, pageToSpread(current) + delta),
        );
        return clampPage(spreadToPrimaryPage(spread));
      });
    },
    [geometry.totalSpreads, clampPage],
  );

  const goToPage = useCallback((page: number) => setViewPage(clampPage(page)), [clampPage]);

  const stepPage = useCallback(
    (delta: number) => setViewPage((current) => clampPage(current + delta)),
    [clampPage],
  );

  return {
    active,
    viewPage,
    viewSpread,
    geometry,
    focusRequest,
    selectCard,
    selectNumber,
    clearSelection,
    move,
    goToSpread,
    stepSpread,
    goToPage,
    stepPage,
  };
}
