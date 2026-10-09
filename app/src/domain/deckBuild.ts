import type { VariantSlug } from './catalog';
import type { DeckCardRef, DeckContents } from './deckContents';
import type { PlayFormat } from './deckLegality';
import type { DeckLibrary, SavedDeck } from './decks';
import {
  DECK_PULL_ORDER,
  NO_HOMES,
  addHomes,
  addVariants,
  pullableCount,
  subtractHomes,
  subtractVariants,
  sumVariants,
  takeVariants,
  type Homes,
  type VariantCounts,
} from './ownership';
import type { SetKey } from './types';

/**
 * Where your physical cards are, across the binder, the bulk box and built decks.
 *
 * Every copy you own has a home — its binder pocket or the bulk box — and sits there
 * unless it has been pulled into a built deck (`SavedDeck.pulledCards`, what is in that
 * deck's box). Each pulled record notes which printings it holds and which of them came
 * from the bulk box, so deconstructing sends each copy back where it came from, and moving
 * a card from one deck to another carries both along.
 *
 * Decks take from the binder first, most valuable printing first and never a Prestige
 * Serialized, then from the bulk box the same way.
 *
 * A built deck is *complete* when its box holds its leader, base and main deck — the
 * sideboard never counts toward complete. Precons are not part of this: their cards are
 * owned but never pulled.
 */

export type CardKey = string;
export type OwnedLookup = (setKey: SetKey, baseNumber: number) => number;
/** A card's copies per home and printing. */
export type HomeLookup = (setKey: SetKey, baseNumber: number) => Homes;
/** Copies a deck could take, from each place. */
export type Available = { binder: number; bulk: number };

export const cardKey = (setKey: SetKey, baseNumber: number): CardKey => `${setKey}:${baseNumber}`;

export function parseCardKey(key: CardKey): { setKey: SetKey; baseNumber: number } {
  const at = key.lastIndexOf(':');
  return { setKey: key.slice(0, at), baseNumber: Number(key.slice(at + 1)) };
}

/** Least valuable first — the order copies go back when a single one leaves a deck box. */
const RETURN_ORDER: readonly VariantSlug[] = [...DECK_PULL_ORDER].reverse();

function add(map: Map<CardKey, number>, key: CardKey, count: number) {
  if (count) map.set(key, (map.get(key) ?? 0) + count);
}

function refsToMap(refs: readonly DeckCardRef[]): Map<CardKey, number> {
  const map = new Map<CardKey, number>();
  for (const ref of refs) add(map, cardKey(ref.setKey, ref.baseNumber), ref.count);
  return map;
}

/** What a deck needs in its box: leader(s), base and main deck — plus sideboard if asked. */
export function requiredCounts(
  contents: DeckContents,
  includeSideboard = false,
): Map<CardKey, number> {
  const refs = [contents.leader, contents.base, ...contents.mainDeck];
  if (contents.secondLeader) refs.push(contents.secondLeader);
  if (includeSideboard) refs.push(...contents.sideboard);
  return refsToMap(refs);
}

/** Copies currently in a deck's box. Empty for a deck that is not built. */
export function inBoxCounts(deck: SavedDeck): Map<CardKey, number> {
  return deck.constructed ? refsToMap(deck.pulledCards) : new Map();
}

/** Copies pulled into built decks, optionally ignoring one deck. */
export function pulledTotals(library: DeckLibrary, excludeId?: string): Map<CardKey, number> {
  const totals = new Map<CardKey, number>();
  for (const deck of library.customDecks) {
    if (deck.id === excludeId || !deck.constructed) continue;
    for (const ref of deck.pulledCards) add(totals, cardKey(ref.setKey, ref.baseNumber), ref.count);
  }
  return totals;
}

/** The copies one pulled record holds, by the home each returns to. */
function refHomes(ref: DeckCardRef): Homes {
  const variants = ref.variants ?? { normal: ref.count };
  const bulk = ref.fromBulk ?? {};
  return { binder: subtractVariants(variants, bulk), bulk };
}

