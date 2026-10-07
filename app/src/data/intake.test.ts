import { beforeEach, describe, expect, it } from 'vitest';

import { parseSetCatalog, toLoadedSet } from '~/domain/catalog';
import { parseDeckList } from '~/domain/decklist';
import type { SavedDeck } from '~/domain/decks';

import { SwuDatabase } from './db';
import { logScan } from './stacks';
import { readDeckLibrary, writeDeckLibraryQuietly } from './deckLibrary';
import {
  adjustCardCount,
  buildScannedDeck,
  commitBatch,
  convertToDeckScan,
  discardBatch,
  moveCopy,
  bulkPreview,
  queuedPocket,
  queueScan,
  queueDeck,
  removeCard,
  resetCard,
  scannedDeckProblem,
  unqueueScan,
  unqueuePrinting,
} from './intake';

const sets = new Map([
  [
    'SOR',
    toLoadedSet(
      parseSetCatalog({
        setKey: 'SOR',
        label: 'SOR',
        cards: [
          {
            base: 1,
            name: 'Krennic',
            type: 'Leader',
            rarity: 'Rare',
            aspects: [],
            printings: [{ num: '001', variant: 'normal' }],
          },
          {
            base: 19,
            name: 'Security Complex',
            type: 'Base',
            rarity: 'Common',
            aspects: [],
            printings: [{ num: '019', variant: 'normal' }],
          },
          {
            base: 33,
            name: 'Death Trooper',
            type: 'Unit',
            rarity: 'Common',
            aspects: [],
            printings: [
              { num: '033', variant: 'normal' },
              { num: '298', variant: 'hyperspace' },
            ],
          },
        ],
      }),
      new Map(),
    ),
  ],
]);

const ref = (baseNumber: number, count: number) => ({ setKey: 'SOR', baseNumber, count });
const deck: SavedDeck = {
  id: 'deck-1',
  name: 'Krennic Troopers',
  createdAt: '',
  updatedAt: '',
  physical: false,
  copies: 1,
  sourceText: '',
  constructed: false,
  pulledCards: [],
  leader: ref(1, 1),
  base: ref(19, 1),
  mainDeck: [ref(33, 3)],
  sideboard: [],
};

