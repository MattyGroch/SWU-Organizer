import { matchesCardTraits, type Filters } from '~/features/binder/cardRows';
import type { SetKey } from '~/domain/types';

import { matchesBulkSearch, type BulkRow } from './bulkRows';

/** Everything the Bulk tab narrows its rows by. */
export type BulkFilters = {
  /** One set, or '' for every set. */
  setKey: SetKey | '';
  /** The search box: name, subtitle, set or number. */
  query: string;
  /**
   * The List tab's chips. Only Aspect, Rarity and Type apply: every card in the box already
   * has its playset (Status), and Hide out in decks is about binder pockets. Their text is
   * unused — the search box covers it, and more.
   */
  chips: Filters;
};

export function matchesBulkFilters(row: BulkRow, filters: BulkFilters): boolean {
  return (
    (!filters.setKey || row.setKey === filters.setKey) &&
    matchesCardTraits(row, filters.chips) &&
    matchesBulkSearch(row, filters.query)
  );
}

/** The rows the filters let through, keeping their order (and so their sections). */
export function filterBulkRows(rows: readonly BulkRow[], filters: BulkFilters): BulkRow[] {
  return rows.filter((row) => matchesBulkFilters(row, filters));
}
