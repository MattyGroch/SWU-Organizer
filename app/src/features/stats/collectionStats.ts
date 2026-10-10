import { VARIANTS, type LoadedSet, type VariantSlug } from '~/domain/catalog';
import { cardValue, ownedFor, type OwnedCounts, type VariantCounts } from '~/domain/ownership';
import type { SetKey } from '~/domain/types';
import { buildCardRows, collectionTotals, EMPTY_FILTERS } from '~/features/binder/cardRows';
import type { CollectionTotals } from '~/features/binder/cardRows';

/**
 * The Stats page's whole-collection numbers. Pure, so they test without a database: the
 * page reads every owned row once and hands it here, indexed per set.
 */

export type SetCompletion = {
  setKey: SetKey;
  label: string;
  totals: CollectionTotals;
  /** Every copy owned of the set's cards, any printing. */
  copies: number;
};

/** Each set's playset progress, as its binder's own bar counts it, in manifest order. */
export function setCompletions(
  sets: readonly LoadedSet[],
  ownership: ReadonlyMap<SetKey, ReadonlyMap<number, OwnedCounts>>,
): SetCompletion[] {
  return sets.map((set) => {
    const rows = buildCardRows(set, ownership.get(set.setKey) ?? new Map(), EMPTY_FILTERS);
    return {
      setKey: set.setKey,
      label: set.label,
      totals: collectionTotals(rows),
      copies: rows.reduce((sum, row) => sum + row.total, 0),
    };
  });
}

export type PrintingShare = { variant: VariantSlug; copies: number; share: number };

/** Copies per printing across the given ownership, most common first; empty printings left out. */
export function printingBreakdown(
  ownership: Iterable<ReadonlyMap<number, OwnedCounts>>,
): PrintingShare[] {
  const byVariant: VariantCounts = {};
  let total = 0;
  for (const set of ownership) {
    for (const counts of set.values()) {
      for (const [variant, n] of Object.entries(counts.byVariant) as Array<[VariantSlug, number]>) {
        byVariant[variant] = (byVariant[variant] ?? 0) + n;
        total += n;
      }
    }
  }
  return VARIANTS.filter((variant) => (byVariant[variant] ?? 0) > 0)
    .map((variant) => ({
      variant,
      copies: byVariant[variant]!,
      share: byVariant[variant]! / total,
    }))
    .sort((a, b) => b.copies - a.copies);
}

export type PrintingProgress = {
  /** Distinct printings of this kind you own at least one copy of. */
  owned: number;
  /** Printings of this kind in the set. */
  total: number;
};

/** Which special printings count together, e.g. Hyperspace and Hyperspace Foil. */
export const PRINTING_GROUPS = {
  hyperspace: ['hyperspace', 'hyperspace-foil'],
  showcase: ['showcase'],
  prestige: ['prestige', 'prestige-foil', 'prestige-serialized'],
  promo: ['promo', 'promo-foil'],
} as const satisfies Record<string, readonly VariantSlug[]>;

export type PrintingGroup = keyof typeof PRINTING_GROUPS;

/**
 * A "master set" view of one set: of each special printing kind, how many distinct
 * printings you own. A printing counts once however many copies of it you have.
 */
export function printingProgress(
  set: LoadedSet,
  owned: ReadonlyMap<number, OwnedCounts> | undefined,
): Record<PrintingGroup, PrintingProgress> {
  const out = Object.fromEntries(
    Object.keys(PRINTING_GROUPS).map((group) => [group, { owned: 0, total: 0 }]),
  ) as Record<PrintingGroup, PrintingProgress>;
  for (const card of set.cardsByBase.values()) {
    const counts = owned && ownedFor(owned, card.base);
    for (const printing of card.printings) {
      for (const [group, variants] of Object.entries(PRINTING_GROUPS) as Array<
        [PrintingGroup, readonly VariantSlug[]]
      >) {
        if (!variants.includes(printing.variant)) continue;
        out[group].total += 1;
        if ((counts?.byVariant[printing.variant] ?? 0) > 0) out[group].owned += 1;
      }
    }
  }
  return out;
}

export type CardHighlight = {
  setKey: SetKey;
  base: number;
  name: string;
  subtitle?: string;
  /** Copies owned, or their value, depending on the highlight. */
  amount: number;
};

export type CollectionHighlights = {
  copies: number;
  /** Distinct cards with at least one copy. */
  cards: number;
  value: number;
  /** The card you own the most copies of. */
  mostCopies?: CardHighlight;
  /** The card whose owned copies are worth the most together. */
  mostValuable?: CardHighlight;
};

export function collectionHighlights(
  sets: readonly LoadedSet[],
  ownership: ReadonlyMap<SetKey, ReadonlyMap<number, OwnedCounts>>,
): CollectionHighlights {
  const out: CollectionHighlights = { copies: 0, cards: 0, value: 0 };
  for (const set of sets) {
    const owned = ownership.get(set.setKey);
    if (!owned) continue;
    for (const card of set.cardsByBase.values()) {
      const counts = ownedFor(owned, card.base);
      if (counts.total <= 0) continue;
      const value = cardValue(counts, card, set.prices);
      const highlight = (amount: number): CardHighlight => ({
        setKey: set.setKey,
        base: card.base,
        name: card.name,
        subtitle: card.subtitle,
        amount,
      });
      out.copies += counts.total;
      out.cards += 1;
      out.value += value;
      if (counts.total > (out.mostCopies?.amount ?? 0)) out.mostCopies = highlight(counts.total);
      if (value > (out.mostValuable?.amount ?? 0)) out.mostValuable = highlight(value);
    }
  }
  return out;
}
