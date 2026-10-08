import { beforeEach, describe, expect, it } from 'vitest';

import { SwuDatabase, type OwnedPrinting } from './db';
import { quickAdd, undoQuickAdd } from './quickAdd';

const normal = { setKey: 'SOR', base: 59, num: '059', variant: 'normal' } as const;
const foil = { setKey: 'SOR', base: 59, num: '059F', variant: 'foil' } as const;

function row(printing: typeof normal | typeof foil, count: number, bulk?: number): OwnedPrinting {
  return {
    id: `SOR:${printing.num}`,
    ...printing,
    count,
    ...(bulk ? { bulk } : {}),
    updatedAt: 1,
  };
}

describe('quickAdd', () => {
  let database: SwuDatabase;
  const counts = async () =>
    Object.fromEntries(
      (await database.owned.toArray()).map((r) => [r.num, [r.count, r.bulk ?? 0]]),
    );

  beforeEach(async () => {
    database = new SwuDatabase(`test-${crypto.randomUUID()}`);
    await database.open();
  });

  it('files a copy into a pocket with room', async () => {
    await database.owned.put(row(normal, 2));
    const added = await quickAdd(normal, 3, database);
    expect(added.fate).toEqual({ kind: 'binder' });
    expect(await counts()).toEqual({ '059': [3, 0] });
  });

  it('adds a first copy of a card never owned', async () => {
    const added = await quickAdd(foil, 3, database);
    expect(added.fate).toEqual({ kind: 'binder' });
    expect(await counts()).toEqual({ '059F': [1, 0] });
  });

  it('sends a copy no better than a full pocket to bulk', async () => {
    await database.owned.put(row(normal, 3));
    const added = await quickAdd(normal, 3, database);
    expect(added.fate).toEqual({ kind: 'bulk' });
    expect(await counts()).toEqual({ '059': [4, 1] });
  });

  it('swaps a better printing in, sending the weakest copy to bulk', async () => {
    await database.owned.put(row(normal, 3));
    const added = await quickAdd(foil, 3, database);
    expect(added.fate).toEqual({ kind: 'swap', swapOut: { num: '059', variant: 'normal' } });
    expect(await counts()).toEqual({ '059': [3, 1], '059F': [1, 0] });
  });

  it('undoes a swap exactly', async () => {
    await database.owned.put(row(normal, 3));
    const added = await quickAdd(foil, 3, database);
    await undoQuickAdd(added, database);
    expect(await counts()).toEqual({ '059': [3, 0] });
  });

  it('undoes a first copy by removing its row', async () => {
    const added = await quickAdd(foil, 3, database);
    await undoQuickAdd(added, database);
    expect(await counts()).toEqual({});
  });

  it('takes a binder copy off the binder when the card changed since', async () => {
    await database.owned.put(row(normal, 1));
    const first = await quickAdd(normal, 3, database);
    await quickAdd(normal, 3, database);
    await undoQuickAdd(first, database);
    expect(await counts()).toEqual({ '059': [2, 0] });
  });

  it('takes off just one copy when the card changed since', async () => {
    await database.owned.put(row(normal, 3));
    const first = await quickAdd(normal, 3, database);
    await quickAdd(normal, 3, database);
    await undoQuickAdd(first, database);
    // Both went to bulk, so the copy taken back comes out of bulk too.
    expect(await counts()).toEqual({ '059': [4, 1] });
  });
});
