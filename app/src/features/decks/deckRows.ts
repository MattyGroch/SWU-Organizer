import { parseCardKey, requiredCounts, type OwnedLookup } from '~/domain/deckBuild';
import type { DeckCardRef, DeckContents } from '~/domain/deckContents';
import type { DeckRole, DeckLookupSet, DeckRowWithNeed } from '~/domain/decklist';
import { FORMAT_RULES, type PlayFormat } from '~/domain/deckLegality';
import { deckFormat } from '~/domain/decks';
import type { SetKey } from '~/domain/types';

export type { OwnedLookup };

function refToRow(
  ref: DeckCardRef,
  role: DeckRole,
  lookup: Map<SetKey, DeckLookupSet>,
  owned: OwnedLookup,
): DeckRowWithNeed | null {
  const card = lookup.get(ref.setKey)?.byNumber.get(ref.baseNumber);
  if (!card) return null;
  const have = owned(ref.setKey, ref.baseNumber);
  const price = Number(card.MarketPrice ?? 0);
  const needed = Math.max(0, ref.count - have);
  return {
    role,
    count: ref.count,
    setKey: ref.setKey,
    baseNumber: ref.baseNumber,
    name: card.Name,
    subtitle: card.Subtitle,
    type: card.Type,
    aspects: card.Aspects,
    cost: card.Cost,
    price,
    maxCopies: card.MaxCopies,
    ambiguous: false,
    have,
    needed,
    rowCost: needed * price,
  };
}

/** A stored deck (saved or precon) as table rows, each with what you have and still need. */
export function contentsToRows(
  contents: DeckContents,
  lookup: Map<SetKey, DeckLookupSet>,
  owned: OwnedLookup,
): DeckRowWithNeed[] {
  const roled: Array<[DeckCardRef, DeckRole]> = [[contents.leader, 'leader']];
  if (contents.secondLeader) roled.push([contents.secondLeader, 'leader']);
  roled.push([contents.base, 'base']);
  for (const ref of contents.mainDeck) roled.push([ref, 'deck']);
  for (const ref of contents.sideboard) roled.push([ref, 'sideboard']);

  const rows: DeckRowWithNeed[] = [];
  for (const [ref, role] of roled) {
    const row = refToRow(ref, role, lookup, owned);
    if (row) rows.push(row);
  }
  return rows;
}

/** Copies to buy before the deck can be built — leader, base and main deck, not sideboard. */
export function cardsNeeded(contents: DeckContents, owned: OwnedLookup): number {
  let needed = 0;
  for (const [key, count] of requiredCounts(contents)) {
    const { setKey, baseNumber } = parseCardKey(key);
    needed += Math.max(0, count - owned(setKey, baseNumber));
  }
  return needed;
}

export function formatLabel(deck: DeckContents & { format?: PlayFormat }): string {
  return FORMAT_RULES[deckFormat(deck)].label;
}

const AFFILIATIONS = new Set(['Heroism', 'Villainy']);

/**
 * The aspects a deck plays: its leader's and base's primary aspects, in that order, then
 * Heroism or Villainy last. Duplicates stay — a Vigilance leader on a Vigilance base pays
 * for double-Vigilance cards, so the deck shows two.
 */
export function deckAspects(contents: DeckContents, lookup: Map<SetKey, DeckLookupSet>): string[] {
  const refs = [contents.leader, contents.secondLeader, contents.base];
  const aspects = refs.flatMap((ref) =>
    ref ? (lookup.get(ref.setKey)?.byNumber.get(ref.baseNumber)?.Aspects ?? []) : [],
  );
  const primary = aspects.filter((aspect) => !AFFILIATIONS.has(aspect));
  // Twin Suns leaders can share an affiliation; one symbol says it.
  const affiliation = [...new Set(aspects.filter((aspect) => AFFILIATIONS.has(aspect)))];
  return [...primary, ...affiliation];
}
