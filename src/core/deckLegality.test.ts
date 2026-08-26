import { describe, expect, it } from 'vitest';
import { checkDeckLegality, deckStats, detectPlayFormat } from './deckLegality';
import type { ResolvedDeckRow } from './decklist';

function row(
  partial: Partial<ResolvedDeckRow> &
    Pick<ResolvedDeckRow, 'role' | 'setKey' | 'baseNumber' | 'count'>,
): ResolvedDeckRow {
  return { name: `Card ${partial.baseNumber}`, price: 0, ambiguous: false, ...partial };
}

/** A main deck of `size` cards spread over distinct singleton titles, starting at card #100. */
function singletonDeck(size: number, setKey = 'TS26'): ResolvedDeckRow[] {
  return Array.from({ length: size }, (_, i) =>
    row({ role: 'deck', setKey, baseNumber: 100 + i, count: 1 }),
  );
}

/** A main deck of `size` cards using 3-ofs, the Premier default. */
function playsetDeck(size: number, setKey = 'SOR'): ResolvedDeckRow[] {
  return Array.from({ length: size / 3 }, (_, i) =>
    row({ role: 'deck', setKey, baseNumber: 100 + i, count: 3 }),
  );
}

const premierDeck: ResolvedDeckRow[] = [
  row({ role: 'leader', setKey: 'SOR', baseNumber: 1, count: 1 }),
  row({ role: 'base', setKey: 'SOR', baseNumber: 2, count: 1 }),
  ...playsetDeck(51),
];

const twinSunsDeck: ResolvedDeckRow[] = [
  row({ role: 'leader', setKey: 'TS26', baseNumber: 1, count: 1 }),
  row({ role: 'leader', setKey: 'TS26', baseNumber: 2, count: 1 }),
  row({ role: 'base', setKey: 'TS26', baseNumber: 3, count: 1 }),
  ...singletonDeck(80),
];

function codes(rows: ResolvedDeckRow[], choice?: 'auto' | 'premier' | 'twinSuns') {
  return checkDeckLegality(rows, choice).issues.map(i => i.code);
}

describe('detectPlayFormat', () => {
  it('reads a single leader as Premier', () => {
    expect(detectPlayFormat(premierDeck)).toBe('premier');
  });

  it('reads two leaders as Twin Suns', () => {
    expect(detectPlayFormat(twinSunsDeck)).toBe('twinSuns');
  });

  it('reads a leaderless list as Premier rather than guessing from deck size', () => {
    expect(detectPlayFormat(singletonDeck(80))).toBe('premier');
  });
});

describe('deckStats', () => {
  it('counts copies for deck size but distinct rows for title count', () => {
    expect(deckStats(premierDeck)).toEqual({
      leaderCount: 1,
      baseCount: 1,
      mainDeckSize: 51,
      sideboardSize: 0,
      distinctMainDeckCards: 17,
    });
  });

  it('counts sideboard cards separately from the main deck', () => {
    const rows = [...premierDeck, row({ role: 'sideboard', setKey: 'SOR', baseNumber: 900, count: 2 })];
    expect(deckStats(rows).sideboardSize).toBe(2);
    expect(deckStats(rows).mainDeckSize).toBe(51);
  });
});

describe('checkDeckLegality — Premier', () => {
  it('passes a 1-leader, 1-base, 51-card deck', () => {
    const result = checkDeckLegality(premierDeck);
    expect(result.format).toBe('premier');
    expect(result.autoDetected).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.legal).toBe(true);
  });

  it('flags a deck under 50 cards', () => {
    const rows = [premierDeck[0], premierDeck[1], ...playsetDeck(48)];
    expect(codes(rows)).toEqual(['deck-size']);
  });

  it('flags a 4th copy of a card', () => {
    const rows = [...premierDeck, row({ role: 'deck', setKey: 'SOR', baseNumber: 100, count: 1 })];
    expect(codes(rows)).toContain('copy-limit');
  });

  it('allows a card whose own text raises its limit', () => {
    const rows = [
      premierDeck[0],
      premierDeck[1],
      ...playsetDeck(36),
      row({ role: 'deck', setKey: 'SOR', baseNumber: 500, count: 15, maxCopies: 15 }),
    ];
    expect(codes(rows)).toEqual([]);
  });

  it('warns, but stays legal, when the sideboard is over 10 cards', () => {
    const sideboard = Array.from({ length: 11 }, (_, i) =>
      row({ role: 'sideboard', setKey: 'SOR', baseNumber: 900 + i, count: 1 }),
    );
    const result = checkDeckLegality([...premierDeck, ...sideboard]);
    expect(result.issues.map(i => i.severity)).toEqual(['warning']);
    expect(result.legal).toBe(true);
  });
});

