import type { LoadedSet, Printing, VariantSlug } from '~/domain/catalog';
import { applyConstruct, cardKey, parseCardKey } from '~/domain/deckBuild';
import type { DeckCardRef } from '~/domain/deckContents';
import { parseDeckLibrary, type SavedDeck } from '~/domain/decks';
import { addVariants, subtractVariants, type VariantCounts } from '~/domain/ownership';
import { heldVariants } from '~/domain/deckBuild';
import type { SetKey } from '~/domain/types';

import { notifyDeckLibraryChanged, notifyInventoryChanged } from './changes';
import {
  db,
  emptyOwnedRow,
  printingId,
  withCount,
  type IntakeLine,
  type OwnedPrinting,
  type SwuDatabase,
} from './db';
import { closeOpenStack, discardOpenStack } from './stacks';

/**
 * The intake queue: cards on their way into the collection.
 *
 * Nothing here counts as owned until a batch is committed, which is the point — a deck
 * bought already built, or a stack of scanned cards, can be checked line by line (is that
 * a Hyperspace?) before it touches the inventory.
 */

/**
 * Queues every card of a saved deck at its Normal printing, ready for variants to be
 * corrected. Returns the existing batch if the deck is already queued, rather than
 * queuing its cards twice.
 */
export async function queueDeck(
  deck: SavedDeck,
  sets: ReadonlyMap<SetKey, LoadedSet>,
  { includeSideboard = false, database = db, now = Date.now() } = {},
): Promise<string> {
  const existing = await database.intakeBatches.where('deckId').equals(deck.id).first();
  if (existing) return existing.id;

  const refs = [deck.leader, deck.base, ...deck.mainDeck];
  if (deck.secondLeader) refs.push(deck.secondLeader);
  if (includeSideboard) refs.push(...deck.sideboard);

  const counts = new Map<string, number>();
  for (const ref of refs) {
    const key = cardKey(ref.setKey, ref.baseNumber);
    counts.set(key, (counts.get(key) ?? 0) + ref.count);
  }

  const batchId = crypto.randomUUID();
  const lines: IntakeLine[] = [];
  let order = 0;
  for (const [key, count] of counts) {
    const { setKey, baseNumber } = parseCardKey(key);
    const printing = sourcePrinting(sets.get(setKey)?.printingsByBase.get(baseNumber) ?? []);
    if (!printing) continue;
    lines.push({
      id: crypto.randomUUID(),
      batchId,
      setKey,
      base: baseNumber,
      num: printing.num,
      variant: printing.variant,
      count,
      order: order++,
    });
  }

  await database.transaction('rw', database.intakeBatches, database.intakeLines, async () => {
    await database.intakeBatches.add({
      id: batchId,
      kind: 'deck',
      label: deck.name,
      deckId: deck.id,
      createdAt: now,
    });
    await database.intakeLines.bulkAdd(lines);
  });
  return batchId;
}

/** What `queueScan` did, so a mistaken scan can be taken back exactly. */
export type ScanReceipt = {
  batchId: string;
  lineId: string;
  createdBatch: boolean;
  createdLine: boolean;
  /** The swap-out line this scan added to, when it displaced a weaker copy. */
  swapLineId?: string;
};

type QueuedPrinting = { setKey: SetKey; base: number; num: string; variant: VariantSlug };

/**
 * Adds one scanned copy to the open "Scanned cards" batch, creating the batch on first
 * use. A second copy of the same printing bumps that line's count. Nothing counts as owned
 * until the batch is reviewed and committed — the camera cannot tell foil from non-foil, so
 * that review is where finishes get set.
 */