/** The printings each built deck holds, per card, by the home each returns to. */
export function deckHoldings(library: DeckLibrary): Map<string, Map<CardKey, Homes>> {
  const byDeck = new Map<string, Map<CardKey, Homes>>();
  for (const deck of library.customDecks) {
    if (!deck.constructed) continue;
    const holdings = new Map<CardKey, Homes>();
    for (const ref of deck.pulledCards) {
      const key = cardKey(ref.setKey, ref.baseNumber);
      holdings.set(key, addHomes(holdings.get(key) ?? NO_HOMES, refHomes(ref)));
    }
    byDeck.set(deck.id, holdings);
  }
  return byDeck;
}

/** Everything out in built decks, per card, by the home each copy returns to. */
export function heldByHome(library: DeckLibrary): Map<CardKey, Homes> {
  const held = new Map<CardKey, Homes>();
  for (const holdings of deckHoldings(library).values()) {
    for (const [key, homes] of holdings) held.set(key, addHomes(held.get(key) ?? NO_HOMES, homes));
  }
  return held;
}

/** What built decks hold of one set's cards, by base number and home. */
export function heldInSet(library: DeckLibrary, setKey: SetKey): Map<number, Homes> {
  const held = new Map<number, Homes>();
  for (const [key, homes] of heldByHome(library)) {
    const card = parseCardKey(key);
    if (card.setKey === setKey) held.set(card.baseNumber, homes);
  }
  return held;
}

/** One built deck's copies of a card, by the home they return to. */
export type DeckHold = { deckId: string; name: string; binder: number; bulk: number };

/** Which built decks hold each of one set's cards, by base number, most copies first. */
export function decksHoldingInSet(library: DeckLibrary, setKey: SetKey): Map<number, DeckHold[]> {
  const names = new Map(library.customDecks.map((deck) => [deck.id, deck.name]));
  const byCard = new Map<number, DeckHold[]>();
  for (const [deckId, holdings] of deckHoldings(library)) {
    for (const [key, homes] of holdings) {
      const card = parseCardKey(key);
      if (card.setKey !== setKey) continue;
      const hold: DeckHold = {
        deckId,
        name: names.get(deckId) ?? '',
        binder: sumVariants(homes.binder),
        bulk: sumVariants(homes.bulk),
      };
      if (hold.binder + hold.bulk === 0) continue;
      byCard.set(card.baseNumber, [...(byCard.get(card.baseNumber) ?? []), hold]);
    }
  }
  for (const holds of byCard.values())
    holds.sort((a, b) => b.binder + b.bulk - (a.binder + a.bulk) || a.name.localeCompare(b.name));
  return byCard;
}

/** Every printing out in built decks, per card, wherever it came from. */
export function heldVariants(library: DeckLibrary): Map<CardKey, VariantCounts> {
  const held = new Map<CardKey, VariantCounts>();
  for (const [key, homes] of heldByHome(library))
    held.set(key, addVariants(homes.binder, homes.bulk));
  return held;
}

/** What is physically in each binder pocket and in the bulk box: home, less what decks hold. */
export function inPlace(homes: HomeLookup, library: DeckLibrary): HomeLookup {
  const held = heldByHome(library);
  return (setKey, baseNumber) =>
    subtractHomes(homes(setKey, baseNumber), held.get(cardKey(setKey, baseNumber)) ?? NO_HOMES);
}

/** Copies a deck could take from the binder and from the bulk box — never a Serialized. */
export function available(
  homes: HomeLookup,
  library: DeckLibrary,
): (setKey: SetKey, baseNumber: number) => Available {
  const here = inPlace(homes, library);
  return (setKey, baseNumber) => {
    const { binder, bulk } = here(setKey, baseNumber);
    return { binder: pullableCount(binder), bulk: pullableCount(bulk) };
  };
}

export type DeckStatus =
  | { state: 'unbuilt' }
  | { state: 'complete' }
  /**
   * Built, but the box is short: `missingOwned` of those are in the binder or another
   * deck, `missingInBulk` in the bulk box, and `missingUnowned` you do not have.
   */
  | { state: 'partial'; missingOwned: number; missingInBulk: number; missingUnowned: number };