describe('checkDeckLegality — Twin Suns', () => {
  it('passes a 2-leader, 1-base, 80-card singleton deck', () => {
    const result = checkDeckLegality(twinSunsDeck);
    expect(result.format).toBe('twinSuns');
    expect(result.issues).toEqual([]);
    expect(result.legal).toBe(true);
  });

  it('flags a deck under 80 cards', () => {
    const rows = [twinSunsDeck[0], twinSunsDeck[1], twinSunsDeck[2], ...singletonDeck(60)];
    expect(codes(rows)).toEqual(['deck-size']);
  });

  it('flags a repeated card, since Twin Suns is singleton', () => {
    const rows = [
      twinSunsDeck[0],
      twinSunsDeck[1],
      twinSunsDeck[2],
      ...singletonDeck(78),
      row({ role: 'deck', setKey: 'TS26', baseNumber: 500, count: 2 }),
    ];
    const result = checkDeckLegality(rows);
    expect(result.issues.map(i => i.code)).toEqual(['copy-limit']);
    expect(result.issues[0].message).toContain('only 1 copy');
  });

  it('counts main deck and sideboard together against the copy limit', () => {
    const rows = [
      twinSunsDeck[0],
      twinSunsDeck[1],
      twinSunsDeck[2],
      ...singletonDeck(80),
      row({ role: 'sideboard', setKey: 'TS26', baseNumber: 100, count: 1 }),
    ];
    expect(codes(rows)).toEqual(['copy-limit']);
  });

  it('treats the same card from two sets as one card', () => {
    const rows = [
      twinSunsDeck[0],
      twinSunsDeck[1],
      twinSunsDeck[2],
      ...singletonDeck(79),
      row({ role: 'deck', setKey: 'SOR', baseNumber: 700, name: 'Vanquish', count: 1 }),
      row({ role: 'deck', setKey: 'TS26', baseNumber: 701, name: 'Vanquish', count: 1 }),
    ];
    expect(codes(rows)).toEqual(['copy-limit']);
  });

  it('keeps a subtitle-distinguished card separate from its namesake', () => {
    const rows = [
      twinSunsDeck[0],
      twinSunsDeck[1],
      twinSunsDeck[2],
      ...singletonDeck(78),
      row({ role: 'deck', setKey: 'TS26', baseNumber: 700, name: 'Luke Skywalker', subtitle: 'Faithful Friend', count: 1 }),
      row({ role: 'deck', setKey: 'TS26', baseNumber: 701, name: 'Luke Skywalker', subtitle: 'Jedi Knight', count: 1 }),
    ];
    expect(codes(rows)).toEqual([]);
  });

  it('flags a third leader', () => {
    const rows = [...twinSunsDeck, row({ role: 'leader', setKey: 'TS26', baseNumber: 4, count: 1 })];
    expect(codes(rows)).toContain('leader-count');
  });

  it('flags the same leader listed twice rather than two different ones', () => {
    const rows = [
      row({ role: 'leader', setKey: 'TS26', baseNumber: 1, count: 2 }),
      twinSunsDeck[2],
      ...singletonDeck(80),
    ];
    expect(codes(rows)).toEqual(['leader-copies']);
  });

  it('flags a second base', () => {
    const rows = [...twinSunsDeck, row({ role: 'base', setKey: 'TS26', baseNumber: 4, count: 1 })];
    expect(codes(rows)).toContain('base-count');
  });
});

describe('checkDeckLegality — explicit format choice', () => {
  it('judges a Premier-shaped deck against Twin Suns rules when asked', () => {
    const result = checkDeckLegality(premierDeck, 'twinSuns');
    expect(result.autoDetected).toBe(false);
    expect(result.issues.map(i => i.code)).toContain('leader-count');
    expect(result.issues.map(i => i.code)).toContain('deck-size');
    expect(result.issues.map(i => i.code)).toContain('copy-limit');
  });

  it('judges a Twin Suns deck against Premier rules when asked', () => {
    const result = checkDeckLegality(twinSunsDeck, 'premier');
    expect(result.issues.map(i => i.code)).toEqual(['leader-count']);
  });
});
