import {
  isFoilPrinting,
  variantAxes,
  type CatalogCard,
  type Printing,
  type Treatment,
} from './catalog';
import type { OwnedCounts } from './ownership';

/**
 * Which printing's artwork represents a binder slot.
 *
 * A slot holds one card but possibly several printings, and they do not look alike:
 * Hyperspace is the same art borderless, Prestige is different art entirely, Showcase is
 * different again. Showing the most premium copy you actually own makes the binder read
 * like the binder.
 *
 * Foil printings are never chosen as the art source — they share their non-foil sibling's
 * artwork and have no image on the CDN at all (a foil URL 404s). Owning only the foil
 * still shows that treatment, via the sibling.
 */

const TREATMENT_RANK: Record<Treatment, number> = {
  normal: 0,
  hyperspace: 1,
  showcase: 2,
  prestige: 3,
};

/**
 * True when this printing has artwork of its own on the CDN.
 *
 * Distinct from "is not foil": Showcase is foil but has unique art, while the `*-foil`
 * SKUs reuse a sibling's picture and 404.
 */
export function hasOwnArtwork(printing: Printing): boolean {
  return variantAxes(printing.variant).hasArt;
}

/**
 * Card types printed in landscape: Leaders and Bases.
 *
 * Verified against the CDN — these are 1560x1117, every other type is 1120x1560. Binder
 * pockets are portrait, so these cards get turned 90° counter-clockwise to fit, and the
 * app renders them the same way round as they physically sit in the pages.
 *
 * A Leader's *back* (its deployed side) is portrait, but only fronts are ever shown.
 */
export function isLandscapeArt(type: string | undefined): boolean {
  const normalized = (type ?? '').trim().toLowerCase();
  return normalized === 'leader' || normalized === 'base';
}

export type ArtChoice = {
  printing: Printing;
  /** False when you own none of this card — the caller renders it greyscale. */
  owned: boolean;
  /**
   * True when any copy owned is a foil.
   *
   * Foil and non-foil share identical artwork, so the finish cannot be shown by picking a
   * different image — it is marked with a sparkle over the art instead, the convention
   * most card sites use.
   */
  foil: boolean;
};

/** Does any owned printing of this card have a foil finish? */
function ownsFoil(card: CatalogCard, counts: OwnedCounts): boolean {
  return card.printings.some(
    (p) => (counts.byVariant[p.variant] ?? 0) > 0 && isFoilPrinting(p.variant),
  );
}

export function selectArtPrinting(card: CatalogCard, counts: OwnedCounts): ArtChoice {
  const fallback =
    card.printings.find((p) => p.variant === 'normal') ??
    card.printings.find(hasOwnArtwork) ??
    card.printings[0]!;

  if (counts.total <= 0) return { printing: fallback, owned: false, foil: false };

  let bestRank = -1;
  let bestTreatment: Treatment | undefined;

  for (const printing of card.printings) {
    if ((counts.byVariant[printing.variant] ?? 0) <= 0) continue;
    const { treatment } = variantAxes(printing.variant);
    const rank = TREATMENT_RANK[treatment];
    if (rank > bestRank) {
      bestRank = rank;
      bestTreatment = treatment;
    }
  }

  const foil = ownsFoil(card, counts);
  if (bestTreatment === undefined) return { printing: fallback, owned: true, foil };

  // Within the winning treatment, take a printing that actually has artwork. Prefer one
  // you own (a Serialized copy shows its own stamped art), else the plain sibling.
  const candidates = card.printings.filter(
    (p) => variantAxes(p.variant).treatment === bestTreatment && hasOwnArtwork(p),
  );
  const ownedCandidate = candidates.find((p) => (counts.byVariant[p.variant] ?? 0) > 0);

  return { printing: ownedCandidate ?? candidates[0] ?? fallback, owned: true, foil };
}