export function deckStatus(deck: SavedDeck, library: DeckLibrary, homes: HomeLookup): DeckStatus {
  if (!deck.constructed) return { state: 'unbuilt' };

  const inBox = inBoxCounts(deck);
  const free = available(homes, library);
  const elsewhere = pulledTotals(library, deck.id);
  let missingOwned = 0;
  let missingInBulk = 0;
  let missingUnowned = 0;

  for (const [key, required] of requiredCounts(deck)) {
    let short = required - (inBox.get(key) ?? 0);
    if (short <= 0) continue;
    const { setKey, baseNumber } = parseCardKey(key);
    const { binder, bulk } = free(setKey, baseNumber);
    const fromBinder = Math.min(short, binder + (elsewhere.get(key) ?? 0));
    short -= fromBinder;
    const fromBulk = Math.min(short, bulk);
    missingOwned += fromBinder;
    missingInBulk += fromBulk;
    missingUnowned += short - fromBulk;
  }

  if (missingOwned + missingInBulk + missingUnowned === 0) return { state: 'complete' };
  return { state: 'partial', missingOwned, missingInBulk, missingUnowned };
}

export type DeckSource = { deckId: string; deckName: string; available: number };

export type ConstructLine = {
  setKey: SetKey;
  baseNumber: number;
  /** Copies still to put in this deck's box. */
  need: number;
  /** Of those, how many the binder can supply. */
  fromBinder: number;
  /** Then how many the bulk box can, and which printings to dig out. */
  fromBulk: number;
  bulkPrintings: VariantCounts;
  /** Built decks holding copies that could cover the rest, in library order. */
  fromDecks: DeckSource[];
  /** Copies you do not own at all — the purchase list. */
  unowned: number;
};

/**
 * What it takes to fill a deck's box — a fresh build, or completing a partial one.
 *
 * The binder is always used first, then the bulk box. Whatever they cannot cover is
 * offered from other built decks; the caller decides per deck whether to take it.
 */
export function planConstruct(
  deck: SavedDeck,
  library: DeckLibrary,
  homes: HomeLookup,
  includeSideboard: boolean,
): ConstructLine[] {
  const inBox = inBoxCounts(deck);
  const here = inPlace(homes, library);
  const lines: ConstructLine[] = [];

  for (const [key, required] of requiredCounts(deck, includeSideboard)) {
    const need = required - (inBox.get(key) ?? 0);
    if (need <= 0) continue;
    const { setKey, baseNumber } = parseCardKey(key);

    const { binder, bulk } = here(setKey, baseNumber);
    const fromBinder = Math.min(need, pullableCount(binder));
    const bulkPrintings = takeVariants(bulk, need - fromBinder);
    const fromBulk = sumVariants(bulkPrintings);
    let rest = need - fromBinder - fromBulk;

    const fromDecks: DeckSource[] = [];
    for (const other of library.customDecks) {
      if (rest <= 0) break;
      if (other.id === deck.id || !other.constructed) continue;
      const held = inBoxCounts(other).get(key) ?? 0;
      if (held <= 0) continue;
      const count = Math.min(rest, held);
      fromDecks.push({ deckId: other.id, deckName: other.name, available: count });
      rest -= count;
    }

    lines.push({
      setKey,
      baseNumber,
      need,
      fromBinder,
      fromBulk,
      bulkPrintings,
      fromDecks,
      unowned: rest,
    });
  }

  return lines;
}

export type TakeFromDeck = { deckId: string; setKey: SetKey; baseNumber: number; count: number };

function touch(deck: SavedDeck, patch: Partial<SavedDeck>, now: string): SavedDeck {
  return { ...deck, ...patch, updatedAt: now };
}

function boxToRefs(box: Map<CardKey, Homes>): DeckCardRef[] {
  const refs: DeckCardRef[] = [];
  for (const [key, homes] of box) {
    const variants = positive(addVariants(homes.binder, homes.bulk));
    const fromBulk = positive(homes.bulk);
    const count = sumVariants(variants);
    if (count <= 0) continue;
    refs.push({
      ...parseCardKey(key),
      count,
      variants,
      ...(sumVariants(fromBulk) > 0 && { fromBulk }),
    });
  }
  return refs;
}

