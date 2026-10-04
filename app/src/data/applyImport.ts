import { parseDeckLibrary, type DeckLibrary } from '~/domain/decks';
import type { ImportedPrinting } from '~/domain/import';
import type { SetKey } from '~/domain/types';

import { notifyDeckLibraryChanged, notifyInventoryChanged } from './changes';
import { db, printingId, type OwnedPrinting, type SwuDatabase } from './db';

/**
 * How an import combines with what is already recorded. Every mode works per printing —
 * a Hyperspace Vader is its own entry, separate from the Normal one.
 *
 * - `add`         — imported counts are added on top of existing ones.
 * - `missing`     — only printings you have none of are written; owned counts never change.
 * - `higher`      — each printing keeps whichever count is larger, file or collection.
 * - `replaceSets` — the sets the file mentions are cleared first; other sets are untouched.
 * - `replaceAll`  — the whole collection is cleared first: a full restore from a backup.
 */
export type ImportMode = 'add' | 'missing' | 'higher' | 'replaceSets' | 'replaceAll';

export type ApplyReport = {
  mode: ImportMode;
  /** Every set whose counts may have changed, including sets a full replace emptied. */
  setsTouched: SetKey[];
  /** Printings whose stored count actually changed. */
  printingsWritten: number;
  /** Printings in the file left as they were (`missing` / `higher`). */
  printingsUnchanged: number;
  /** Net change in total copies owned. */
  copiesDelta: number;
  decksRestored: boolean;
};

export type ApplyOptions = {
  /** Replaces the saved decks and precon ownership with this, in the same transaction. */
  deckLibrary?: DeckLibrary;
  database?: SwuDatabase;
  now?: number;
};

/** Files can list a printing more than once (one row per condition, say); sum them. */
function combineDuplicates(printings: readonly ImportedPrinting[]): ImportedPrinting[] {
  const byId = new Map<string, ImportedPrinting>();
  for (const printing of printings) {
    const id = printingId(printing.setKey, printing.num);
    const seen = byId.get(id);
    byId.set(id, seen ? { ...seen, count: seen.count + printing.count } : { ...printing });
  }
  return [...byId.values()];
}

function nextCount(mode: ImportMode, existing: number, imported: number): number {
  switch (mode) {
    case 'add':
      return existing + imported;
    case 'missing':
      return existing > 0 ? existing : imported;
    case 'higher':
      return Math.max(existing, imported);
    case 'replaceSets':
    case 'replaceAll':
      return imported;
  }
}

/**
 * Writes a parsed import into the database.
 *
 * The whole thing — clears, writes and an optional deck restore — runs in one
 * transaction, so a failure part-way cannot leave a half-replaced collection.
 */
export async function applyImport(
  printings: readonly ImportedPrinting[],
  mode: ImportMode,
  { deckLibrary, database = db, now = Date.now() }: ApplyOptions = {},
): Promise<ApplyReport> {
  const combined = combineDuplicates(printings);
  const touched = new Set<SetKey>(combined.map((p) => p.setKey));
  let printingsWritten = 0;
  let printingsUnchanged = 0;
  let copiesDelta = 0;

  await database.transaction('rw', database.owned, database.deckLibrary, async () => {
    if (mode === 'replaceAll') {
      const all = await database.owned.toArray();
      for (const row of all) {
        touched.add(row.setKey);
        copiesDelta -= row.count;
      }
      await database.owned.clear();
    } else if (mode === 'replaceSets') {
      for (const setKey of new Set(combined.map((p) => p.setKey))) {
        const rows = await database.owned.where('setKey').equals(setKey).toArray();
        for (const row of rows) copiesDelta -= row.count;
        await database.owned.where('setKey').equals(setKey).delete();
      }
    }

    const keepsExisting = mode === 'add' || mode === 'missing' || mode === 'higher';
    const rows: OwnedPrinting[] = [];
    for (const printing of combined) {
      const id = printingId(printing.setKey, printing.num);
      const existing = keepsExisting ? ((await database.owned.get(id))?.count ?? 0) : 0;
      const count = nextCount(mode, existing, printing.count);
      if (keepsExisting && count === existing) {
        printingsUnchanged += 1;
        continue;
      }
      printingsWritten += 1;
      copiesDelta += count - existing;
      rows.push({
        id,
        setKey: printing.setKey,
        base: printing.base,
        num: printing.num,
        variant: printing.variant,
        count,
        updatedAt: now,
      });
    }

    if (rows.length) await database.owned.bulkPut(rows);

    if (deckLibrary) {
      await database.deckLibrary.put({
        id: 'library',
        json: JSON.stringify(deckLibrary),
        updatedAt: now,
      });
    }
  });

  for (const setKey of touched) notifyInventoryChanged(setKey);
  if (deckLibrary) notifyDeckLibraryChanged();

  return {
    mode,
    setsTouched: [...touched],
    printingsWritten,
    printingsUnchanged,
    copiesDelta,
    decksRestored: !!deckLibrary,
  };
}

/**
 * A full offline backup: every printing owned, plus saved decks and precon ownership.
 *
 * v3 adds `decks`. v2 files (counts only) and the legacy v1 format still import.
 */
export type ExportPayload = {
  version: 3;
  exportedAt: string;
  /** setKey → printing number → count. Printing-level, unlike the legacy v1 export. */
  sets: Record<SetKey, Record<string, number>>;
  decks: DeckLibrary;
};

export async function buildExport(
  database: SwuDatabase = db,
  now = new Date(),
): Promise<ExportPayload> {
  const sets: Record<SetKey, Record<string, number>> = {};
  for (const row of await database.owned.toArray()) {
    if (row.count > 0) (sets[row.setKey] ??= {})[row.num] = row.count;
  }
  const libraryRow = await database.deckLibrary.get('library');
  return {
    version: 3,
    exportedAt: now.toISOString(),
    sets,
    decks: parseDeckLibrary(libraryRow?.json ?? null),
  };
}
