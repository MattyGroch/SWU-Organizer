import { VALUE_ORDER } from '~/domain/ownership';
import type { LoadedSet, VariantSlug } from '~/domain/catalog';
import { applyDeconstruct, cardKey } from '~/domain/deckBuild';
import { parseDeckLibrary } from '~/domain/decks';
import type { SetKey } from '~/domain/types';

import { notifyDeckLibraryChanged, notifyInventoryChanged } from './changes';
import {
  db,
  emptyOwnedRow,
  printingId,
  withCount,
  type IntakeBatch,
  type IntakeLine,
  type OwnedPrinting,
  type StackCardRow,
  type StackRow,
  type SwuDatabase,
} from './db';
import { defaultPrinting } from './inventory';

/**
 * Bulk edits and resets, each undoable.
 *
 * Every operation returns a snapshot of exactly what it replaced, so the UI can offer
 * Undo instead of a confirmation prompt — the legacy app had neither.
 */

export type BulkAction = 'add' | 'fillPlayset' | 'remove' | 'clear';

/**
 * The order single copies are removed: plainest first, so premium copies are the last
 * to go. A Prestige Serialized goes only when nothing else is left.
 */
const REMOVE_ORDER: readonly VariantSlug[] = [...VALUE_ORDER].reverse();

export type Snapshot = {
  /** Rows to delete before restoring: every row of each touched card or set. */
  scope: { setKey: SetKey; bases?: number[] } | 'all';
  rows: OwnedPrinting[];
  /** The deck library as it was, when the operation changed it. */
  deckLibraryJson?: string | null;
};

export type BulkResult = { changed: number; decksUnbuilt: number; undo: Snapshot };

type Options = {
  /** Clear only: return built decks holding a cleared card to Not built. */
  unbuildDecks?: boolean;
  database?: SwuDatabase;
  now?: number;
};

/** Returns built decks that hold any card matching `affected` to Not built. */
async function unbuildDecksHolding(
  database: SwuDatabase,
  affected: (setKey: SetKey, base: number) => boolean,
  now: number,
): Promise<{ count: number; before: string | null }> {
  const row = await database.deckLibrary.get('library');
  const before = row?.json ?? null;
  let library = parseDeckLibrary(before);
  let count = 0;
  for (const deck of library.customDecks) {
    if (!deck.constructed) continue;
    if (deck.pulledCards.some((ref) => affected(ref.setKey, ref.baseNumber))) {
      library = applyDeconstruct(library, deck.id, new Date(now).toISOString());
      count += 1;
    }
  }
  if (count) {
    await database.deckLibrary.put({
      id: 'library',
      json: JSON.stringify(library),
      updatedAt: now,
    });
  }
  return { count, before };
}

/**
 * Applies one action to many cards of a set, in a single transaction.
 *
 * - `add` — one more Normal copy, but only for cards short of a playset (never a spare).
 * - `fillPlayset` — Normal copies up to the playset, counting every printing owned.
 * - `remove` — one copy, plainest printing first.
 * - `clear` — every printing of the card.
 */
