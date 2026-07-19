import { getSpreadCoords, moveBinderSelection, type MoveDirection } from './binder';
import type { AppSettings } from './settings';
import type { ActiveSelection, Card } from './types';

export type BinderViewMode = 'single' | 'spread';

export function viewModeAfterSelection(
  settings: AppSettings,
  currentMode: BinderViewMode,
): BinderViewMode {
  return settings.autoOpenSinglePage ? 'single' : currentMode;
}

export function selectionAfterMove(
  active: ActiveSelection,
  direction: MoveDirection,
  totalPages: number,
  byNumber: ReadonlyMap<number, Card>,
): ActiveSelection {
  const next = moveBinderSelection(active, direction, totalPages);
  if (next === active) return active;

  const card = byNumber.get(next.number);
  if (!card) return active;

  return {
    ...next,
    card,
    ...getSpreadCoords(next.page, next.row, next.column),
  };
}