describe('intake queue', () => {
  let database: SwuDatabase;

  beforeEach(async () => {
    database = new SwuDatabase(`test-${crypto.randomUUID()}`);
    await database.open();
    await writeDeckLibraryQuietly({ customDecks: [deck], preconOwnership: {} }, database);
  });

  const lines = (batchId: string) =>
    database.intakeLines.where('batchId').equals(batchId).sortBy('order');

  it('queues a deck at Normal printings, once', async () => {
    const batchId = await queueDeck(deck, sets, { database });
    expect((await lines(batchId)).map((l) => [l.num, l.count])).toEqual([
      ['001', 1],
      ['019', 1],
      ['033', 3],
    ]);
    expect(await queueDeck(deck, sets, { database })).toBe(batchId);
    expect(await database.intakeLines.count()).toBe(3);
  });

  it('counts nothing as owned until committed', async () => {
    await queueDeck(deck, sets, { database });
    expect(await database.owned.count()).toBe(0);
  });

  const normal = { num: '033', variant: 'normal' as const };
  const hyper = { num: '298', variant: 'hyperspace' as const };

  it('moves copies between printings of a card, and back', async () => {
    const batchId = await queueDeck(deck, sets, { database });
    const trooper = { batchId, setKey: 'SOR', base: 33 };
    await moveCopy(trooper, normal, hyper, database);
    await moveCopy(trooper, normal, hyper, database);
    await moveCopy(trooper, hyper, normal, database);

    await commitBatch(batchId, { database });
    expect((await database.owned.get('SOR:033'))?.count).toBe(2);
    expect(await database.owned.get('SOR:298')).toMatchObject({ count: 1, variant: 'hyperspace' });
  });

  it('will not move a copy the source does not have', async () => {
    const batchId = await queueDeck(deck, sets, { database });
    const trooper = { batchId, setKey: 'SOR', base: 33 };
    for (let i = 0; i < 5; i++) await moveCopy(trooper, normal, hyper, database);
    const rows = (await lines(batchId)).filter((l) => l.base === 33);
    expect(rows.map((l) => [l.num, l.count])).toEqual([['298', 3]]);
  });

  it('adds copies at Normal and removes from Normal first', async () => {
    const batchId = await queueDeck(deck, sets, { database });
    const trooper = { batchId, setKey: 'SOR', base: 33 };
    await moveCopy(trooper, normal, hyper, database);
    await adjustCardCount(trooper, normal, 1, database);
    await adjustCardCount(trooper, normal, -1, database);
    await adjustCardCount(trooper, normal, -1, database);
    await adjustCardCount(trooper, normal, -1, database);
    // 3 Normal → 2N+1H → 3N+1H → 2N+1H → 1N+1H → 0N+1H: Normal runs out first.
    const rows = (await lines(batchId)).filter((l) => l.base === 33);
    expect(rows.map((l) => [l.num, l.count])).toEqual([['298', 1]]);
  });

  it('resets every copy of a card back to Normal', async () => {
    const batchId = await queueDeck(deck, sets, { database });
    const trooper = { batchId, setKey: 'SOR', base: 33 };
    await moveCopy(trooper, normal, hyper, database);
    await moveCopy(trooper, normal, hyper, database);
    await resetCard(trooper, normal, database);
    const rows = (await lines(batchId)).filter((l) => l.base === 33);
    expect(rows.map((l) => [l.num, l.count])).toEqual([['033', 3]]);
  });

  it('removes a card from the batch entirely', async () => {
    const batchId = await queueDeck(deck, sets, { database });
    await removeCard({ batchId, setKey: 'SOR', base: 33 }, database);
    expect((await lines(batchId)).some((l) => l.base === 33)).toBe(false);
  });

  it('commits a deck batch straight into the deck box, and clears the queue', async () => {
    const batchId = await queueDeck(deck, sets, { database });
    const report = await commitBatch(batchId, { database, quotaOf: () => 3 });

    // The copies go into the deck's box, so the binder pockets have nothing to spill.
    expect(report).toEqual({ copies: 5, toBulk: 0, deckBuilt: true });
    const [built] = (await readDeckLibrary(database)).customDecks;
    expect(built).toMatchObject({ constructed: true });
    // The box records the printings reviewed in intake, so deconstructing files them back.
    expect(built!.pulledCards).toContainEqual({ ...ref(33, 3), variants: { normal: 3 } });
    expect(await database.intakeBatches.count()).toBe(0);
    expect(await database.intakeLines.count()).toBe(0);
  });

  it('adds to copies already owned', async () => {
    await database.owned.put({
      id: 'SOR:033',
      setKey: 'SOR',
      base: 33,
      num: '033',
      variant: 'normal',
      count: 2,
      updatedAt: 0,
    });
    const batchId = await queueDeck(deck, sets, { database });
    await commitBatch(batchId, { database });
    expect((await database.owned.get('SOR:033'))?.count).toBe(5);
  });

  it('discards a batch without touching the collection', async () => {
    const batchId = await queueDeck(deck, sets, { database });
    await discardBatch(batchId, database);
    expect(await database.intakeLines.count()).toBe(0);
    expect(await database.owned.count()).toBe(0);
  });
});

