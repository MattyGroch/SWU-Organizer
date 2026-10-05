import type { VariantSlug } from '~/domain/catalog';
import type { DeckLibrary } from '~/domain/decks';
import type { SetKey } from '~/domain/types';

/** One resolved line of an import: a specific printing of a specific card. */
export type ImportedPrinting = {
  setKey: SetKey;
  base: number;
  num: string;
  variant: VariantSlug;
  count: number;
  /** How many of `count` live in the bulk box. Only this app's own backups say. */
  bulk?: number;
};

export type SkipReason =
  'unknown-set' | 'unknown-card' | 'unknown-variant' | 'malformed' | 'reserved-key';

export type ImportSkip = {
  reason: SkipReason;
  /** The source row, for showing the user what was not understood. */
  detail: string;
};

export type ImportResult = {
  printings: ImportedPrinting[];
  /** Source entries that resolved to a real printing. */
  recognized: number;
  skipped: ImportSkip[];
  /** Total copies across all resolved printings. */
  copies: number;
  format: ImportFormat;
  /** Saved decks and precon ownership, present only in this app's own backups. */
  deckLibrary?: DeckLibrary;
};

export type ImportFormat =
  'swudb-csv' | 'sw-unlimited' | 'hyperspace-vault' | 'app-json' | 'unknown';

export function emptyResult(format: ImportFormat): ImportResult {
  return { printings: [], recognized: 0, skipped: [], copies: 0, format };
}

/**
 * Storage keys the legacy app kept alongside real set inventories under the same `inv:`
 * prefix. An export that includes them must not create phantom sets.
 */
export const RESERVED_SET_KEYS = new Set(['schema-version', 'migration:v2:backup']);
