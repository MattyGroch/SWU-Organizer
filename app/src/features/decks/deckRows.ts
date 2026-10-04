import { parseCardKey, requiredCounts, type OwnedLookup } from '~/domain/deckBuild';
import type { DeckCardRef, DeckContents } from '~/domain/deckContents';
import type { DeckRole, DeckLookupSet, DeckRowWithNeed } from '~/domain/decklist';
import { FORMAT_RULES } from '~/domain/deckLegality';
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
    price,
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

/** Two leaders is what makes a deck Twin Suns — readable from the stored contents alone. */
export function formatLabel(contents: DeckContents): string {
  return contents.secondLeader ? FORMAT_RULES.twinSuns.label : FORMAT_RULES.premier.label;
}