export async function queueScan(
  printing: QueuedPrinting,
  {
    database = db,
    now = Date.now(),
    swapOut,
  }: { database?: SwuDatabase; now?: number; swapOut?: QueuedPrinting } = {},
): Promise<ScanReceipt> {
  return database.transaction('rw', database.intakeBatches, database.intakeLines, async () => {
    const open = (await database.intakeBatches.toArray())
      .filter((b) => b.kind === 'scan')
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    const batchId = open?.id ?? crypto.randomUUID();
    if (!open) {
      await database.intakeBatches.add({
        id: batchId,
        kind: 'scan',
        label: 'Scanned cards',
        createdAt: now,
      });
    }

    const lines = await database.intakeLines.where('batchId').equals(batchId).toArray();
    /** One more copy on the matching line, or a new line: its id, and whether it is new. */
    const bumpLine = async (p: QueuedPrinting, removal: boolean) => {
      const same = lines.find(
        (l) => l.setKey === p.setKey && l.num === p.num && Boolean(l.swapOut) === removal,
      );
      if (same) {
        await database.intakeLines.update(same.id, { count: same.count + 1 });
        return { id: same.id, created: false };
      }
      const id = crypto.randomUUID();
      await database.intakeLines.add({
        id,
        batchId,
        setKey: p.setKey,
        base: p.base,
        num: p.num,
        variant: p.variant,
        count: 1,
        // Newest scans last, in the order they were made.
        order: now,
        ...(removal ? { swapOut: true as const } : {}),
      });
      return { id, created: true };
    };

    const line = await bumpLine(printing, false);
    const swap = swapOut ? await bumpLine(swapOut, true) : undefined;
    return {
      batchId,
      lineId: line.id,
      createdBatch: !open,
      createdLine: line.created,
      ...(swap ? { swapLineId: swap.id } : {}),
    };
  });
}

/** Takes back one `queueScan`: one fewer copy, and no empty line or batch left behind. */
export async function unqueueScan(receipt: ScanReceipt, database: SwuDatabase = db): Promise<void> {
  await database.transaction('rw', database.intakeBatches, database.intakeLines, async () => {
    for (const id of [receipt.lineId, receipt.swapLineId]) {
      const line = id ? await database.intakeLines.get(id) : undefined;
      if (line && line.count > 1)
        await database.intakeLines.update(line.id, { count: line.count - 1 });
      else if (line) await database.intakeLines.delete(line.id);
    }
    if (
      receipt.createdBatch &&
      (await database.intakeLines.where('batchId').equals(receipt.batchId).count()) === 0
    ) {
      await database.intakeBatches.delete(receipt.batchId);
    }
  });
}

/** The printing a card's copies start on, and move back to: Normal, or its first printing. */
export function sourcePrinting(printings: readonly Printing[]): Printing | undefined {
  return printings.find((p) => p.variant === 'normal') ?? printings[0];
}

type CardRef = { batchId: string; setKey: SetKey; base: number };

/** A card's additions in a batch. Swap-outs are separate: allocating never touches them. */
async function cardLines(database: SwuDatabase, card: CardRef): Promise<IntakeLine[]> {
  return (await database.intakeLines.where('batchId').equals(card.batchId).toArray()).filter(
    (line) => line.setKey === card.setKey && line.base === card.base && !line.swapOut,
  );
}

/** Adds `delta` to one printing's line, creating or deleting the line as needed. */
async function bump(
  database: SwuDatabase,
  card: CardRef,
  lines: IntakeLine[],
  printing: Printing,
  delta: number,
): Promise<void> {
  const line = lines.find((l) => l.num === printing.num);
  if (line) {
    const count = line.count + delta;
    if (count > 0) await database.intakeLines.update(line.id, { count });
    else await database.intakeLines.delete(line.id);
    return;
  }
  if (delta <= 0) return;
  const order = lines.length ? Math.min(...lines.map((l) => l.order)) : Date.now();
  await database.intakeLines.add({
    id: crypto.randomUUID(),
    ...card,
    num: printing.num,
    variant: printing.variant,
    count: delta,
    order,
  });
}

/**
 * Moves one copy of a card from one printing to another — "one of these three is a
 * Hyperspace". Does nothing if `from` has no copy to give.
 */
