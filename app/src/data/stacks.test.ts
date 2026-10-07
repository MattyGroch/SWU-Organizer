import { beforeEach, describe, expect, it } from 'vitest';

import { SwuDatabase } from './db';
import { commitBatch, discardBatch, queueScan } from './intake';
import {
  addMissedCopy,
  dismissStack,
  pullCard,
  resetPutAway,
  dropScan,
  logScan,
  setStep,
  stackCards,
  startPutAway,
  updateScan,
  type ScanEntry,
} from './stacks';

const scan = (base: number, extra: Partial<ScanEntry> = {}): ScanEntry => ({
  setKey: 'SOR',
  base,
  num: String(base).padStart(3, '0'),
  variant: 'normal',
  fate: 'binder',
  ...extra,
});

describe('scanned stacks', () => {
  let database: SwuDatabase;

  beforeEach(async () => {
    database = new SwuDatabase(`test-${crypto.randomUUID()}`);
    await database.open();
  });

  const only = async () => {
    const stacks = await database.stacks.toArray();
    expect(stacks).toHaveLength(1);
    return stacks[0]!;
  };
  const bases = async (id: string) => (await stackCards(id, database)).map((c) => c.base);

  it('keeps one row per copy, in scan order', async () => {
    await logScan(scan(33), { database });
    await logScan(scan(1, { fate: 'bulk' }), { database });
    await logScan(scan(33), { database });
    const stack = await only();
    expect(await bases(stack.id)).toEqual([33, 1, 33]);
    expect((await stackCards(stack.id, database)).map((c) => c.fate)).toEqual([
      'binder',
      'bulk',
      'binder',
    ]);
  });

  it('corrects a card in place, and drops one without disturbing the rest', async () => {
    const a = await logScan(scan(1), { database });
    const b = await logScan(scan(2, { swapOut: { num: '002', variant: 'normal' } }), { database });
    await logScan(scan(3), { database });
    await updateScan(a, scan(9), database);
    await updateScan(b, scan(2, { fate: 'bulk' }), database);
    const stack = await only();
    const cards = await stackCards(stack.id, database);
    expect(cards.map((c) => c.base)).toEqual([9, 2, 3]);
    expect(cards[1]!.fate).toBe('bulk');
    expect(cards[1]!.swapOut).toBeUndefined();
    await dropScan(b, database);
    expect(await bases(stack.id)).toEqual([9, 3]);
  });

  it('drops an open stack once its last card is taken back', async () => {
    const a = await logScan(scan(1), { database });
    await dropScan(a, database);
    expect(await database.stacks.count()).toBe(0);
  });

  it('survives its batch being added, and the next scan starts a new stack', async () => {
    const receipt = await queueScan(scan(1), { database });
    await logScan(scan(1), { database });
    await commitBatch(receipt.batchId, { database });
    const stack = await only();
    expect(stack.closedAt).toBeDefined();
    await logScan(scan(5), { database });
    expect(await database.stacks.count()).toBe(2);
    expect(await bases(stack.id)).toEqual([1]);
  });

  it('goes with its batch when the batch is discarded', async () => {
    const receipt = await queueScan(scan(1), { database });
    await logScan(scan(1), { database });
    await discardBatch(receipt.batchId, database);
    expect(await database.stacks.count()).toBe(0);
    expect(await database.stackCards.count()).toBe(0);
  });

  it('closes when putting away starts, and remembers the step', async () => {
    await logScan(scan(1), { database });
    const stack = await only();
    await startPutAway(stack.id, 2, { database });
    await setStep(stack.id, 4, database);
    expect(await only()).toMatchObject({ sorters: 2, step: 4, closedAt: expect.any(Number) });
    await logScan(scan(2), { database });
    expect(await database.stacks.count()).toBe(2);
    await dismissStack(stack.id, database);
    expect(await database.stacks.count()).toBe(1);
    expect(await database.stackCards.count()).toBe(1);
  });

  it('keeps the plan as it was at the start while cards are pulled or added', async () => {
    await logScan(scan(1), { database });
    const second = await logScan(scan(2), { database });
    const third = await logScan(scan(3), { database });
    const stack = await only();
    await startPutAway(stack.id, 1, { database });
    expect((await only()).plan?.map((c) => c.base)).toEqual([1, 2, 3]);

    // Corrected while being filed: noted, so it is filed at that step.
    await pullCard(stack.id, second, 4, scan(20), { database, now: true });
    await pullCard(stack.id, third, 5, null, { database });
    const extra = await addMissedCopy(stack.id, scan(1), database);
    // Correcting a card already to one side drops nothing more.
    await pullCard(stack.id, second, 7, scan(21), { database });

    const after = await only();
    expect(after.plan?.map((c) => c.base)).toEqual([1, 2, 3]);
    expect(after.pulls).toEqual([
      { id: second, at: 4, now: true },
      { id: third, at: 5 },
    ]);
    expect(await bases(stack.id)).toEqual([1, 21, 1]);
    expect((await stackCards(stack.id, database)).at(-1)!.id).toBe(extra);
  });

  it('notes the plan before the first pull of a walk started without one', async () => {
    const first = await logScan(scan(1), { database });
    await logScan(scan(2), { database });
    const stack = await only();
    await database.stacks.update(stack.id, { sorters: 1 });
    await pullCard(stack.id, first, 0, null, { database });
    expect((await only()).plan?.map((c) => c.base)).toEqual([1, 2]);
    expect(await bases(stack.id)).toEqual([2]);
  });

  it('plans afresh after starting over', async () => {
    const first = await logScan(scan(1), { database });
    const stack = await only();
    await startPutAway(stack.id, 1, { database });
    await pullCard(stack.id, first, 0, scan(9), { database });
    await resetPutAway(stack.id, database);
    const reset = await only();
    expect(reset.plan).toBeUndefined();
    expect(reset.pulls).toBeUndefined();
  });
});
