import type { VariantSlug } from './catalog';
import { deckHoldings, inPlace, parseCardKey, type CardKey, type HomeLookup } from './deckBuild';
import type { DeckLibrary, SavedDeck } from './decks';
import { DECK_PULL_ORDER, VALUE_ORDER, addVariants, type VariantCounts } from './ownership';
import type { SetKey } from './types';

/**
 * Binder copies that would make a built deck look better.
 *
 * Scanning never touches a built deck: a new copy goes to its binder pocket. When that copy
 * is a better printing than one a deck holds, the deck could swap it in. This only *finds*
 * those swaps; it changes nothing.
 *
 * Any better printing counts (`VALUE_ORDER`), and only copies sitting in a binder pocket are
 * offered — never one held by another deck, one in the bulk box, or a Prestige Serialized,
 * which never goes into a deck.
 *
 * Each binder copy is offered to one deck only, so the counts across decks never add up to
 * more copies than the binder holds. The biggest jump goes first, and the deck listed
 * first in the library wins a tie.
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

/** Every printing in `counts`, one entry per copy, in `order`. */
function copies(counts: VariantCounts, order: readonly VariantSlug[]): VariantSlug[] {
  return order.flatMap((variant) => Array<VariantSlug>(counts[variant] ?? 0).fill(variant));
}

/**
 * The swaps every built deck could make from the binder, by deck id: most valuable printing
 * first. Decks with none are absent.
 */
export function libraryUpgrades(
  library: DeckLibrary,
  homes: HomeLookup,
): Map<string, DeckUpgrade[]> {
  const pocketOf = inPlace(homes, library);
  const holdings = deckHoldings(library);
  const keys = new Set<CardKey>();
  for (const held of holdings.values()) for (const key of held.keys()) keys.add(key);

  const found = new Map<string, Map<string, DeckUpgrade>>();
  for (const key of keys) {
    const { setKey, baseNumber } = parseCardKey(key);
    // Best binder copy first: it takes the deck copy it improves on most.
    const pocket = copies(pocketOf(setKey, baseNumber).binder, DECK_PULL_ORDER);
    if (!pocket.length) continue;

    const inDecks: Array<{ deckId: string; variant: VariantSlug }> = [];
    for (const deck of library.customDecks) {
      const held = holdings.get(deck.id)?.get(key);
      if (!held) continue;
      for (const variant of copies(addVariants(held.binder, held.bulk), VALUE_ORDER)) {
        inDecks.push({ deckId: deck.id, variant });
      }
    }

    for (const to of pocket) {
      // The weakest deck copy gains most; a tie goes to the earlier deck.
      let target = -1;
      inDecks.forEach((copy, i) => {
        if (rank(copy.variant) <= rank(to)) return;
        if (target < 0 || rank(copy.variant) > rank(inDecks[target]!.variant)) target = i;
      });
      // Nothing left is worse than the best binder copy, so nothing is worse than the rest.
      if (target < 0) break;
      const { deckId, variant: from } = inDecks.splice(target, 1)[0]!;
      const swaps = found.get(deckId) ?? new Map<string, DeckUpgrade>();
      const id = `${key}:${from}>${to}`;
      const swap = swaps.get(id) ?? { setKey, baseNumber, from, to, count: 0 };
      swap.count++;
      swaps.set(id, swap);
      found.set(deckId, swaps);
    }
  }

  const result = new Map<string, DeckUpgrade[]>();
  for (const [deckId, swaps] of found) {
    result.set(
      deckId,
      [...swaps.values()].sort(
        (a, b) =>
          rank(a.to) - rank(b.to) ||
          a.setKey.localeCompare(b.setKey) ||
          a.baseNumber - b.baseNumber ||
          rank(b.from) - rank(a.from),
      ),
    );
  }
  return result;
}

/** The swaps one built deck could make; empty for a deck that is not built. */
export function deckUpgrades(
  deck: SavedDeck,
  library: DeckLibrary,
  homes: HomeLookup,
): DeckUpgrade[] {
  return libraryUpgrades(library, homes).get(deck.id) ?? [];
}

/** How many copies in all the deck could swap. */
export function upgradeCount(upgrades: readonly DeckUpgrade[]): number {
  return upgrades.reduce((sum, u) => sum + u.count, 0);
}
