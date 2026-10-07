import type { DeckCardRef, DeckContents } from './deckContents';
import type { PlayFormat } from './deckLegality';
import type { SetKey } from './types';

/**
 * Edits to a deck's list, as pure functions over its contents — what the deck editor's
 * draft is made of. Nothing here touches a deck's box: that happens once, when the draft
 * is saved (`applyDeckEdit` in deckBuild.ts).
 */

export type DeckZone = 'main' | 'side';

type CardId = { setKey: SetKey; baseNumber: number };

const ZONE_FIELD = { main: 'mainDeck', side: 'sideboard' } as const;

const same = (ref: CardId, card: CardId) =>
  ref.setKey === card.setKey && ref.baseNumber === card.baseNumber;

/** A list ref, without the printings a built deck's box records. */
const listRef = (card: CardId, count: number): DeckCardRef => ({
  setKey: card.setKey,
  baseNumber: card.baseNumber,
  count,
});

export function zoneCount(contents: DeckContents, zone: DeckZone, card: CardId): number {
  return contents[ZONE_FIELD[zone]].find((ref) => same(ref, card))?.count ?? 0;
}

/** Sets how many copies a zone lists. A new card goes at the end; 0 removes it. */
export function setZoneCount(
  contents: DeckContents,
  zone: DeckZone,
  card: CardId,
  count: number,
): DeckContents {
  const field = ZONE_FIELD[zone];
  const list = contents[field];
  const n = Math.max(0, Math.floor(count));
  const at = list.findIndex((ref) => same(ref, card));
  let next: DeckCardRef[];
  if (at < 0) next = n > 0 ? [...list, listRef(card, n)] : list;
  else if (n === 0) next = list.filter((_, i) => i !== at);
  else next = list.map((ref, i) => (i === at ? listRef(card, n) : ref));
  return next === list ? contents : { ...contents, [field]: next };
}

export function addToZone(
  contents: DeckContents,
  zone: DeckZone,
  card: CardId,
  delta: number,
): DeckContents {
  return setZoneCount(contents, zone, card, zoneCount(contents, zone, card) + delta);
}

/** Moves up to `count` copies from one zone to the other. */
export function moveCard(
  contents: DeckContents,
  from: DeckZone,
  card: CardId,
  count = 1,
): DeckContents {
  const to: DeckZone = from === 'main' ? 'side' : 'main';
  const n = Math.min(count, zoneCount(contents, from, card));
  if (n <= 0) return contents;
  return addToZone(addToZone(contents, from, card, -n), to, card, n);
}

/** Replaces a leader: slot 0 is the leader, slot 1 a Twin Suns deck's second. */
export function setLeader(contents: DeckContents, slot: 0 | 1, card: CardId | null): DeckContents {
  if (slot === 0) return card ? { ...contents, leader: listRef(card, 1) } : contents;
  if (!card) {
    const { secondLeader: _dropped, ...rest } = contents;
    return rest;
  }
  return { ...contents, secondLeader: listRef(card, 1) };
}

export function setBase(contents: DeckContents, card: CardId): DeckContents {
  return { ...contents, base: listRef(card, 1) };
}

/** Premier and Eternal play one leader, so switching to either drops the second. */
export function withFormat(contents: DeckContents, format: PlayFormat): DeckContents {
  return format === 'twinSuns' ? contents : setLeader(contents, 1, null);
}

/** The list alone — leaders, base, main deck and sideboard — free of any box records. */
export function listOf(contents: DeckContents): DeckContents {
  const strip = (ref: DeckCardRef) => listRef(ref, ref.count);
  return {
    leader: strip(contents.leader),
    ...(contents.secondLeader && { secondLeader: strip(contents.secondLeader) }),
    base: strip(contents.base),
    mainDeck: contents.mainDeck.map(strip),
    sideboard: contents.sideboard.map(strip),
  };
}

/** True when two lists hold the same cards in the same places (order aside). */
export function sameList(a: DeckContents, b: DeckContents): boolean {
  const key = (c: DeckContents) =>
    JSON.stringify([
      [c.leader, c.secondLeader].map((r) => (r ? `${r.setKey}:${r.baseNumber}` : '')),
      `${c.base.setKey}:${c.base.baseNumber}`,
      c.mainDeck.map((r) => `${r.setKey}:${r.baseNumber}x${r.count}`).sort(),
      c.sideboard.map((r) => `${r.setKey}:${r.baseNumber}x${r.count}`).sort(),
    ]);
  return key(a) === key(b);
}
