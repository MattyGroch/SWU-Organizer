import type { VariantSlug } from '~/domain/catalog';
import type { StackFate } from '~/domain/putAway';
import type { SetKey } from '~/domain/types';

import { db, type StackCardRow, type StackRow, type SwuDatabase } from './db';

/**
 * Scanned stacks, one row per physical card in scan order.
 *
 * The intake queue counts copies per printing, which is all a review needs, but loses
 * which copy came where. Putting the stack away needs exactly that, so every scan in Add
 * mode is logged here too — including the ones the scanner turned away to bulk, which
 * never reach the queue but are still in the stack in your hand.
 */

export type ScanEntry = {
  setKey: SetKey;
  base: number;
  num: string;
  variant: VariantSlug;
  fate: StackFate;
  swapOut?: { num: string; variant: VariantSlug };
};

async function openStack(database: SwuDatabase): Promise<StackRow | undefined> {
  return (await database.stacks.orderBy('createdAt').reverse().toArray()).find(
    (s) => s.closedAt === undefined,
  );
}

/** Adds one scanned card to the bottom of the open stack, starting a stack if needed. */
export async function logScan(
  entry: ScanEntry,
  { database = db, now = Date.now() }: { database?: SwuDatabase; now?: number } = {},
): Promise<string> {
  return database.transaction('rw', database.stacks, database.stackCards, async () => {
    let stack = await openStack(database);
    if (!stack) {
      stack = { id: crypto.randomUUID(), label: 'Scanned stack', createdAt: now, step: 0 };
      await database.stacks.add(stack);
    }
    const cards = await database.stackCards.where('stackId').equals(stack.id).toArray();
    const seq = cards.reduce((max, c) => Math.max(max, c.seq + 1), 0);
    const id = crypto.randomUUID();
    await database.stackCards.add({ id, stackId: stack.id, seq, ...entry });
    return id;
  });
}

/** Re-records a scanned card in place — a correction keeps its place in the stack. */
export async function updateScan(
  id: string,
  entry: ScanEntry,
  database: SwuDatabase = db,
): Promise<void> {
  await database.transaction('rw', database.stackCards, async () => {
    const card = await database.stackCards.get(id);
    if (!card) return;
    const { setKey, base, num, variant, fate, swapOut } = entry;
    const next: StackCardRow = {
      id: card.id,
      stackId: card.stackId,
      seq: card.seq,
      setKey,
      base,
      num,
      variant,
      fate,
      ...(swapOut ? { swapOut } : {}),
    };
    await database.stackCards.put(next);
  });
}

/** Takes a card back out of its stack; an open stack left empty goes with it. */
export async function dropScan(id: string, database: SwuDatabase = db): Promise<void> {
  await database.transaction('rw', database.stacks, database.stackCards, async () => {
    const card = await database.stackCards.get(id);
    if (!card) return;
    await database.stackCards.delete(id);
    const stack = await database.stacks.get(card.stackId);
    if (
      stack &&
      stack.closedAt === undefined &&
      (await database.stackCards.where('stackId').equals(stack.id).count()) === 0
    ) {
      await database.stacks.delete(stack.id);
    }
  });
}

/** Ends the open stack: the next scan starts a new one. Call inside a transaction on `stacks`. */
export async function closeOpenStack(database: SwuDatabase = db, now = Date.now()): Promise<void> {
  const stack = await openStack(database);
  if (stack) await database.stacks.update(stack.id, { closedAt: now });
}

/** Throws away the open stack, with the scan batch it belongs to. */
export async function discardOpenStack(database: SwuDatabase = db): Promise<void> {
  const stack = await openStack(database);
  if (stack) await dismissStack(stack.id, database);
}

/**
 * Starts (or restarts) putting a stack away with this many sorters. The stack is closed,
 * so new scans cannot shift the steps under you.
 */
export async function startPutAway(
  id: string,
  sorters: number,
  { database = db, now = Date.now() }: { database?: SwuDatabase; now?: number } = {},
): Promise<void> {
  await database.transaction('rw', database.stacks, async () => {
    const stack = await database.stacks.get(id);
    if (!stack) return;
    await database.stacks.put({ ...stack, sorters, step: 0, closedAt: stack.closedAt ?? now });
  });
}

/** Back to choosing sorters, from the first step. */
export async function resetPutAway(id: string, database: SwuDatabase = db): Promise<void> {
  await database.transaction('rw', database.stacks, async () => {
    const stack = await database.stacks.get(id);
    if (!stack) return;
    const { sorters: _, ...rest } = stack;
    await database.stacks.put({ ...rest, step: 0 });
  });
}

export async function setStep(id: string, step: number, database: SwuDatabase = db): Promise<void> {
  await database.stacks.update(id, { step });
}

export async function dismissStack(id: string, database: SwuDatabase = db): Promise<void> {
  await database.transaction('rw', database.stacks, database.stackCards, async () => {
    await database.stackCards.where('stackId').equals(id).delete();
    await database.stacks.delete(id);
  });
}

/** A stack's cards, top of the stack first. */
export async function stackCards(id: string, database: SwuDatabase = db): Promise<StackCardRow[]> {
  return (await database.stackCards.where('stackId').equals(id).toArray()).sort(
    (a, b) => a.seq - b.seq,
  );
}
