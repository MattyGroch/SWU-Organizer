import { describe, expect, it } from 'vitest';

import type { DeckContents } from './deckContents';
import {
  addToZone,
  listOf,
  moveCard,
  sameList,
  setLeader,
  setZoneCount,
  withFormat,
  zoneCount,
} from './deckEdit';

const ref = (baseNumber: number, count = 1) => ({ setKey: 'LAW', baseNumber, count });
const card = (baseNumber: number) => ({ setKey: 'LAW', baseNumber });

const deck: DeckContents = {
  leader: ref(1),
  base: ref(20),
  mainDeck: [ref(30, 3), ref(31, 2)],
  sideboard: [ref(40, 1)],
};

describe('deck edits', () => {
  it('sets, adds and removes copies in a zone', () => {
    expect(setZoneCount(deck, 'main', card(31), 3).mainDeck).toEqual([ref(30, 3), ref(31, 3)]);
    expect(setZoneCount(deck, 'main', card(31), 0).mainDeck).toEqual([ref(30, 3)]);
    expect(addToZone(deck, 'side', card(50), 2).sideboard).toEqual([ref(40), ref(50, 2)]);
    expect(setZoneCount(deck, 'side', card(99), 0)).toBe(deck);
  });

  it('moves copies between main deck and sideboard', () => {
    const moved = moveCard(deck, 'main', card(30));
    expect(zoneCount(moved, 'main', card(30))).toBe(2);
    expect(zoneCount(moved, 'side', card(30))).toBe(1);
    const back = moveCard(moved, 'side', card(30), 5);
    expect(back.mainDeck).toEqual([ref(30, 3), ref(31, 2)]);
    expect(sameList(back, deck)).toBe(true);
    expect(moveCard(deck, 'side', card(30))).toBe(deck);
  });

  it('switching to a one-leader format drops the second leader', () => {
    const twin = setLeader(deck, 1, card(2));
    expect(twin.secondLeader).toEqual(ref(2));
    expect(withFormat(twin, 'twinSuns')).toBe(twin);
    expect(withFormat(twin, 'premier')).not.toHaveProperty('secondLeader');
  });

  it('listOf drops the box records', () => {
    const built = { ...deck, mainDeck: [{ ...ref(30, 3), variants: { normal: 3 } }] };
    expect(listOf(built).mainDeck).toEqual([ref(30, 3)]);
  });
});
