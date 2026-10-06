import type { LoadedSet, Printing, VariantSlug } from '~/domain/catalog';
import { applyConstruct, cardKey, parseCardKey } from '~/domain/deckBuild';
import type { DeckCardRef } from '~/domain/deckContents';
import { parseDeckLibrary, type SavedDeck } from '~/domain/decks';
import {
  NO_HOMES,
  addVariants,
  spillToBulk,
  subtractVariants,
  type VariantCounts,
} from '~/domain/ownership';
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
import { heldFromBinder, readLibrary, spillCards, type QuotaOf } from './spill';
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
};

type QueuedPrinting = { setKey: SetKey; base: number; num: string; variant: VariantSlug };

/**
 * Adds one scanned copy to the open "Scanned cards" batch, creating the batch on first
 * use. A second copy of the same printing bumps that line's count. Nothing counts as owned
 * until the batch is reviewed and committed — the camera cannot tell foil from non-foil, so
 * that review is where finishes get set. Whether a copy ends up in the binder or the bulk
 * box is settled then too (see `commitBatch`).
 */
export async function queueScan(
  printing: QueuedPrinting,
  { database = db, now = Date.now() }: { database?: SwuDatabase; now?: number } = {},
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

    const same = (await database.intakeLines.where('batchId').equals(batchId).toArray()).find(
      (l) => l.setKey === printing.setKey && l.num === printing.num,
    );
    if (same) {
      await database.intakeLines.update(same.id, { count: same.count + 1 });
      return { batchId, lineId: same.id, createdBatch: !open, createdLine: false };
    }
    const id = crypto.randomUUID();
    await database.intakeLines.add({
      id,
      batchId,
      setKey: printing.setKey,
      base: printing.base,
      num: printing.num,
      variant: printing.variant,
      count: 1,
      // Newest scans last, in the order they were made.
      order: now,
    });
    return { batchId, lineId: id, createdBatch: !open, createdLine: true };
  });
}

/** Takes back one `queueScan`: one fewer copy, and no empty line or batch left behind. */
export async function unqueueScan(receipt: ScanReceipt, database: SwuDatabase = db): Promise<void> {
  await database.transaction('rw', database.intakeBatches, database.intakeLines, async () => {
    const line = await database.intakeLines.get(receipt.lineId);
    if (line && line.count > 1)
      await database.intakeLines.update(line.id, { count: line.count - 1 });
    else if (line) await database.intakeLines.delete(line.id);
    if (
      receipt.createdBatch &&
      (await database.intakeLines.where('batchId').equals(receipt.batchId).count()) === 0
    ) {
      await database.intakeBatches.delete(receipt.batchId);
    }
  });
}

/**
 * Takes one copy of a printing back out of the scanned cards, for a correction made
 * without the scan's receipt (putting a stack away). Falls back to another printing of the
 * same card, in case the copy was moved in Intake since. False when there is none to take.
 */
export async function unqueuePrinting(
  printing: QueuedPrinting,
  database: SwuDatabase = db,
): Promise<boolean> {
  return database.transaction('rw', database.intakeBatches, database.intakeLines, async () => {
    const scanBatches = (await database.intakeBatches.toArray())
      .filter((b) => b.kind === 'scan')
      .sort((a, b) => b.createdAt - a.createdAt);
    for (const exact of [true, false]) {
      for (const batch of scanBatches) {
        const line = (await database.intakeLines.where('batchId').equals(batch.id).toArray()).find(
          (l) =>
            l.setKey === printing.setKey &&
            l.base === printing.base &&
            (!exact || l.num === printing.num),
        );
        if (!line) continue;
        if (line.count > 1) await database.intakeLines.update(line.id, { count: line.count - 1 });
        else await database.intakeLines.delete(line.id);
        if ((await database.intakeLines.where('batchId').equals(batch.id).count()) === 0) {
          await database.intakeBatches.delete(batch.id);
        }
        return true;
      }
    }
    return false;
  });
}

/** The printing a card's copies start on, and move back to: Normal, or its first printing. */
export function sourcePrinting(printings: readonly Printing[]): Printing | undefined {
  return printings.find((p) => p.variant === 'normal') ?? printings[0];
}

type CardRef = { batchId: string; setKey: SetKey; base: number };

