import type { VariantSlug } from './catalog';
import type { DeckCardRef, DeckContents } from './deckContents';
import type { PlayFormat } from './deckLegality';
import type { DeckLibrary, PreconLoan, SavedDeck } from './decks';
import {
  DECK_PULL_ORDER,
  NO_HOMES,
  VALUE_ORDER,
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
 * sideboard never counts toward complete.
 *
 * An owned precon stands in as a built deck (`withPrecons`), but its own copies are not in
 * the binder or bulk box, so they have no home there. A deck can take one as a last
 * resort; it is then a `PreconLoan` on that deck, and goes back into the precon when the
 * deck is put away. Cards leaving any box fill a precon that is missing them before they
 * go home.
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

function loansToMap(loans: readonly PreconLoan[] | undefined): Map<CardKey, number> {
  const map = new Map<CardKey, number>();
  for (const loan of loans ?? []) add(map, cardKey(loan.setKey, loan.baseNumber), loan.count);
  return map;
}

/** Copies of each card out of one precon's box, lent to built decks. */
export function lentFromPrecon(library: DeckLibrary, preconKey: string): Map<CardKey, number> {
  const lent = new Map<CardKey, number>();
  for (const deck of library.customDecks) {
    if (!deck.constructed) continue;
    for (const loan of deck.borrowed ?? []) {
      if (loan.preconKey === preconKey) {
        add(lent, cardKey(loan.setKey, loan.baseNumber), loan.count);
      }
    }
  }
  return lent;
}

/** A precon's own copies still in its box: its list, less what is lent out. */
function sealedHeld(deck: SavedDeck, library: DeckLibrary): Map<CardKey, number> {
  const held = new Map<CardKey, number>();
  if (!deck.precon) return held;
  const lent = lentFromPrecon(library, deck.precon);
  for (const [key, count] of requiredCounts(deck, true)) {
    add(held, key, Math.max(0, count - (lent.get(key) ?? 0)));
  }
  return held;
}

/**
 * Copies another deck could take from this one: what its box holds from the binder and the
 * bulk box, and for a precon its own copies still in it. Cards a deck itself borrowed from
 * a precon are not its to give.
 */
function lendableCounts(deck: SavedDeck, library: DeckLibrary): Map<CardKey, number> {
  if (!deck.constructed) return new Map();
  const counts = refsToMap(deck.pulledCards);
  for (const [key, count] of sealedHeld(deck, library)) add(counts, key, count);
  return counts;
}

/**
 * Copies currently in a deck's box, borrowed ones included. Empty for a deck that is not
 * built. A precon's own copies are not in the binder, so they count here but nowhere else.
 */
export function inBoxCounts(deck: SavedDeck, library: DeckLibrary): Map<CardKey, number> {
  if (!deck.constructed) return new Map();
  const counts = lendableCounts(deck, library);
  for (const [key, count] of loansToMap(deck.borrowed)) add(counts, key, count);
  return counts;
}

/** Copies of each card still in owned precons' boxes, optionally ignoring one deck. */
export function preconTotals(library: DeckLibrary, excludeId?: string): Map<CardKey, number> {
  const totals = new Map<CardKey, number>();
  for (const deck of library.customDecks) {
    if (!deck.precon || deck.id === excludeId) continue;
    for (const [key, count] of sealedHeld(deck, library)) add(totals, key, count);
  }
  return totals;
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
   * deck (or, for a precon, lent to one), `missingInBulk` in the bulk box,
   * `missingInPrecon` only in a sealed precon, and `missingUnowned` you do not have.
   */
  | {
      state: 'partial';
      missingOwned: number;
      missingInBulk: number;
      missingInPrecon: number;
      missingUnowned: number;
    };

export function deckStatus(deck: SavedDeck, library: DeckLibrary, homes: HomeLookup): DeckStatus {
  if (!deck.constructed) return { state: 'unbuilt' };

  const inBox = inBoxCounts(deck, library);
  const free = available(homes, library);
  const elsewhere = pulledTotals(library, deck.id);
  // A precon's own cards that decks have borrowed are owned, just sitting in those decks.
  const lent = deck.precon ? lentFromPrecon(library, deck.precon) : new Map<CardKey, number>();
  const inPrecons = preconTotals(library, deck.id);
  let missingOwned = 0;
  let missingInBulk = 0;
  let missingInPrecon = 0;
  let missingUnowned = 0;

  for (const [key, required] of requiredCounts(deck)) {
    let short = required - (inBox.get(key) ?? 0);
    if (short <= 0) continue;
    const { setKey, baseNumber } = parseCardKey(key);
    const { binder, bulk } = free(setKey, baseNumber);
    const fromBinder = Math.min(short, binder + (elsewhere.get(key) ?? 0) + (lent.get(key) ?? 0));
    short -= fromBinder;
    const fromBulk = Math.min(short, bulk);
    short -= fromBulk;
    const fromPrecon = Math.min(short, inPrecons.get(key) ?? 0);
    missingOwned += fromBinder;
    missingInBulk += fromBulk;
    missingInPrecon += fromPrecon;
    missingUnowned += short - fromPrecon;
  }

  if (missingOwned + missingInBulk + missingInPrecon + missingUnowned === 0) {
    return { state: 'complete' };
  }
  return { state: 'partial', missingOwned, missingInBulk, missingInPrecon, missingUnowned };
}

export type DeckSource = {
  deckId: string;
  deckName: string;
  available: number;
  /** An owned precon rather than a built deck of yours. */
  precon?: boolean;
};

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
 * offered from other built decks, then from owned precons as a last resort; the caller
 * decides per source whether to take it.
 */
export function planConstruct(
  deck: SavedDeck,
  library: DeckLibrary,
  homes: HomeLookup,
  includeSideboard: boolean,
): ConstructLine[] {
  const inBox = inBoxCounts(deck, library);
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
    // Your own built decks first; a precon only once nothing else can cover it.
    const donors = [
      ...library.customDecks.filter((other) => !other.precon),
      ...library.customDecks.filter((other) => other.precon),
    ];
    for (const other of donors) {
      if (rest <= 0) break;
      if (other.id === deck.id || !other.constructed) continue;
      const held = lendableCounts(other, library).get(key) ?? 0;
      if (held <= 0) continue;
      const count = Math.min(rest, held);
      fromDecks.push({
        deckId: other.id,
        deckName: other.name,
        available: count,
        ...(other.precon && { precon: true }),
      });
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

/** `more` added to `loans`, a card from one precon kept as a single record. */
function addLoans(loans: readonly PreconLoan[] | undefined, more: readonly PreconLoan[]) {
  const out = (loans ?? []).map((loan) => ({ ...loan }));
  for (const loan of more) {
    const same = out.find(
      (l) =>
        l.preconKey === loan.preconKey &&
        l.setKey === loan.setKey &&
        l.baseNumber === loan.baseNumber,
    );
    if (same) same.count += loan.count;
    else out.push({ ...loan });
  }
  return out;
}

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
  const loans: PreconLoan[] = [];
  for (const take of takes) {
    const key = cardKey(take.setKey, take.baseNumber);
    const donor = donors.get(take.deckId) ?? new Map(holdings.get(take.deckId) ?? []);
    donors.set(take.deckId, donor);
    const moved = takeHomes(donor.get(key) ?? NO_HOMES, take.count);
    donor.set(key, subtractHomes(donor.get(key) ?? NO_HOMES, moved));
    put(key, moved);
    // A precon's own copies have no binder or bulk home: they leave as loans, and go back
    // to that precon.
    const preconKey = library.customDecks.find((d) => d.id === take.deckId)?.precon;
    const loaned = take.count - sumVariants(moved.binder) - sumVariants(moved.bulk);
    if (preconKey && loaned > 0) {
      loans.push({ preconKey, setKey: take.setKey, baseNumber: take.baseNumber, count: loaned });
    }
  }

  return {
    ...library,
    customDecks: library.customDecks.map((deck) => {
      if (deck.id === deckId) {
        return touch(
          deck,
          {
            constructed: true,
            pulledCards: boxToRefs(box),
            ...(loans.length > 0 && { borrowed: addLoans(deck.borrowed, loans) }),
          },
          now,
        );
      }
      const donor = donors.get(deck.id);
      return donor ? touch(deck, { pulledCards: boxToRefs(donor) }, now) : deck;
    }),
  };
}

const countOf = (refs: readonly DeckCardRef[]) => refs.reduce((sum, ref) => sum + ref.count, 0);

/**
 * A precon refilled from the binder while a card of it was lent out holds one too many
 * once that card is back. The refill copy goes home, the way a copy leaving any box does.
 */
function trimPreconSurplus(library: DeckLibrary, now: string): DeckLibrary {
  const holdings = deckHoldings(library);
  return {
    ...library,
    customDecks: library.customDecks.map((deck) => {
      if (!deck.precon || deck.pulledCards.length === 0) return deck;
      const box = new Map(holdings.get(deck.id) ?? []);
      const sealed = sealedHeld(deck, library);
      const required = requiredCounts(deck, true);
      for (const [key, homes] of box) {
        const refilled = sumVariants(homes.binder) + sumVariants(homes.bulk);
        const extra = Math.min(
          refilled,
          refilled + (sealed.get(key) ?? 0) - (required.get(key) ?? 0),
        );
        if (extra > 0) box.set(key, subtractHomes(homes, takeBack(homes, extra)));
      }
      const pulledCards = boxToRefs(box);
      return countOf(pulledCards) === countOf(deck.pulledCards)
        ? deck
        : touch(deck, { pulledCards }, now);
    }),
  };
}

export type PreconRelease = {
  preconKey: string;
  setKey: SetKey;
  baseNumber: number;
  /** The printings leaving the precon's box, by the home each returns to. */
  homes: Homes;
};

/** Copies in precon boxes (from the binder or bulk box) in `from` that are not in `other`. */
function preconDifference(from: DeckLibrary, other: DeckLibrary): PreconRelease[] {
  const held = deckHoldings(other);
  const out: PreconRelease[] = [];
  for (const [deckId, was] of deckHoldings(from)) {
    const deck = from.customDecks.find((d) => d.id === deckId);
    if (!deck?.precon) continue;
    for (const [key, homes] of was) {
      const now = held.get(deckId)?.get(key) ?? NO_HOMES;
      const gone = {
        binder: subtractVariants(homes.binder, now.binder),
        bulk: subtractVariants(homes.bulk, now.bulk),
      };
      if (sumVariants(gone.binder) + sumVariants(gone.bulk) > 0) {
        out.push({ preconKey: deck.precon, ...parseCardKey(key), homes: gone });
      }
    }
  }
  return out;
}

/**
 * Cards a change takes out of a precon's box to send home — surplus from a refill, once
 * the copies lent from it are back. `before` and `after` are the library around the change.
 */
export function preconReleases(before: DeckLibrary, after: DeckLibrary): PreconRelease[] {
  return preconDifference(before, after);
}

/**
 * Cards a change puts into a precon's box instead of sending them home: copies leaving a
 * deck that a precon was missing (see `refillPrecons`).
 */
export function preconFills(before: DeckLibrary, after: DeckLibrary): PreconRelease[] {
  return preconDifference(after, before);
}

/**
 * Copies leaving a deck's box go into any owned precon that is missing that card before
 * they go home to the binder or bulk box — rebuilding the precons comes first. `leaving`
 * is what the box gives up; `library` is already without it.
 */
function refillPrecons(
  library: DeckLibrary,
  leaving: readonly DeckCardRef[],
  now: string,
): DeckLibrary {
  const precons = library.customDecks.filter((deck) => deck.precon && deck.constructed);
  if (precons.length === 0 || leaving.length === 0) return library;
  const boxes = new Map(
    precons.map((deck) => [deck.id, new Map(deckHoldings(library).get(deck.id) ?? [])]),
  );
  const changed = new Set<string>();

  for (const ref of leaving) {
    const key = cardKey(ref.setKey, ref.baseNumber);
    let homes = refHomes(ref);
    for (const precon of precons) {
      const box = boxes.get(precon.id)!;
      const inBox = box.get(key) ?? NO_HOMES;
      const have =
        sumVariants(inBox.binder) +
        sumVariants(inBox.bulk) +
        (sealedHeld(precon, library).get(key) ?? 0);
      const short = (requiredCounts(precon, true).get(key) ?? 0) - have;
      const moved = takeBack(homes, short);
      const count = sumVariants(moved.binder) + sumVariants(moved.bulk);
      if (count <= 0) continue;
      box.set(key, addHomes(inBox, moved));
      homes = subtractHomes(homes, moved);
      changed.add(precon.id);
    }
  }

  return {
    ...library,
    customDecks: library.customDecks.map((deck) =>
      changed.has(deck.id)
        ? touch(deck, { pulledCards: boxToRefs(boxes.get(deck.id)!) }, now)
        : deck,
    ),
  };
}

/**
 * Every card in the box goes back where it came from — the printings it took, exactly.
 * Cards borrowed from a precon go back in that precon, which is complete again.
 */
export function applyDeconstruct(
  library: DeckLibrary,
  deckId: string,
  now = new Date().toISOString(),
): DeckLibrary {
  const leaving = library.customDecks.find((d) => d.id === deckId)?.pulledCards ?? [];
  const cleared = trimPreconSurplus(
    {
      ...library,
      customDecks: library.customDecks.map((deck) => {
        if (deck.id !== deckId) return deck;
        const { borrowed: _returned, ...rest } = deck;
        return touch(rest, { constructed: false, pulledCards: [] }, now);
      }),
    },
    now,
  );
  // Whatever a precon is missing is put back in it before anything goes home.
  return refillPrecons(cleared, leaving, now);
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
  const inBox = inBoxCounts(deck, library).get(key) ?? 0;

  if (delta < 0) {
    // A copy borrowed from a precon goes back first: that puts the precon whole again.
    const loan = deck.borrowed?.find((l) => l.setKey === setKey && l.baseNumber === baseNumber);
    if (loan) {
      const borrowed = (deck.borrowed ?? [])
        .map((l) => (l === loan ? { ...l, count: l.count - 1 } : l))
        .filter((l) => l.count > 0);
      const { borrowed: _old, ...rest } = deck;
      return trimPreconSurplus(
        {
          ...library,
          customDecks: library.customDecks.map((d) =>
            d.id === deckId ? touch(rest, { ...(borrowed.length > 0 && { borrowed }) }, now) : d,
          ),
        },
        now,
      );
    }
  }

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

/**
 * Trades one copy in a built deck's box for a better printing from the binder pocket: the
 * better copy goes into the box, and the copy it replaces comes out.
 *
 * Only the deck's own record changes. Every copy keeps its home, so the collection is not
 * touched: the copy that comes out goes back where it came from — the binder pocket, into
 * the slot the upgrade just emptied, or the bulk box when that is where it was pulled from.
 * It prefers a binder-homed copy, so the pocket stays full. The bulk box never refills a
 * pocket.
 *
 * Returns null, changing nothing, when the swap no longer holds: the deck is not built or
 * no longer holds that printing, the pocket no longer holds the better one (another deck
 * took it), or it is not actually better. A Prestige Serialized never goes into a deck.
 */
export function swapInBox(
  library: DeckLibrary,
  deckId: string,
  setKey: SetKey,
  baseNumber: number,
  from: VariantSlug,
  to: VariantSlug,
  homes: HomeLookup,
  now = new Date().toISOString(),
): { library: DeckLibrary; toBulk: boolean } | null {
  const deck = library.customDecks.find((d) => d.id === deckId);
  if (!deck?.constructed) return null;
  if (to === 'prestige-serialized' || VALUE_ORDER.indexOf(to) >= VALUE_ORDER.indexOf(from)) {
    return null;
  }

  const box = new Map(deckHoldings(library).get(deckId) ?? []);
  const key = cardKey(setKey, baseNumber);
  const current = box.get(key) ?? NO_HOMES;
  const leavesBinder = (current.binder[from] ?? 0) > 0;
  if (!leavesBinder && (current.bulk[from] ?? 0) <= 0) return null;
  if ((inPlace(homes, library)(setKey, baseNumber).binder[to] ?? 0) <= 0) return null;

  const out: Homes = leavesBinder
    ? { binder: { [from]: 1 }, bulk: {} }
    : { binder: {}, bulk: { [from]: 1 } };
  box.set(key, addHomes(subtractHomes(current, out), { binder: { [to]: 1 }, bulk: {} }));

  return {
    toBulk: !leavesBinder,
    library: {
      ...library,
      customDecks: library.customDecks.map((d) =>
        d.id === deckId ? touch(d, { pulledCards: boxToRefs(box) }, now) : d,
      ),
    },
  };
}

/** One copy traded by `swapAllInBox`, in the order it was applied. */
export type AppliedSwap = {
  setKey: SetKey;
  baseNumber: number;
  from: VariantSlug;
  to: VariantSlug;
  /** Where the copy that comes out goes: the bulk box, or the pocket the better one left. */
  toBulk: boolean;
};

/**
 * Runs `swapInBox` once per copy for every swap in `swaps`, each judged against the result
 * of the one before, so a swap that stopped holding (another deck took the copy) is skipped
 * and the rest still go through. Pure: nothing is written, so it also previews exactly what
 * a "swap all" would do. `applied` is empty, and `library` unchanged, when nothing holds.
 */
export function swapAllInBox(
  library: DeckLibrary,
  deckId: string,
  swaps: readonly {
    setKey: SetKey;
    baseNumber: number;
    from: VariantSlug;
    to: VariantSlug;
    count: number;
  }[],
  homes: HomeLookup,
  now = new Date().toISOString(),
): { library: DeckLibrary; applied: AppliedSwap[] } {
  let current = library;
  const applied: AppliedSwap[] = [];
  for (const { setKey, baseNumber, from, to, count } of swaps) {
    for (let i = 0; i < count; i++) {
      const result = swapInBox(current, deckId, setKey, baseNumber, from, to, homes, now);
      if (!result) break;
      current = result.library;
      applied.push({ setKey, baseNumber, from, to, toBulk: result.toBulk });
    }
  }
  return { library: current, applied };
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

/**
 * What a built deck must hand back to precons when its list changes to `contents`:
 * borrowed copies beyond what the new list holds, which go first, before any copy from the
 * binder. Nothing for a deck that is not built.
 */
export function editLoanReturns(
  library: DeckLibrary,
  deckId: string,
  contents: DeckContents,
): PreconLoan[] {
  const deck = library.customDecks.find((d) => d.id === deckId);
  if (!deck?.constructed || !deck.borrowed?.length) return [];
  const required = requiredCounts(contents, true);
  const pulled = refsToMap(deck.pulledCards);
  const over = new Map<CardKey, number>();
  for (const [key, loaned] of loansToMap(deck.borrowed)) {
    over.set(
      key,
      Math.min(loaned, Math.max(0, (pulled.get(key) ?? 0) + loaned - (required.get(key) ?? 0))),
    );
  }
  const returns: PreconLoan[] = [];
  for (const loan of deck.borrowed) {
    const key = cardKey(loan.setKey, loan.baseNumber);
    const give = Math.min(loan.count, over.get(key) ?? 0);
    if (give <= 0) continue;
    over.set(key, (over.get(key) ?? 0) - give);
    returns.push({ ...loan, count: give });
  }
  return returns;
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

  const handedBack = editLoanReturns(library, deckId, edit.contents);
  const borrowed = (deck.borrowed ?? [])
    .map((loan) => {
      const back = handedBack.find(
        (b) =>
          b.preconKey === loan.preconKey &&
          b.setKey === loan.setKey &&
          b.baseNumber === loan.baseNumber,
      );
      return back ? { ...loan, count: loan.count - back.count } : loan;
    })
    .filter((loan) => loan.count > 0);

  const { secondLeader: _old, borrowed: _loans, ...rest } = deck;
  const { leader, secondLeader, base, mainDeck, sideboard } = edit.contents;
  const leaving = editReturns(library, deckId, edit.contents);
  const saved = trimPreconSurplus(
    {
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
                ...(borrowed.length > 0 && { borrowed }),
              },
              now,
            )
          : d,
      ),
    },
    now,
  );
  return refillPrecons(saved, leaving, now);
}
