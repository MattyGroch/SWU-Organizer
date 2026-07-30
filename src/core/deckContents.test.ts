import { describe, expect, it } from 'vitest';
import { addDeckContentsToTotals, deckContentsFromRows, type DeckContents } from './deckContents';
import type { ResolvedDeckRow } from './decklist';

function row(partial: Partial<ResolvedDeckRow> & Pick<ResolvedDeckRow, 'role' | 'setKey' | 'baseNumber' | 'count'>): ResolvedDeckRow {
  return { name: 'Card', price: 0, ambiguous: false, ...partial };
}

describe('deckContentsFromRows', () => {
  it('fails when there is no leader row', () => {
    const rows = [row({ role: 'base', setKey: 'SOR', baseNumber: 1, count: 1 })];
    expect(deckContentsFromRows(rows)).toEqual({ ok: false, reason: 'missing-leader' });
  });

  it('fails when there is no base row', () => {
    const rows = [row({ role: 'leader', setKey: 'SOR', baseNumber: 1, count: 1 })];
    expect(deckContentsFromRows(rows)).toEqual({ ok: false, reason: 'missing-base' });
  });

  it('groups a single-leader deck into leader/base/mainDeck/sideboard', () => {
    const rows = [
      row({ role: 'leader', setKey: 'SOR', baseNumber: 1, count: 1 }),
      row({ role: 'base', setKey: 'SOR', baseNumber: 2, count: 1 }),
      row({ role: 'deck', setKey: 'SOR', baseNumber: 3, count: 3 }),
      row({ role: 'sideboard', setKey: 'SOR', baseNumber: 4, count: 2 }),
    ];
    const result = deckContentsFromRows(rows);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.contents).toEqual({
      leader: { setKey: 'SOR', baseNumber: 1, count: 1 },
      secondLeader: undefined,
      base: { setKey: 'SOR', baseNumber: 2, count: 1 },
      mainDeck: [{ setKey: 'SOR', baseNumber: 3, count: 3 }],
      sideboard: [{ setKey: 'SOR', baseNumber: 4, count: 2 }],
    });
  });

  it('captures a second leader row for Twin Suns decks', () => {
    const rows = [
      row({ role: 'leader', setKey: 'TS26', baseNumber: 1, count: 1 }),
      row({ role: 'leader', setKey: 'TS26', baseNumber: 2, count: 1 }),
      row({ role: 'base', setKey: 'TS26', baseNumber: 3, count: 1 }),
    ];
    const result = deckContentsFromRows(rows);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.contents.secondLeader).toEqual({ setKey: 'TS26', baseNumber: 2, count: 1 });
  });
});

describe('addDeckContentsToTotals', () => {
  const contents: DeckContents = {
    leader: { setKey: 'SOR', baseNumber: 1, count: 1 },
    base: { setKey: 'SOR', baseNumber: 2, count: 1 },
    mainDeck: [{ setKey: 'SOR', baseNumber: 3, count: 3 }],
    sideboard: [{ setKey: 'SOR', baseNumber: 4, count: 2 }],
  };

  it('does nothing for a zero or negative multiplier', () => {
    const totals = {};
    addDeckContentsToTotals(totals, contents, 0);
    expect(totals).toEqual({});
  });

  it('multiplies every card by the given multiplier, uncapped', () => {
    const totals = {};
    addDeckContentsToTotals(totals, contents, 2);
    expect(totals).toEqual({
      SOR: { 1: 2, 2: 2, 3: 6, 4: 4 },
    });
  });

  it('accumulates across multiple calls instead of overwriting', () => {
    const totals = {};
    addDeckContentsToTotals(totals, contents, 1);
    addDeckContentsToTotals(totals, contents, 1);
    expect(totals).toEqual({
      SOR: { 1: 2, 2: 2, 3: 6, 4: 4 },
    });
  });

  it('merges contributions across different sets', () => {
    const totals = {};
    addDeckContentsToTotals(totals, contents, 1);
    addDeckContentsToTotals(
      totals,
      {
        leader: { setKey: 'JTL', baseNumber: 1, count: 1 },
        base: { setKey: 'JTL', baseNumber: 2, count: 1 },
        mainDeck: [],
        sideboard: [],
      },
      1,
    );
    expect(Object.keys(totals).sort()).toEqual(['JTL', 'SOR']);
  });
});
