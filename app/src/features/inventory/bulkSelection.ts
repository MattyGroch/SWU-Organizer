import { sumVariants } from '~/domain/ownership';
import type { BulkBoxRemoval } from '~/data/bulk';

import type { BulkRow } from './bulkRows';

/**
 * Ticking rows of the bulk list to remove many at once. Selection is a set of row ids;
 * only rows with copies physically in the box can be ticked — a row whose copies are all
 * out in decks has nothing to hand over.
 */

export type RowId = string;

export const rowId = (row: Pick<BulkRow, 'setKey' | 'base'>): RowId => `${row.setKey}:${row.base}`;

export const isSelectable = (row: BulkRow): boolean => row.boxCount > 0;

/** Ids of the rows that can be ticked, in order. */
export function selectableIds(rows: readonly BulkRow[]): RowId[] {
  return rows.filter(isSelectable).map(rowId);
}

export type CheckState = 'none' | 'some' | 'all';

/** How many of `ids` are ticked: drives a check-all box and its indeterminate dash. */
export function checkState(ids: readonly RowId[], selected: ReadonlySet<RowId>): CheckState {
  const ticked = ids.filter((id) => selected.has(id)).length;
  if (ticked === 0) return 'none';
  return ticked === ids.length ? 'all' : 'some';
}

/**
 * A check-all box was tapped: ticks every one of `ids`, unless all are ticked already, in
 * which case it unticks them. Rows outside `ids` keep their state.
 */
export function toggleMany(selected: ReadonlySet<RowId>, ids: readonly RowId[]): Set<RowId> {
  const next = new Set(selected);
  if (checkState(ids, selected) === 'all') for (const id of ids) next.delete(id);
  else for (const id of ids) next.add(id);
  return next;
}

export function toggleOne(selected: ReadonlySet<RowId>, id: RowId): Set<RowId> {
  const next = new Set(selected);
  if (!next.delete(id)) next.add(id);
  return next;
}

/**
 * Drops ticks on rows no longer shown or no longer selectable (filtered out, or emptied by
 * a removal). Returns `selected` itself when nothing changes, so callers can compare.
 */
export function pruneSelection(
  selected: ReadonlySet<RowId>,
  rows: readonly BulkRow[],
): ReadonlySet<RowId> {
  const allowed = new Set(selectableIds(rows));
  for (const id of selected) {
    if (!allowed.has(id)) return new Set([...selected].filter((s) => allowed.has(s)));
  }
  return selected;
}

/** The ticked rows, in list order. */
export function selectedRows(rows: readonly BulkRow[], selected: ReadonlySet<RowId>): BulkRow[] {
  return rows.filter((row) => isSelectable(row) && selected.has(rowId(row)));
}

/** Every copy physically in the box for each row — never the bulk copies out in decks. */
export function removalsFor(rows: readonly BulkRow[]): BulkBoxRemoval[] {
  return rows.map((row) => ({ setKey: row.setKey, base: row.base, remove: { ...row.inBox } }));
}

export function copiesIn(rows: readonly BulkRow[]): number {
  return rows.reduce((sum, row) => sum + sumVariants(row.inBox), 0);
}
