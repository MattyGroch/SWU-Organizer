import type { VariantSlug } from './catalog';
import { deckHoldings, inPlace, parseCardKey, type HomeLookup } from './deckBuild';
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
 * Every deck that could use a binder copy is flagged, so you choose which deck gets it. A
 * swap done for one deck takes the copy out of the pocket, and the other flags clear on
 * their own. Each swap notes the other decks it is shared with (`alsoFor`).
 */

export type DeckUpgrade = {
  setKey: SetKey;
  baseNumber: number;
  /** The printing the deck holds now. */
  from: VariantSlug;
  /** The better printing waiting in the binder. */
  to: VariantSlug;
  count: number;
  /** Other built decks that could take the same printing. Absent when none could. */
  alsoFor?: string[];
};

const rank = (variant: VariantSlug) => VALUE_ORDER.indexOf(variant);

/** Every printing in `counts`, one entry per copy, in `order`. */
function copies(counts: VariantCounts, order: readonly VariantSlug[]): VariantSlug[] {
  return order.flatMap((variant) => Array<VariantSlug>(counts[variant] ?? 0).fill(variant));
}

const byValue = (a: DeckUpgrade, b: DeckUpgrade) =>
  rank(a.to) - rank(b.to) ||
  a.setKey.localeCompare(b.setKey) ||
  a.baseNumber - b.baseNumber ||
  rank(b.from) - rank(a.from);

/**
 * The swaps every built deck could make from the binder, by deck id: most valuable printing
 * first. Decks with none are absent. Each deck is judged against the whole pocket, so one
 * copy can be listed for several decks.
 */
export function libraryUpgrades(
  library: DeckLibrary,
  homes: HomeLookup,
): Map<string, DeckUpgrade[]> {
  const pocketOf = inPlace(homes, library);
  const holdings = deckHoldings(library);

  const byDeck = new Map<string, DeckUpgrade[]>();
  for (const deck of library.customDecks) {
    const held = holdings.get(deck.id);
    if (!held) continue;
    const found: DeckUpgrade[] = [];
    for (const [key, inDeck] of held) {
      const { setKey, baseNumber } = parseCardKey(key);
      // Best binder copy against the deck's weakest, while the binder copy is better.
      const pocket = copies(pocketOf(setKey, baseNumber).binder, DECK_PULL_ORDER);
      const weakest = copies(addVariants(inDeck.binder, inDeck.bulk), [...VALUE_ORDER].reverse());
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
      found.push(...swaps.values());
    }
    if (found.length) byDeck.set(deck.id, found.sort(byValue));
  }

  // Note which swaps compete for the same binder copy.
  const names = new Map(library.customDecks.map((d) => [d.id, d.name]));
  for (const [deckId, list] of byDeck) {
    for (const swap of list) {
      const others = [...byDeck]
        .filter(
          ([id, l]) =>
            id !== deckId &&
            l.some(
              (o) =>
                o.setKey === swap.setKey && o.baseNumber === swap.baseNumber && o.to === swap.to,
            ),
        )
        .map(([id]) => names.get(id) ?? '')
        .filter(Boolean);
      if (others.length) swap.alsoFor = others;
    }
  }
  return byDeck;
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
