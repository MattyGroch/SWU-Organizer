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
    arenas: card.Arenas,
    aspects: card.Aspects,
    cost: card.Cost,
    power: card.Power,
    hp: card.HP,
    rarity: card.Rarity,
    price,
    maxCopies: card.MaxCopies,
    ambiguous: false,
    have,
    needed,
    rowCost: needed * price,
  };
}

/** Units by arena, then events and upgrades: the order a deck lists its cards in. */
export const CARD_GROUPS: Array<{
  label: string;
  test: (type: string | undefined, arenas: string[] | undefined) => boolean;
}> = [
  { label: 'Ground units', test: (type, arenas) => type === 'Unit' && !arenas?.includes('Space') },
  { label: 'Space units', test: (type, arenas) => type === 'Unit' && !!arenas?.includes('Space') },
  { label: 'Events', test: (type) => type === 'Event' },
  { label: 'Upgrades', test: (type) => type === 'Upgrade' },
];

/** A row's place in `CARD_GROUPS`; anything else comes after, as "Other". */
export function cardGroupIndex(type: string | undefined, arenas: string[] | undefined): number {
  const index = CARD_GROUPS.findIndex((g) => g.test(type, arenas));
  return index === -1 ? CARD_GROUPS.length : index;
}

export function cardGroupLabel(groupIndex: number): string {
  return CARD_GROUPS[groupIndex]?.label ?? 'Other';
}

const ROLE_ORDER: Record<DeckRole, number> = { leader: 0, base: 1, deck: 2, sideboard: 3 };

/**
 * Rows in deck order: leader, base, main deck, sideboard; within those, by group, then
 * cost and name. Each keeps its index into `rows`, for columns aligned with the input.
 */
export function orderDeckRows<
  Row extends Pick<DeckRowWithNeed, 'role' | 'type' | 'arenas' | 'cost' | 'name'>,
>(rows: Row[]): Array<{ row: Row; index: number; group: number }> {
  return rows
    .map((row, index) => ({ row, index, group: cardGroupIndex(row.type, row.arenas) }))
    .sort(
      (a, b) =>
        ROLE_ORDER[a.row.role] - ROLE_ORDER[b.row.role] ||
        a.group - b.group ||
        (a.row.cost ?? 0) - (b.row.cost ?? 0) ||
        a.row.name.localeCompare(b.row.name),
    );
}

/**
 * What kind of card a row is, for the deck table: "Ground unit", "Space unit", "Upgrade",
 * "Event". Leaders and bases say so in their role, so they get nothing.
 */
export function cardKind(
  type: string | undefined,
  arenas: string[] | undefined,
): string | undefined {
  if (!type || type === 'Leader' || type === 'Base') return undefined;
  if (type === 'Unit' && arenas?.length) return `${arenas.join('/')} unit`;
  return type;
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
