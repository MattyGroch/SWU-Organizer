import { useCallback, useState } from 'react';

import type { BulkRow } from './bulkRows';
import {
  checkState,
  pruneSelection,
  selectableIds,
  selectedRows,
  toggleMany,
  toggleOne,
  type CheckState,
  type RowId,
} from './bulkSelection';

export type BulkSelection = {
  /** Ticked row ids, already limited to the rows shown. */
  selected: ReadonlySet<RowId>;
  /** The ticked rows, in list order. */
  rows: BulkRow[];
  /** The check state of a group of rows (a section, or every row shown). */
  stateOf: (rows: readonly BulkRow[]) => CheckState;
  toggle: (id: RowId) => void;
  /** Ticks every selectable row of the group, or unticks them all if all are ticked. */
  toggleAll: (rows: readonly BulkRow[]) => void;
  clear: () => void;
};

/**
 * Selection for the bulk list. `shown` is whatever the page currently lists, after every
 * filter: ticks on rows that drop out of it are let go, so an action never reaches a row
 * you cannot see.
 */
export function useBulkSelection(shown: readonly BulkRow[]): BulkSelection {
  const [stored, setStored] = useState<ReadonlySet<RowId>>(() => new Set());
  const selected = pruneSelection(stored, shown);
  // Adjusting state while rendering, as React suggests for state derived from props.
  if (selected !== stored) setStored(selected);

  const toggle = useCallback((id: RowId) => setStored((s) => toggleOne(s, id)), []);
  const toggleAll = useCallback(
    (rows: readonly BulkRow[]) => setStored((s) => toggleMany(s, selectableIds(rows))),
    [],
  );
  const clear = useCallback(() => setStored(new Set()), []);

  return {
    selected,
    rows: selectedRows(shown, selected),
    stateOf: (rows) => checkState(selectableIds(rows), selected),
    toggle,
    toggleAll,
    clear,
  };
}
