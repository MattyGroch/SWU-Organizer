import { isLegalIn, type CardPool, type PlayFormat } from '~/domain/deckLegality';
import type { Card, SetKey } from '~/domain/types';

import type { OwnedLookup } from './deckRows';

/** What the search panel is choosing: cards for the deck, or a leader or base. */
export type SearchMode = 'cards' | 'leader' | 'base';

export const DECK_TYPES = ['Unit', 'Event', 'Upgrade'] as const;
export type DeckCardType = (typeof DECK_TYPES)[number];

/** Cost chips run 0–6, then 7 for "7 or more". */
export const COST_CHIPS = [0, 1, 2, 3, 4, 5, 6, 7] as const;

export type SearchFilters = {
  text: string;
  /** Only cards you own a copy of — binder, bulk box or another built deck; never precons. */
  ownedOnly: boolean;
  /** Only cards the deck's leaders and base pay for without an aspect penalty. */
  inAspect: boolean;
  types: DeckCardType[];
  costs: number[];
};

export const DEFAULT_FILTERS: SearchFilters = {
  text: '',
  ownedOnly: true,
  inAspect: true,
  types: [],
  costs: [],
};

export type SearchHit = { setKey: SetKey; card: Card; owned: number };

export type SearchInput = {
  sets: ReadonlyArray<{ setKey: SetKey; baseCards: Card[] }>;
  mode: SearchMode;
  filters: SearchFilters;
  format: PlayFormat;
  pool: CardPool;
  /** The aspects the deck pays for — its leaders' and base's, duplicates kept. */
  deckAspects: readonly string[];
  owned: OwnedLookup;
};

const MODE_TYPE: Record<Exclude<SearchMode, 'cards'>, string> = { leader: 'Leader', base: 'Base' };

/**
 * Does the deck pay for every aspect icon on the card? Each icon needs one of its own on
 * the leaders or base, so a double-Vigilance card needs two Vigilance icons there.
 * Neutral cards always fit.
 */
export function fitsAspects(card: readonly string[] | undefined, deck: readonly string[]): boolean {
  const have = new Map<string, number>();
  for (const aspect of deck) have.set(aspect, (have.get(aspect) ?? 0) + 1);
  for (const aspect of card ?? []) {
    const left = have.get(aspect) ?? 0;
    if (left <= 0) return false;
    have.set(aspect, left - 1);
  }
  return true;
}

function matchesText(card: Card, words: string[]): boolean {
  if (!words.length) return true;
  const haystack = [card.Name, card.Subtitle, ...(card.Traits ?? []), card.Text]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/**
 * Cards the deck can use, filtered and sorted by cost, then name. Leader and base modes
 * list only those, and skip the aspect filter: they set the aspects. Cards that are not
 * legal in the format are always left out. `sets` go oldest first, as the manifest lists them.
 */
export function searchCards({
  sets,
  mode,
  filters,
  format,
  pool,
  deckAspects,
  owned,
}: SearchInput): SearchHit[] {
  const words = filters.text.toLowerCase().split(/\s+/).filter(Boolean);
  const types = new Set<string>(filters.types);
  const costs = new Set(filters.costs);
  const hits: Array<SearchHit & { order: number }> = [];

  for (const [order, { setKey, baseCards }] of sets.entries()) {
    for (const card of baseCards) {
      const type = card.Type ?? '';
      if (mode === 'cards') {
        if (type === 'Leader' || type === 'Base') continue;
        if (types.size && !types.has(type)) continue;
        if (costs.size && !costs.has(Math.min(card.Cost ?? 0, 7))) continue;
        if (filters.inAspect && !fitsAspects(card.Aspects, deckAspects)) continue;
      } else if (type !== MODE_TYPE[mode]) continue;

      if (!matchesText(card, words)) continue;
      if (!isLegalIn(format, { name: card.Name, subtitle: card.Subtitle, setKey }, pool)) continue;
      const have = owned(setKey, card.Number);
      if (filters.ownedOnly && have <= 0) continue;
      hits.push({ setKey, card, owned: have, order });
    }
  }

  // A reprint lists its newest printing first.
  return hits
    .sort(
      (a, b) =>
        (mode === 'cards' ? (a.card.Cost ?? 0) - (b.card.Cost ?? 0) : 0) ||
        a.card.Name.localeCompare(b.card.Name) ||
        (a.card.Subtitle ?? '').localeCompare(b.card.Subtitle ?? '') ||
        b.order - a.order,
    )
    .map(({ order: _order, ...hit }) => hit);
}