describe('scanned cards', () => {
  let database: SwuDatabase;

  beforeEach(async () => {
    database = new SwuDatabase(`test-${crypto.randomUUID()}`);
    await database.open();
  });

  const trooper = { setKey: 'SOR', base: 33, num: '033', variant: 'normal' as const };
  const hyper = { setKey: 'SOR', base: 33, num: '298', variant: 'hyperspace' as const };

  it('go into one Scanned batch, a second copy bumping its line', async () => {
    const first = await queueScan(trooper, { database });
    await queueScan(trooper, { database });
    await queueScan(hyper, { database });

    expect(await database.intakeBatches.count()).toBe(1);
    expect((await database.intakeBatches.get(first.batchId))?.kind).toBe('scan');
    const lines = await database.intakeLines.where('batchId').equals(first.batchId).sortBy('order');
    expect(lines.map((l) => [l.num, l.count])).toEqual([
      ['033', 2],
      ['298', 1],
    ]);
    expect(await database.owned.count()).toBe(0);
  });

  it('can be taken back one scan at a time, leaving nothing empty behind', async () => {
    const a = await queueScan(trooper, { database });
    const b = await queueScan(trooper, { database });
    await unqueueScan(b, database);
    expect((await database.intakeLines.get(a.lineId))?.count).toBe(1);
    await unqueueScan(a, database);
    expect(await database.intakeLines.count()).toBe(0);
    expect(await database.intakeBatches.count()).toBe(0);
  });

  it('can be taken back without a receipt, by printing or else by card', async () => {
    await queueScan(trooper, { database });
    await queueScan(trooper, { database });
    await queueScan(hyper, { database });
    expect(await unqueuePrinting(hyper, database)).toBe(true);
    const nums = async () => (await database.intakeLines.toArray()).map((l) => [l.num, l.count]);
    expect(await nums()).toEqual([['033', 2]]);
    // Moved to another printing in Intake since: a copy of the same card goes instead.
    expect(await unqueuePrinting(hyper, database)).toBe(true);
    expect(await nums()).toEqual([['033', 1]]);
    await unqueuePrinting(trooper, database);
    expect(await database.intakeBatches.count()).toBe(0);
    expect(await unqueuePrinting(trooper, database)).toBe(false);
  });

  it('commit straight into the binder, like any batch', async () => {
    const { batchId } = await queueScan(trooper, { database });
    await commitBatch(batchId, { database });
    expect((await database.owned.get('SOR:033'))?.count).toBe(1);
  });
  const own = (num: string, variant: 'normal' | 'hyperspace', count: number, bulk?: number) =>
    database.owned.put({
      id: `SOR:${num}`,
      setKey: 'SOR',
      base: 33,
      num,
      variant,
      count,
      ...(bulk !== undefined && { bulk }),
      updatedAt: 1,
    });
  const quotaOf = () => 3;
  const row = async (num: string) => {
    const r = await database.owned.get(`SOR:${num}`);
    return r && [r.count, r.bulk ?? 0];
  };

  it('know what the pocket will hold: binder copies not in decks, plus queued', async () => {
    await own('033', 'normal', 4, 2);
    await queueScan(trooper, { database });
    expect(await queuedPocket('SOR', 33, database)).toEqual({ normal: 3 });
    await queueScan(hyper, { database });
    expect(await queuedPocket('SOR', 33, database)).toEqual({ normal: 3, hyperspace: 1 });
  });

  it('a copy for a full pocket is kept, in the bulk box', async () => {
    await own('033', 'normal', 3);
    const { batchId } = await queueScan(trooper, { database });
    const report = await commitBatch(batchId, { database, quotaOf });
    expect(report).toMatchObject({ copies: 1, toBulk: 1 });
    expect(await row('033')).toEqual([4, 1]);
  });

  it('a better printing bumps the weakest binder copy to bulk', async () => {
    await own('033', 'normal', 3);
    const { batchId } = await queueScan(hyper, { database });
    await commitBatch(batchId, { database, quotaOf });
    expect(await row('033')).toEqual([3, 1]);
    expect(await row('298')).toEqual([1, 0]);
  });

  it('copies already in bulk stay there and never refill the pocket', async () => {
    await own('033', 'normal', 3, 3);
    const { batchId } = await queueScan(trooper, { database });
    await commitBatch(batchId, { database, quotaOf });
    expect(await row('033')).toEqual([4, 3]);
  });

  it('copies out in decks leave room in the pocket', async () => {
    await own('033', 'normal', 3);
    await writeDeckLibraryQuietly(
      {
        customDecks: [{ ...deck, constructed: true, pulledCards: [ref(33, 2)] }],
        preconOwnership: {},
      },
      database,
    );
    const { batchId } = await queueScan(trooper, { database });
    await commitBatch(batchId, { database, quotaOf });
    expect(await row('033')).toEqual([4, 0]);
  });

  it('previews what a card sends to bulk before the batch is added', async () => {
    await own('033', 'normal', 3);
    const { batchId } = await queueScan(hyper, { database });
    await queueScan(trooper, { database });
    const queued = await database.intakeLines.where('batchId').equals(batchId).toArray();
    expect(await bulkPreview(queued, 3, database)).toEqual({ normal: 2 });
    expect(await database.owned.count()).toBe(1);
  });
});