export async function moveCopy(
  card: CardRef,
  from: Printing,
  to: Printing,
  database: SwuDatabase = db,
): Promise<void> {
  await database.transaction('rw', database.intakeLines, async () => {
    const lines = await cardLines(database, card);
    if ((lines.find((l) => l.num === from.num)?.count ?? 0) <= 0) return;
    await bump(database, card, lines, from, -1);
    await bump(database, card, await cardLines(database, card), to, +1);
  });
}

/**
 * Changes a card's total by one. Copies are added at the source printing; removing takes
 * from the source first, then from the last other printing that has one.
 */
export async function adjustCardCount(
  card: CardRef,
  source: Printing,
  delta: 1 | -1,
  database: SwuDatabase = db,
): Promise<void> {
  await database.transaction('rw', database.intakeLines, async () => {
    const lines = await cardLines(database, card);
    if (delta > 0) {
      await bump(database, card, lines, source, 1);
      return;
    }
    const fromSource = lines.find((l) => l.num === source.num && l.count > 0);
    const target = fromSource ?? [...lines].reverse().find((l) => l.count > 0);
    if (target) await bump(database, card, lines, target, -1);
  });
}

/** Moves every copy of a card back to its source printing. */
export async function resetCard(
  card: CardRef,
  source: Printing,
  database: SwuDatabase = db,
): Promise<void> {
  await database.transaction('rw', database.intakeLines, async () => {
    const lines = await cardLines(database, card);
    const moved = lines.filter((l) => l.num !== source.num);
    const total = moved.reduce((sum, l) => sum + l.count, 0);
    if (!total) return;
    await database.intakeLines.bulkDelete(moved.map((l) => l.id));
    await bump(database, card, await cardLines(database, card), source, total);
  });
}

/** Drops every copy of a card from the batch, and any swap it would have made. */
export async function removeCard(card: CardRef, database: SwuDatabase = db): Promise<void> {
  await database.transaction('rw', database.intakeLines, async () => {
    const lines = (await database.intakeLines.where('batchId').equals(card.batchId).toArray())
      .filter((line) => line.setKey === card.setKey && line.base === card.base)
      .map((line) => line.id);
    await database.intakeLines.bulkDelete(lines);
  });
}

/** Keeps the weaker copy after all: the better one is still added, as a spare. */
export async function cancelSwap(lineId: string, database: SwuDatabase = db): Promise<void> {
  await database.intakeLines.delete(lineId);
}

/**
 * What a card's binder pocket holds once the queue is committed: owned copies, less those
 * out in built decks, plus every copy already waiting in Intake (less queued swap-outs).
 * The scanner checks this to know whether a new copy has a place.
 */
export async function queuedPocket(
  setKey: SetKey,
  base: number,
  database: SwuDatabase = db,
): Promise<VariantCounts> {
  let owned: VariantCounts = {};
  for (const row of await database.owned.where({ setKey, base }).toArray()) {
    owned = addVariants(owned, { [row.variant]: row.count });
  }
  const library = parseDeckLibrary((await database.deckLibrary.get('library'))?.json ?? null);
  const held =
    heldVariants(library, (s, b) => (s === setKey && b === base ? owned : {})).get(
      cardKey(setKey, base),
    ) ?? {};
  let pocket = subtractVariants(owned, held);
  for (const line of await database.intakeLines.toArray()) {
    if (line.setKey !== setKey || line.base !== base) continue;
    const delta = { [line.variant]: line.count };
    pocket = line.swapOut ? subtractVariants(pocket, delta) : addVariants(pocket, delta);
  }
  return pocket;
}

/** Drops a batch unadded. Discarding scanned cards drops their stack too. */
export async function discardBatch(batchId: string, database: SwuDatabase = db): Promise<void> {
  await database.transaction(
    'rw',
    [database.intakeBatches, database.intakeLines, database.stacks, database.stackCards],
    async () => {
      const batch = await database.intakeBatches.get(batchId);
      await database.intakeLines.where('batchId').equals(batchId).delete();
      await database.intakeBatches.delete(batchId);
      if (batch?.kind === 'scan') await discardOpenStack(database);
    },
  );
}