/** A card's lines in a batch: one per printing. */
async function cardLines(database: SwuDatabase, card: CardRef): Promise<IntakeLine[]> {
  return (await database.intakeLines.where('batchId').equals(card.batchId).toArray()).filter(
    (line) => line.setKey === card.setKey && line.base === card.base,
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

/** Drops every copy of a card from the batch. */
export async function removeCard(card: CardRef, database: SwuDatabase = db): Promise<void> {
  await database.transaction('rw', database.intakeLines, async () => {
    const lines = (await database.intakeLines.where('batchId').equals(card.batchId).toArray())
      .filter((line) => line.setKey === card.setKey && line.base === card.base)
      .map((line) => line.id);
    await database.intakeLines.bulkDelete(lines);
  });
}

/** One card's owned rows after its batch lines are added, the way `commitBatch` adds them. */
function withLines(
  rows: readonly OwnedPrinting[],
  lines: readonly IntakeLine[],
  now: number,
): OwnedPrinting[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const line of lines) {
    const id = printingId(line.setKey, line.num);
    const current = byId.get(id) ?? emptyOwnedRow(line.setKey, line.base, line);
    byId.set(id, withCount(current, current.count + line.count, now));
  }
  return [...byId.values()];
}

/**
 * What committing a scanned card's lines would send to the bulk box, per printing — for
 * showing before the batch is added.
 */
export async function bulkPreview(
  lines: readonly IntakeLine[],
  quota: number,
  database: SwuDatabase = db,
): Promise<VariantCounts> {
  const first = lines[0];
  if (!first) return {};
  const { setKey, base } = first;
  const card = withLines(await database.owned.where({ setKey, base }).toArray(), lines, 0);
  const held = heldFromBinder(await readLibrary(database), setKey, base);
  let moved: VariantCounts = {};
  spillToBulk(card, quota, held).forEach((row, i) => {
    const n = (row.bulk ?? 0) - (card[i]!.bulk ?? 0);
    if (n > 0) moved = addVariants(moved, { [row.variant]: n });
  });
  return moved;
}

/**
 * What a card's binder pocket would hold if everything waiting in Intake went into it:
 * copies whose home is the binder, less those out in built decks, plus every queued copy.
 * The scanner ranks a new copy against the best `quota` of these; the rest go to bulk on
 * commit.
 */
export async function queuedPocket(
  setKey: SetKey,
  base: number,
  database: SwuDatabase = db,
): Promise<VariantCounts> {
  const rows = await database.owned.where({ setKey, base }).toArray();
  let home: VariantCounts = {};
  for (const row of rows) {
    home = addVariants(home, { [row.variant]: row.count - Math.min(row.bulk ?? 0, row.count) });
  }
  const held = heldFromBinder(await readLibrary(database), setKey, base);
  let pocket = subtractVariants(home, held);
  for (const line of await database.intakeLines.toArray()) {
    if (line.setKey !== setKey || line.base !== base) continue;
    pocket = addVariants(pocket, { [line.variant]: line.count });
  }
  return pocket;
}

function groupLines(lines: readonly IntakeLine[]): Map<string, IntakeLine[]> {
  const byCard = new Map<string, IntakeLine[]>();
  for (const line of lines) {
    const key = cardKey(line.setKey, line.base);
    byCard.set(key, [...(byCard.get(key) ?? []), line]);
  }
  return byCard;
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

export type CommitReport = {
  copies: number;
  /** Copies sent to the bulk box because their binder pocket was full. */
  toBulk: number;
  deckBuilt: boolean;
};

/**
 * Adds a batch to the collection and clears it from the queue, in one transaction.
 *
 * For a deck batch, the same copies go straight into that deck's box: the cards were
 * never filed in the binder, so the binder's counts do not change.
 *
 * Every card the batch touched then keeps only the best `quotaOf` copies in its binder
 * pocket; the weakest extras go to the bulk box. That covers a scan of a card whose pocket
 * was full, and a better printing bumping a weaker one, with no special case for either.
 * Without `quotaOf`, nothing moves.
 */
export async function commitBatch(
  batchId: string,
  {
    database = db,
    now = Date.now(),
    quotaOf,
  }: {
    database?: SwuDatabase;
    now?: number;
    quotaOf?: QuotaOf;
  } = {},
): Promise<CommitReport> {
  const touched = new Set<SetKey>();
  let copies = 0;
  let toBulk = 0;
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
      const lines = (await database.intakeLines.where('batchId').equals(batchId).toArray()).filter(
        (line) => line.count > 0,
      );

      const cards = groupLines(lines);
      for (const ofCard of cards.values()) {
        const { setKey, base } = ofCard[0]!;
        const rows = await database.owned.where({ setKey, base }).toArray();
        await database.owned.bulkPut(withLines(rows, ofCard, now));
        touched.add(setKey);
        for (const line of ofCard) copies += line.count;
      }

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
          // Every ref names its printings, so the binder and bulk box are never consulted.
          const next = applyConstruct(
            library,
            batch.deckId,
            [...byCard.values()],
            [],
            () => NO_HOMES,
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

      if (quotaOf) {
        const keys = [...cards.values()].map((ofCard) => ofCard[0]!);
        toBulk = await spillCards(database, keys, quotaOf, now);
      }

      await database.intakeLines.where('batchId').equals(batchId).delete();
      await database.intakeBatches.delete(batchId);
      // The scanned stack stays, to be put away; the next scan starts a new one.
      if (batch.kind === 'scan') await closeOpenStack(database, now);
    },
  );

  for (const setKey of touched) notifyInventoryChanged(setKey);
  if (deckBuilt) notifyDeckLibraryChanged();
  return { copies, toBulk, deckBuilt };
}
