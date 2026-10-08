import type { SetKey } from '~/domain/types';

import { isInventoryView, type InventoryView } from './views';

/**
 * Where you were in the Inventory tab, so leaving it and coming back (or reopening the
 * app) lands there again rather than on the newest set's first binder page.
 *
 * Two things are remembered: the place — which set, and Binder, List or Bulk — and, per
 * set, the binder page, the selected card and how far the list was scrolled. Positions are
 * per set so `[`/`]` and swiping between sets also return to where each one was left.
 *
 * Kept in memory and mirrored to localStorage. Storage is a convenience: without it, the
 * place still holds for as long as the app stays open.
 */

export type InventoryPlace = InventoryView | 'bulk';

export type SetPosition = {
  /** The binder page on screen. */
  page?: number;
  /** Base number of the selected card. */
  card?: number;
  /** The card list's scroll offset, in pixels. */
  listTop?: number;
};

const LAST_SET_KEY = 'inventory:lastSet';
const LAST_VIEW_KEY = 'inventory:lastView';
const POSITIONS_KEY = 'inventory:positions';

let lastSet: SetKey | undefined;
let lastView: InventoryPlace | undefined;
let positions: Record<SetKey, SetPosition> | undefined;
let flushTimer: ReturnType<typeof setTimeout> | undefined;

function read(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Memory still holds it for this session.
  }
}

export function readLastSet(): SetKey | undefined {
  return (lastSet ??= read(LAST_SET_KEY));
}

export function readLastView(): InventoryPlace | undefined {
  if (lastView) return lastView;
  const stored = read(LAST_VIEW_KEY);
  if (stored && (stored === 'bulk' || isInventoryView(stored))) lastView = stored;
  return lastView;
}

/** Records the page on screen. `setKey` is absent on Bulk, which keeps the last set. */
export function rememberPlace(view: InventoryPlace, setKey?: SetKey) {
  lastView = view;
  write(LAST_VIEW_KEY, view);
  if (setKey) {
    lastSet = setKey;
    write(LAST_SET_KEY, setKey);
  }
}

function allPositions(): Record<SetKey, SetPosition> {
  if (positions) return positions;
  positions = {};
  const stored = read(POSITIONS_KEY);
  if (stored) {
    try {
      const parsed: unknown = JSON.parse(stored);
      if (parsed && typeof parsed === 'object') positions = parsed as Record<SetKey, SetPosition>;
    } catch {
      // A corrupt entry just means starting from the top.
    }
  }
  return positions;
}

export function readPosition(setKey: SetKey): SetPosition {
  return allPositions()[setKey] ?? {};
}

/**
 * Merges into the set's position. Scrolling calls this on every frame, so storage is
 * written once things settle rather than each time.
 */
export function rememberPosition(setKey: SetKey, patch: SetPosition) {
  const all = allPositions();
  all[setKey] = { ...all[setKey], ...patch };
  if (flushTimer !== undefined) clearTimeout(flushTimer);
  flushTimer = setTimeout(flushPositions, 300);
}

function flushPositions() {
  if (flushTimer === undefined) return;
  clearTimeout(flushTimer);
  flushTimer = undefined;
  if (positions) write(POSITIONS_KEY, JSON.stringify(positions));
}

// A phone may kill the app once it is in the background, so don't leave the last move
// waiting on the timer.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPositions();
  });
  window.addEventListener('pagehide', flushPositions);
}

/** Tests only: forget everything held in memory, so the next read goes to storage. */
export function resetLastPlaceForTests() {
  lastSet = undefined;
  lastView = undefined;
  positions = undefined;
  if (flushTimer !== undefined) clearTimeout(flushTimer);
  flushTimer = undefined;
}
