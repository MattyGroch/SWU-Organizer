import {
  isFoilPrinting,
  printingNumbers,
  variantAxes,
  type CatalogCard,
  type Printing,
  type Treatment,
} from './catalog';
import { VALUE_ORDER, type OwnedCounts } from './ownership';

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
 * The pictures a printing can be shown with. A Promo's aliases (the same card given out
 * at another event, with another badge or art) are all candidates; anything else has one.
 */
export function promoArtOptions(printing: Printing): readonly string[] {
  return printing.variant === 'promo' ? printingNumbers(printing) : [printing.num];
}

/** The number whose picture shows `printing`: the chosen promo art when it is one of its. */
export function shownArtNumber(printing: Printing, chosen: string | undefined): string {
  return chosen && promoArtOptions(printing).includes(chosen) ? chosen : printing.num;
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
   * True when you own the shown treatment in foil.
   *
   * Foil and non-foil share identical artwork, so the finish cannot be shown by picking a
   * different image — it is painted over the art instead. A foil of another treatment
   * doesn't count: Hyperspace Foils don't make a plain Promo's art shine.
   */
  foil: boolean;
  /**
   * True when the art shown is a Prestige or Showcase you own in foil. Those are foil edge
   * to edge, text box included, where other foils keep a matte text box.
   */
  fullFoil: boolean;
};

/** Treatments whose foil printings are foil across the whole card. */
const FULL_FOIL_TREATMENTS: ReadonlySet<Treatment> = new Set(['prestige', 'showcase']);

/** Does an owned printing of this treatment have a foil finish? */
function ownsFoilOf(card: CatalogCard, counts: OwnedCounts, treatment: Treatment): boolean {
  return card.printings.some(
    (p) =>
      (counts.byVariant[p.variant] ?? 0) > 0 &&
      isFoilPrinting(p.variant) &&
      variantAxes(p.variant).treatment === treatment,
  );
}

export function selectArtPrinting(card: CatalogCard, counts: OwnedCounts): ArtChoice {
  const fallback =
    card.printings.find((p) => p.variant === 'normal') ??
    card.printings.find(hasOwnArtwork) ??
    card.printings[0]!;

  if (counts.total <= 0) {
    return { printing: fallback, owned: false, foil: false, fullFoil: false };
  }

  // The pocket shows your most valuable copy, in the order used everywhere else (pocket
  // bumps, deck pulls): a Hyperspace Foil outranks a plain Promo, a Promo Foil outranks it.
  const best = VALUE_ORDER.find((variant) =>
    card.printings.some((p) => p.variant === variant && (counts.byVariant[variant] ?? 0) > 0),
  );
  if (best === undefined) {
    return { printing: fallback, owned: true, foil: false, fullFoil: false };
  }
  const bestTreatment = variantAxes(best).treatment;
  const foil = ownsFoilOf(card, counts, bestTreatment);

  // Within the winning treatment, take a printing that actually has artwork. Prefer one
  // you own (a Serialized copy shows its own stamped art), else the plain sibling.
  const candidates = card.printings.filter(
    (p) => variantAxes(p.variant).treatment === bestTreatment && hasOwnArtwork(p),
  );
  const ownedCandidate = candidates.find((p) => (counts.byVariant[p.variant] ?? 0) > 0);

  const fullFoil = foil && FULL_FOIL_TREATMENTS.has(bestTreatment);

  return { printing: ownedCandidate ?? candidates[0] ?? fallback, owned: true, foil, fullFoil };
}
