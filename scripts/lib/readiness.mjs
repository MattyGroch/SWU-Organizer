import { artUrl, backArtUrl, hasOwnArtwork, numericPart, promoParts } from './catalog.mjs';

/**
 * Whether a set is ready to join the catalog.
 *
 * During a prerelease window swu-db can list a set — and some of its cards — days before
 * its art reaches the CDN, or before every card is spoiled. A set that joined then would
 * show text-only binder pockets, and the scanner could not know its cards. So a set new
 * to the catalog waits until its data is complete and every picture is published.
 */

/**
 * Every picture a set needs: each printing with art of its own, and the back of each
 * double-sided card's printings (Leaders).
 * @param {{ setKey: string, cards: Array<{ doubleSided?: boolean, printings: Array<{ num: string, variant: string }> }> }} catalog
 * @returns {string[]}
 */
export function requiredArt(catalog) {
  const urls = [];
  for (const card of catalog.cards) {
    for (const printing of card.printings) {
      // Weekly-play promos arrive on their own schedule; they never hold a set back.
      if (promoParts(printing.num)) continue;
      if (!hasOwnArtwork(printing.variant)) continue;
      urls.push(artUrl(catalog.setKey, printing.num));
      if (card.doubleSided) urls.push(backArtUrl(catalog.setKey, printing.num));
    }
  }
  return urls;
}

/**
 * The collector numbers missing from a set's main run: swu-db's `numberCards` is the run's
 * length (#1 to #N — variants are numbered past it), so any gap is a card not yet
 * published. An unknown total proves nothing either way: data is then judged by art alone.
 * @param {{ cards: Array<{ printings: Array<{ num: string }> }> }} catalog
 * @param {number | undefined} listed
 * @returns {number[]}
 */
export function missingNumbers(catalog, listed) {
  if (!Number.isFinite(listed) || !listed) return [];
  const present = new Set();
  for (const card of catalog.cards) {
    for (const printing of card.printings) {
      if (!promoParts(printing.num)) present.add(numericPart(printing.num));
    }
  }
  const missing = [];
  for (let n = 1; n <= listed; n++) if (!present.has(n)) missing.push(n);
  return missing;
}