describe('scanned decks', () => {
  let database: SwuDatabase;

  beforeEach(async () => {
    database = new SwuDatabase(`test-${crypto.randomUUID()}`);
    await database.open();
  });

  const krennic = { setKey: 'SOR', base: 1, num: '001', variant: 'normal' as const };
  const complex = { setKey: 'SOR', base: 19, num: '019', variant: 'normal' as const };
  const trooper = { setKey: 'SOR', base: 33, num: '033', variant: 'normal' as const };
  const hyper = { setKey: 'SOR', base: 33, num: '298', variant: 'hyperspace' as const };
  const scanDeck = async (...printings: Array<typeof trooper | typeof hyper>) => {
    let batchId = '';
    for (const p of printings) ({ batchId } = await queueScan(p, { database, kind: 'deckScan' }));
    return batchId;
  };
  const linesOf = (batchId: string) =>
    database.intakeLines.where('batchId').equals(batchId).toArray();

  it('queue apart from loose scans', async () => {
    const loose = await queueScan(trooper, { database });
    const deckBatch = await scanDeck(trooper);
    expect(deckBatch).not.toBe(loose.batchId);
    expect((await database.intakeBatches.get(deckBatch))?.label).toBe('Scanned deck');
  });

  it('take no room in the binder pocket', async () => {
    await scanDeck(trooper, trooper);
    await queueScan(trooper, { database });
    expect(await queuedPocket('SOR', 33, database)).toEqual({ normal: 1 });
  });

  it('need a leader and a base before they can be built', async () => {
    const batchId = await scanDeck(krennic, trooper);
    expect(scannedDeckProblem(await linesOf(batchId), sets)).toBe('missing-base');
    expect(await buildScannedDeck(batchId, 'Troopers', sets, { database })).toEqual({
      ok: false,
      reason: 'missing-base',
    });
    expect(await database.intakeBatches.get(batchId)).toMatchObject({ kind: 'deckScan' });
    expect((await readDeckLibrary(database)).customDecks).toEqual([]);
  });

  it('build into a saved deck, its box holding the printings scanned', async () => {
    const batchId = await scanDeck(krennic, complex, trooper, trooper, hyper);
    expect(scannedDeckProblem(await linesOf(batchId), sets)).toBeNull();

    const result = await buildScannedDeck(batchId, 'Krennic Troopers', sets, {
      database,
      quotaOf: () => 3,
    });

    expect(result).toMatchObject({ ok: true, report: { copies: 5, toBulk: 0, deckBuilt: true } });
    const [built] = (await readDeckLibrary(database)).customDecks;
    expect(built).toMatchObject({
      name: 'Krennic Troopers',
      constructed: true,
      physical: false,
      leader: ref(1, 1),
      base: ref(19, 1),
      mainDeck: [ref(33, 3)],
      sideboard: [],
    });
    expect(built!.pulledCards).toContainEqual({
      ...ref(33, 3),
      variants: { normal: 2, hyperspace: 1 },
    });
    expect((await database.owned.get('SOR:298'))?.count).toBe(1);
    expect(await database.intakeBatches.count()).toBe(0);
    // The kept source reads back as the same deck.
    const parsed = parseDeckList(built!.sourceText);
    expect(parsed.format).toBe('melee');
    expect(parsed.entries.map((e) => [e.role, e.name, e.count])).toEqual([
      ['leader', 'Krennic', 1],
      ['base', 'Security Complex', 1],
      ['deck', 'Death Trooper', 3],
    ]);
  });

  it('can be made from scanned cards, dropping their stack', async () => {
    const { batchId } = await queueScan(trooper, { database });
    await logScan({ ...trooper, fate: 'binder' }, { database });
    await convertToDeckScan(batchId, database);
    expect(await database.intakeBatches.get(batchId)).toMatchObject({
      kind: 'deckScan',
      label: 'Scanned deck',
    });
    expect(await database.stacks.count()).toBe(0);
    expect(await database.stackCards.count()).toBe(0);
  });
});
