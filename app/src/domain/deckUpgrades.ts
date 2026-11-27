import type { VariantSlug } from './catalog';
import { deckHoldings, inPlace, parseCardKey, type HomeLookup } from './deckBuild';
import type { DeckLibrary, SavedDeck } from './decks';
import { DECK_PULL_ORDER, VALUE_ORDER, addVariants, type VariantCounts } from './ownership';
import type { SetKey } from './types';

/**
 * Binder copies that would make a built deck look better.
 *
 * Scanning never touches a built deck: a new copy goes to its binder pocket. When that copy
 * is a better printing than one the deck holds, the deck could swap it in. This only
 * *finds* those swaps; it changes nothing.
 *
 * Any better printing counts (`VALUE_ORDER`), and only copies sitting in a binder pocket are
 * offered — never one held by another deck, one in the bulk box, or a Prestige Serialized,
 * which never goes into a deck.
 */

export type DeckUpgrade = {
  setKey: SetKey;
  baseNumber: number;
  /** The printing the deck holds now. */
  from: VariantSlug;
  /** The better printing waiting in the binder. */
  to: VariantSlug;
  count: number;
};

const rank = (variant: VariantSlug) => VALUE_ORDER.indexOf(variant);

/** Every printing in `counts`, one entry per copy, best first. */
function copies(counts: VariantCounts, order: readonly VariantSlug[]): VariantSlug[] {
  return order.flatMap((variant) => Array<VariantSlug>(counts[variant] ?? 0).fill(variant));
}

/**
 * The swaps one built deck could make from the binder, most valuable card first. Empty for a
 * deck that is not built. `holdings` is the deck's own pulled copies, by card.
 */
export function deckUpgrades(
  deck: SavedDeck,
  library: DeckLibrary,
  homes: HomeLookup,
): DeckUpgrade[] {
  if (!deck.constructed) return [];
  const holdings = deckHoldings(library).get(deck.id);
  if (!holdings) return [];
  const pocketOf = inPlace(homes, library);

  const upgrades: DeckUpgrade[] = [];
  for (const [key, held] of holdings) {
    const { setKey, baseNumber } = parseCardKey(key);
    // Best binder copy against the deck's weakest, while the binder copy is better.
    const pocket = copies(pocketOf(setKey, baseNumber).binder, DECK_PULL_ORDER);
    const weakest = copies(addVariants(held.binder, held.bulk), [...VALUE_ORDER].reverse());
    const swaps = new Map<string, DeckUpgrade>();
    for (let i = 0; i < pocket.length && i < weakest.length; i++) {
      const to = pocket[i]!;
      const from = weakest[i]!;
      if (rank(to) >= rank(from)) break;
      const id = `${from}>${to}`;
      const swap = swaps.get(id) ?? { setKey, baseNumber, from, to, count: 0 };
      swap.count++;
      swaps.set(id, swap);
    }
    upgrades.push(...swaps.values());
  }
  return upgrades.sort(
    (a, b) =>
      rank(a.to) - rank(b.to) ||
      a.setKey.localeCompare(b.setKey) ||
      a.baseNumber - b.baseNumber ||
      rank(b.from) - rank(a.from),
  );
}

/** How many copies in all the deck could swap. */
export function upgradeCount(upgrades: readonly DeckUpgrade[]): number {
  return upgrades.reduce((sum, u) => sum + u.count, 0);
}
