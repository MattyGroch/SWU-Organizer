import type { DeckCardRef, DeckContents } from './deckContents';

/**
 * The deck JSON that swudb.com exports, which Karabast and swudb.com both import.
 *
 * Karabast is the strict one: it rejects unknown keys, ids that aren't `SET_###`, a
 * missing name or an empty deck, and anything over 5000 characters.
 */
export type SwudbDeckJson = {
  metadata: { name: string };
  leader: SwudbCard;
  secondleader?: SwudbCard;
  base: SwudbCard;
  deck: SwudbCard[];
  sideboard: SwudbCard[];
};

type SwudbCard = { id: string; count: number };

/** `SOR_010`: the set code, then the card's number in that set, padded to three digits. */
export function swudbCardId(setKey: string, baseNumber: number): string {
  return `${setKey.toUpperCase()}_${String(baseNumber).padStart(3, '0')}`;
}

function toCard(ref: DeckCardRef): SwudbCard {
  return { id: swudbCardId(ref.setKey, ref.baseNumber), count: ref.count };
}

/** Merges a card listed twice in one zone, so the other site doesn't see two rows. */
function zone(refs: readonly DeckCardRef[]): SwudbCard[] {
  const byId = new Map<string, SwudbCard>();
  for (const ref of refs) {
    if (ref.count <= 0) continue;
    const card = toCard(ref);
    const existing = byId.get(card.id);
    if (existing) existing.count += card.count;
    else byId.set(card.id, card);
  }
  return [...byId.values()];
}

/**
 * Karabast strips every character other than ASCII letters, digits, spaces and
 * `{}[]:"',.-_` from the paste before parsing it. A name with a quote escaped as `\"`
 * would lose its backslash and break the JSON, so keep the name to what survives.
 */
function safeName(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9 ',.\-_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'Deck';
}

export function deckToSwudbJson(deck: DeckContents & { name: string }): SwudbDeckJson {
  return {
    metadata: { name: safeName(deck.name) },
    leader: toCard(deck.leader),
    ...(deck.secondLeader && { secondleader: toCard(deck.secondLeader) }),
    base: toCard(deck.base),
    deck: zone(deck.mainDeck),
    sideboard: zone(deck.sideboard),
  };
}

/** One line, so it fits Karabast's size limit and pastes cleanly into a text box. */
export function formatSwudbJson(deck: DeckContents & { name: string }): string {
  return JSON.stringify(deckToSwudbJson(deck));
}