function positive(variants: VariantCounts): VariantCounts {
  const clean: VariantCounts = {};
  for (const [variant, n] of Object.entries(variants) as Array<[VariantSlug, number]>) {
    if (n > 0) clean[variant] = n;
  }
  return clean;
}

/** `count` copies from the binder first, then the bulk box, most valuable first. */
function takeHomes(from: Homes, count: number): Homes {
  const binder = takeVariants(from.binder, count);
  return { binder, bulk: takeVariants(from.bulk, count - sumVariants(binder)) };
}

/**
 * Marks a deck built with what was just put in its box.
 *
 * `pulls` come from the binder, then the bulk box: the most valuable printings in each
 * (never a Serialized), unless the ref already says which printings they are — as an
 * intake batch does. Copies taken from another deck carry their printing and home with
 * them, and that deck stays built, now missing them.
 */
export function applyConstruct(
  library: DeckLibrary,
  deckId: string,
  pulls: readonly DeckCardRef[],
  takes: readonly TakeFromDeck[],
  homes: HomeLookup,
  now = new Date().toISOString(),
): DeckLibrary {
  const holdings = deckHoldings(library);
  const here = inPlace(homes, library);
  const target = library.customDecks.find((d) => d.id === deckId);
  if (!target) return library;

  const box = new Map(target.constructed ? (holdings.get(deckId) ?? []) : []);
  const put = (key: CardKey, moved: Homes) =>
    box.set(key, addHomes(box.get(key) ?? NO_HOMES, moved));

  for (const ref of pulls) {
    const key = cardKey(ref.setKey, ref.baseNumber);
    if (ref.variants && sumVariants(ref.variants) > 0) {
      put(key, refHomes(ref));
      continue;
    }
    const taken = takeHomes(here(ref.setKey, ref.baseNumber), ref.count);
    // A count the binder and box cannot account for (stale data) is still recorded, as Normal.
    const short = ref.count - sumVariants(taken.binder) - sumVariants(taken.bulk);
    put(key, short > 0 ? addHomes(taken, { binder: { normal: short }, bulk: {} }) : taken);
  }

  const donors = new Map<string, Map<CardKey, Homes>>();
  for (const take of takes) {
    const key = cardKey(take.setKey, take.baseNumber);
    const donor = donors.get(take.deckId) ?? new Map(holdings.get(take.deckId) ?? []);
    donors.set(take.deckId, donor);
    const moved = takeHomes(donor.get(key) ?? NO_HOMES, take.count);
    donor.set(key, subtractHomes(donor.get(key) ?? NO_HOMES, moved));
    put(key, moved);
  }

  return {
    ...library,
    customDecks: library.customDecks.map((deck) => {
      if (deck.id === deckId) {
        return touch(deck, { constructed: true, pulledCards: boxToRefs(box) }, now);
      }
      const donor = donors.get(deck.id);
      return donor ? touch(deck, { pulledCards: boxToRefs(donor) }, now) : deck;
    }),
  };
}

/** Every card in the box goes back where it came from — the printings it took, exactly. */
export function applyDeconstruct(
  library: DeckLibrary,
  deckId: string,
  now = new Date().toISOString(),
): DeckLibrary {
  return {
    ...library,
    customDecks: library.customDecks.map((deck) =>
      deck.id === deckId ? touch(deck, { constructed: false, pulledCards: [] }, now) : deck,
    ),
  };
}

/**
 * Moves single copies in and out of a built deck's box. +1 takes the most valuable
 * printing left in the binder pocket, else in the bulk box; −1 sends one back, a bulk-box
 * copy first, then the box's least valuable binder copy. Clamped to 0…`max` (what the
 * deck lists); +1 does nothing if neither place has a copy.
 */
