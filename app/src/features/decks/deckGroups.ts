import type { DeckStatus } from '~/domain/deckBuild';
import type { SavedDeck } from '~/domain/decks';

/** The sections of the Decks view, in display order. */
export type DeckGroupKey = 'attention' | 'built' | 'ready' | 'planned';

export const DECK_GROUPS: { key: DeckGroupKey; title: string; hint: string }[] = [
  { key: 'built', title: 'Built', hint: 'Complete, with every card in its box.' },
  { key: 'attention', title: 'Needs attention', hint: 'Built, but some cards are missing.' },
  { key: 'ready', title: 'Ready to build', hint: 'Not built yet; you own every card.' },
  { key: 'planned', title: 'Planned', hint: 'Not built yet; some cards still to buy.' },
];

export function groupOf(status: DeckStatus, needed: number): DeckGroupKey {
  if (status.state === 'partial') return 'attention';
  if (status.state === 'complete') return 'built';
  return needed > 0 ? 'planned' : 'ready';
}

/**
 * Splits your own decks (precons excluded) into the status sections, keeping the
 * library's order inside each one. Derived at render time; nothing is stored.
 */
export function groupDecks(
  decks: SavedDeck[],
  statusOf: (deck: SavedDeck) => DeckStatus,
  neededOf: (deck: SavedDeck) => number,
): Record<DeckGroupKey, SavedDeck[]> {
  const groups: Record<DeckGroupKey, SavedDeck[]> = {
    attention: [],
    built: [],
    ready: [],
    planned: [],
  };
  for (const deck of decks) {
    if (deck.precon) continue;
    groups[groupOf(statusOf(deck), neededOf(deck))].push(deck);
  }
  return groups;
}