export async function bulkAdjust(
  set: LoadedSet,
  bases: readonly number[],
  action: BulkAction,
  quotaOf: (base: number) => number,
  { unbuildDecks = false, database = db, now = Date.now() }: Options = {},
): Promise<BulkResult> {
  const before: OwnedPrinting[] = [];
  const touched: number[] = [];
  let decksUnbuilt = 0;
  let deckLibraryJson: string | null | undefined;

  await database.transaction('rw', database.owned, database.deckLibrary, async () => {
    for (const base of bases) {
      const rows = await database.owned.where({ setKey: set.setKey, base }).toArray();
      const total = rows.reduce((sum, row) => sum + row.count, 0);
      const quota = quotaOf(base);
      const source = defaultPrinting(set, base);

      let changedHere = false;
      if ((action === 'add' || action === 'fillPlayset') && total < quota && source) {
        const id = printingId(set.setKey, source.num);
        const existing = rows.find((row) => row.id === id);
        const add = action === 'add' ? 1 : quota - total;
        await database.owned.put(
          withCount(
            existing ?? emptyOwnedRow(set.setKey, base, source),
            (existing?.count ?? 0) + add,
            now,
          ),
        );
        changedHere = true;
      } else if (action === 'remove' && total > 0) {
        const row = REMOVE_ORDER.map((v) => rows.find((r) => r.variant === v && r.count > 0)).find(
          Boolean,
        );
        if (row) {
          if (row.count > 1) await database.owned.put(withCount(row, row.count - 1, now));
          else await database.owned.delete(row.id);
          changedHere = true;
        }
      } else if (action === 'clear' && rows.length) {
        await database.owned.bulkDelete(rows.map((row) => row.id));
        changedHere = true;
      }

      if (changedHere) {
        before.push(...rows);
        touched.push(base);
      }
    }

    if (action === 'clear' && unbuildDecks && touched.length) {
      const cleared = new Set(touched.map((base) => cardKey(set.setKey, base)));
      const result = await unbuildDecksHolding(
        database,
        (setKey, base) => cleared.has(cardKey(setKey, base)),
        now,
      );
      decksUnbuilt = result.count;
      if (result.count) deckLibraryJson = result.before;
    }
  });

  if (touched.length) notifyInventoryChanged(set.setKey);
  if (decksUnbuilt) notifyDeckLibraryChanged();
  return {
    changed: touched.length,
    decksUnbuilt,
    undo: { scope: { setKey: set.setKey, bases: touched }, rows: before, deckLibraryJson },
  };
}

/** Empties one set, or the whole collection when `setKey` is omitted. */
export async function resetCollection(
  setKey: SetKey | undefined,
  { unbuildDecks = false, database = db, now = Date.now() }: Options = {},
): Promise<BulkResult> {
  let rows: OwnedPrinting[] = [];
  let decksUnbuilt = 0;
  let deckLibraryJson: string | null | undefined;

  await database.transaction('rw', database.owned, database.deckLibrary, async () => {
    rows = setKey
      ? await database.owned.where('setKey').equals(setKey).toArray()
      : await database.owned.toArray();
    if (setKey) await database.owned.where('setKey').equals(setKey).delete();
    else await database.owned.clear();

    if (unbuildDecks) {
      const result = await unbuildDecksHolding(
        database,
        (refSet) => setKey === undefined || refSet === setKey,
        now,
      );
      decksUnbuilt = result.count;
      if (result.count) deckLibraryJson = result.before;
    }
  });

  for (const key of new Set(rows.map((row) => row.setKey))) notifyInventoryChanged(key);
  if (decksUnbuilt) notifyDeckLibraryChanged();
  return {
    changed: rows.length,
    decksUnbuilt,
    undo: { scope: setKey ? { setKey } : 'all', rows, deckLibraryJson },
  };
}

/** Everything `eraseEverything` removed, to put back on Undo. */
export type ErasedSnapshot = {
  rows: OwnedPrinting[];
  deckLibraryJson: string | null;
  intakeBatches: IntakeBatch[];
  intakeLines: IntakeLine[];
  stacks: StackRow[];
  stackCards: StackCardRow[];
};

/**
 * Back to zero: every card, saved deck and precon tick, plus the Intake queue and scanned
 * stacks. Settings, sign-in and the card-art cache stay.
 *
 * Decks are deleted the way the Decks page deletes one, with a remembered deletion, and
 * precons are set to 0 rather than dropped — otherwise the next sync would read them as
 * never downloaded and bring the server's copies back.
 */