export type CommitReport = { copies: number; deckBuilt: boolean };

/**
 * Adds a batch to the collection and clears it from the queue, in one transaction.
 *
 * For a deck batch, the same copies go straight into that deck's box: the cards were
 * never filed in the binder, so the binder's counts do not change.
 */
export async function commitBatch(
  batchId: string,
  database: SwuDatabase = db,
  now = Date.now(),
): Promise<CommitReport> {
  const touched = new Set<SetKey>();
  let copies = 0;
  let deckBuilt = false;

  await database.transaction(
    'rw',
    [
      database.owned,
      database.deckLibrary,
      database.intakeBatches,
      database.intakeLines,
      database.stacks,
    ],
    async () => {
      const batch = await database.intakeBatches.get(batchId);
      if (!batch) return;
      const all = (await database.intakeLines.where('batchId').equals(batchId).toArray()).filter(
        (line) => line.count > 0,
      );
      const lines = all.filter((line) => !line.swapOut);
      const swaps = all.filter((line) => line.swapOut);

      const rows = new Map<string, OwnedPrinting>();
      for (const line of lines) {
        const id = printingId(line.setKey, line.num);
        const current = rows.get(id) ?? (await database.owned.get(id));
        rows.set(
          id,
          withCount(
            current ?? emptyOwnedRow(line.setKey, line.base, line),
            (current?.count ?? 0) + line.count,
            now,
          ),
        );
        touched.add(line.setKey);
        copies += line.count;
      }
      // Swapped-out copies leave the collection (to bulk); never below zero.
      const emptied: string[] = [];
      for (const line of swaps) {
        const id = printingId(line.setKey, line.num);
        const current = rows.get(id) ?? (await database.owned.get(id));
        if (!current) continue;
        const count = Math.max(0, current.count - line.count);
        if (count === 0) {
          rows.delete(id);
          emptied.push(id);
        } else {
          rows.set(id, withCount(current, count, now));
        }
        touched.add(line.setKey);
      }
      if (rows.size) await database.owned.bulkPut([...rows.values()]);
      if (emptied.length) await database.owned.bulkDelete(emptied);

      if (batch.kind === 'deck' && batch.deckId) {
        const row = await database.deckLibrary.get('library');
        const library = parseDeckLibrary(row?.json ?? null);
        if (library.customDecks.some((d) => d.id === batch.deckId)) {
          // The box records exactly the printings reviewed here, so deconstructing later
          // files those same printings into the binder.
          const byCard = new Map<string, DeckCardRef>();
          for (const line of lines) {
            const key = cardKey(line.setKey, line.base);
            const ref = byCard.get(key) ?? { ...parseCardKey(key), count: 0, variants: {} };
            ref.count += line.count;
            ref.variants = addVariants(ref.variants ?? {}, { [line.variant]: line.count });
            byCard.set(key, ref);
          }
          const owned = new Map<string, VariantCounts>();
          for (const row of await database.owned.toArray()) {
            const key = cardKey(row.setKey, row.base);
            owned.set(key, addVariants(owned.get(key) ?? {}, { [row.variant]: row.count }));
          }
          const next = applyConstruct(
            library,
            batch.deckId,
            [...byCard.values()],
            [],
            (setKey, base) => owned.get(cardKey(setKey, base)) ?? {},
            new Date(now).toISOString(),
          );
          await database.deckLibrary.put({
            id: 'library',
            json: JSON.stringify(next),
            updatedAt: now,
          });
          deckBuilt = true;
        }
      }

      await database.intakeLines.where('batchId').equals(batchId).delete();
      await database.intakeBatches.delete(batchId);
      // The scanned stack stays, to be put away; the next scan starts a new one.
      if (batch.kind === 'scan') await closeOpenStack(database, now);
    },
  );

  for (const setKey of touched) notifyInventoryChanged(setKey);
  if (deckBuilt) notifyDeckLibraryChanged();
  return { copies, deckBuilt };
}