export function adjustInBox(
  library: DeckLibrary,
  deckId: string,
  setKey: SetKey,
  baseNumber: number,
  delta: 1 | -1,
  max: number,
  homes: HomeLookup,
  now = new Date().toISOString(),
): DeckLibrary {
  const deck = library.customDecks.find((d) => d.id === deckId);
  if (!deck?.constructed) return library;

  const box = new Map(deckHoldings(library).get(deckId) ?? []);
  const key = cardKey(setKey, baseNumber);
  const current = box.get(key) ?? NO_HOMES;
  const inBox = sumVariants(current.binder) + sumVariants(current.bulk);

  if (delta > 0) {
    if (inBox >= max) return library;
    const { binder, bulk } = inPlace(homes, library)(setKey, baseNumber);
    const fromBinder = takeVariants(binder, 1);
    const taken = sumVariants(fromBinder)
      ? { binder: fromBinder, bulk: {} }
      : { binder: {}, bulk: takeVariants(bulk, 1) };
    if (sumVariants(taken.binder) + sumVariants(taken.bulk) === 0) return library;
    box.set(key, addHomes(current, taken));
  } else {
    const fromBulk = takeVariants(current.bulk, 1, RETURN_ORDER);
    const back = sumVariants(fromBulk)
      ? { binder: {}, bulk: fromBulk }
      : { binder: takeVariants(current.binder, 1, RETURN_ORDER), bulk: {} };
    if (sumVariants(back.binder) + sumVariants(back.bulk) === 0) return library;
    box.set(key, subtractHomes(current, back));
  }

  return {
    ...library,
    customDecks: library.customDecks.map((d) =>
      d.id === deckId ? touch(d, { pulledCards: boxToRefs(box) }, now) : d,
    ),
  };
}

/** `count` copies to send back from a box: bulk-box copies first, then the least valuable. */
function takeBack(from: Homes, count: number): Homes {
  const bulk = takeVariants(from.bulk, count, RETURN_ORDER);
  return { binder: takeVariants(from.binder, count - sumVariants(bulk), RETURN_ORDER), bulk };
}

/**
 * What leaves a built deck's box when its list changes to `contents`: every copy beyond
 * what the new list holds, sideboard included. Each comes back with its printings and the
 * home it returns to, like a deconstruct. Nothing for a deck that is not built.
 */
export function editReturns(
  library: DeckLibrary,
  deckId: string,
  contents: DeckContents,
): DeckCardRef[] {
  const deck = library.customDecks.find((d) => d.id === deckId);
  if (!deck?.constructed) return [];
  const required = requiredCounts(contents, true);
  const returns = new Map<CardKey, Homes>();
  for (const [key, homes] of deckHoldings(library).get(deckId) ?? []) {
    const extra = sumVariants(homes.binder) + sumVariants(homes.bulk) - (required.get(key) ?? 0);
    if (extra > 0) returns.set(key, takeBack(homes, extra));
  }
  return boxToRefs(returns);
}

export type DeckEdit = {
  contents: DeckContents;
  format: PlayFormat;
  name: string;
  sourceText: string;
};

/**
 * Saves a new list for a deck. A built deck stays built: copies the list no longer holds
 * leave its box (`editReturns`), and cards it now lists but the box lacks leave it missing
 * them, for Complete to pull.
 */
export function applyDeckEdit(
  library: DeckLibrary,
  deckId: string,
  edit: DeckEdit,
  now = new Date().toISOString(),
): DeckLibrary {
  const deck = library.customDecks.find((d) => d.id === deckId);
  if (!deck) return library;

  let pulledCards = deck.pulledCards;
  if (deck.constructed) {
    const box = new Map(deckHoldings(library).get(deckId) ?? []);
    for (const ref of editReturns(library, deckId, edit.contents)) {
      const key = cardKey(ref.setKey, ref.baseNumber);
      box.set(key, subtractHomes(box.get(key) ?? NO_HOMES, refHomes(ref)));
    }
    pulledCards = boxToRefs(box);
  }

  const { secondLeader: _old, ...rest } = deck;
  const { leader, secondLeader, base, mainDeck, sideboard } = edit.contents;
  return {
    ...library,
    customDecks: library.customDecks.map((d) =>
      d.id === deckId
        ? touch(
            rest,
            {
              leader,
              ...(secondLeader && { secondLeader }),
              base,
              mainDeck,
              sideboard,
              format: edit.format,
              name: edit.name.trim() || deck.name,
              sourceText: edit.sourceText,
              pulledCards,
            },
            now,
          )
        : d,
    ),
  };
}
