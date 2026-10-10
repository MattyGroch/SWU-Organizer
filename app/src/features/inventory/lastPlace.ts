import type { SetKey } from '~/domain/types';
import { EMPTY_FILTERS, type Filters } from '~/features/binder/cardRows';

import { isInventoryView, type InventoryView } from './views';

/**
 * Where you were in the Inventory tab, so leaving it and coming back (or reopening the
 * app) lands there again rather than on the newest set's first binder page.
 *
 * Four things are remembered: the place — which set, and Binder, List or Bulk; per set,
 * the binder page, the selected card and how far the list was scrolled; the list's
 * filters; and whether a desktop binder shows a spread or one page, and at what size. Positions are per set so `[`/`]` and swiping between sets also return to where
 * each one was left. Filters are not: they already carry over from set to set.
 *
 * Kept in memory and mirrored to localStorage. Storage is a convenience: without it, the
 * place still holds for as long as the app stays open.
 */

export type InventoryPlace = InventoryView | 'bulk';

/** A desktop binder shows a two-page spread, or one page at a time as on a phone. */
export type BinderLayout = 'spread' | 'page';

/** One page on a desktop: cards at spread size, or the page as wide as the window. */
export type BinderZoom = 'standard' | 'full';

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
const FILTERS_KEY = 'inventory:filters';
const BINDER_LAYOUT_KEY = 'inventory:binderLayout';
const BINDER_ZOOM_KEY = 'inventory:binderZoom';

let lastSet: SetKey | undefined;
let lastView: InventoryPlace | undefined;
let positions: Record<SetKey, SetPosition> | undefined;
let filters: Filters | undefined;
let binderLayout: BinderLayout | undefined;
let binderZoom: BinderZoom | undefined;
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

const stringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

/** The list's filters as last left, with anything unreadable reset to empty. */
export function readFilters(): Filters {
  if (filters) return filters;
  filters = EMPTY_FILTERS;
  const stored = read(FILTERS_KEY);
  if (!stored) return filters;
  try {
    const parsed = JSON.parse(stored) as Partial<Record<keyof Filters, unknown>>;
    filters = {
      aspect: stringList(parsed.aspect) ? parsed.aspect : [],
      rarity: stringList(parsed.rarity) ? parsed.rarity : [],
      type: stringList(parsed.type) ? parsed.type : [],
      status: stringList(parsed.status) ? (parsed.status as Filters['status']) : [],
      text: typeof parsed.text === 'string' ? parsed.text : '',
      hideInDecks: parsed.hideInDecks === true,
    };
  } catch {
    // Corrupt: start unfiltered.
  }
  return filters;
}

export function rememberFilters(next: Filters) {
  filters = next;
  write(FILTERS_KEY, JSON.stringify(next));
}

/** The desktop binder's layout as last chosen; a spread until one is. */
export function readBinderLayout(): BinderLayout {
  return (binderLayout ??= read(BINDER_LAYOUT_KEY) === 'page' ? 'page' : 'spread');
}

export function rememberBinderLayout(next: BinderLayout) {
  binderLayout = next;
  write(BINDER_LAYOUT_KEY, next);
}

/** The desktop single page's size as last chosen; standard until one is. */
export function readBinderZoom(): BinderZoom {
  return (binderZoom ??= read(BINDER_ZOOM_KEY) === 'full' ? 'full' : 'standard');
}

export function rememberBinderZoom(next: BinderZoom) {
  binderZoom = next;
  write(BINDER_ZOOM_KEY, next);
}

/** Tests only: forget everything held in memory, so the next read goes to storage. */
export function resetLastPlaceForTests() {
  lastSet = undefined;
  lastView = undefined;
  positions = undefined;
  filters = undefined;
  binderLayout = undefined;
  binderZoom = undefined;
  if (flushTimer !== undefined) clearTimeout(flushTimer);
  flushTimer = undefined;
}