export async function eraseEverything({
  database = db,
  now = Date.now(),
}: { database?: SwuDatabase; now?: number } = {}): Promise<ErasedSnapshot> {
  let snapshot!: ErasedSnapshot;

  await database.transaction(
    'rw',
    [
      database.owned,
      database.deckLibrary,
      database.intakeBatches,
      database.intakeLines,
      database.stacks,
      database.stackCards,
    ],
    async () => {
      const libraryRow = await database.deckLibrary.get('library');
      snapshot = {
        rows: await database.owned.toArray(),
        deckLibraryJson: libraryRow?.json ?? null,
        intakeBatches: await database.intakeBatches.toArray(),
        intakeLines: await database.intakeLines.toArray(),
        stacks: await database.stacks.toArray(),
        stackCards: await database.stackCards.toArray(),
      };

      const at = new Date(now).toISOString();
      const library = parseDeckLibrary(snapshot.deckLibraryJson);
      const deletedDecks = { ...library.deletedDecks };
      for (const deck of library.customDecks) deletedDecks[deck.id] = at;
      const preconOwnership = Object.fromEntries(
        Object.keys(library.preconOwnership).map((key) => [key, 0]),
      );
      await database.deckLibrary.put({
        id: 'library',
        json: JSON.stringify({ customDecks: [], preconOwnership, deletedDecks }),
        updatedAt: now,
      });

      await database.owned.clear();
      await database.intakeBatches.clear();
      await database.intakeLines.clear();
      await database.stacks.clear();
      await database.stackCards.clear();
    },
  );

  for (const key of new Set(snapshot.rows.map((row) => row.setKey))) notifyInventoryChanged(key);
  notifyDeckLibraryChanged();
  return snapshot;
}

/**
 * Undoes `eraseEverything`. Restored decks are stamped as edited now, so they outlive the
 * deletions a sync may already have sent.
 */
export async function restoreErased(
  snapshot: ErasedSnapshot,
  { database = db, now = Date.now() }: { database?: SwuDatabase; now?: number } = {},
): Promise<void> {
  const sets = new Set<SetKey>(snapshot.rows.map((row) => row.setKey));

  await database.transaction(
    'rw',
    [
      database.owned,
      database.deckLibrary,
      database.intakeBatches,
      database.intakeLines,
      database.stacks,
      database.stackCards,
    ],
    async () => {
      for (const row of await database.owned.toArray()) sets.add(row.setKey);
      await database.owned.clear();
      await database.owned.bulkPut(snapshot.rows);

      const at = new Date(now).toISOString();
      const library = parseDeckLibrary(snapshot.deckLibraryJson);
      await database.deckLibrary.put({
        id: 'library',
        json: JSON.stringify({
          ...library,
          customDecks: library.customDecks.map((deck) => ({ ...deck, updatedAt: at })),
        }),
        updatedAt: now,
      });

      await database.intakeBatches.bulkPut(snapshot.intakeBatches);
      await database.intakeLines.bulkPut(snapshot.intakeLines);
      await database.stacks.bulkPut(snapshot.stacks);
      await database.stackCards.bulkPut(snapshot.stackCards);
    },
  );

  for (const key of sets) notifyInventoryChanged(key);
  notifyDeckLibraryChanged();
}

/** Puts back exactly what a bulk edit or reset replaced. */
export async function restoreSnapshot(
  snapshot: Snapshot,
  database: SwuDatabase = db,
): Promise<void> {
  const sets = new Set<SetKey>(snapshot.rows.map((row) => row.setKey));

  await database.transaction('rw', database.owned, database.deckLibrary, async () => {
    const { scope } = snapshot;
    if (scope === 'all') {
      for (const row of await database.owned.toArray()) sets.add(row.setKey);
      await database.owned.clear();
    } else if (scope.bases) {
      sets.add(scope.setKey);
      for (const base of scope.bases) {
        await database.owned.where({ setKey: scope.setKey, base }).delete();
      }
    } else {
      sets.add(scope.setKey);
      await database.owned.where('setKey').equals(scope.setKey).delete();
    }
    if (snapshot.rows.length) await database.owned.bulkPut(snapshot.rows);

    if (snapshot.deckLibraryJson !== undefined) {
      if (snapshot.deckLibraryJson === null) await database.deckLibrary.delete('library');
      else {
        await database.deckLibrary.put({
          id: 'library',
          json: snapshot.deckLibraryJson,
          updatedAt: Date.now(),
        });
      }
    }
  });

  for (const key of sets) notifyInventoryChanged(key);
  if (snapshot.deckLibraryJson !== undefined) notifyDeckLibraryChanged();
}

/** Undoes several bulk edits made together — newest first, so each restores what it saw. */
export async function restoreSnapshots(
  snapshots: readonly Snapshot[],
  database: SwuDatabase = db,
): Promise<void> {
  for (const snapshot of [...snapshots].reverse()) await restoreSnapshot(snapshot, database);
}
