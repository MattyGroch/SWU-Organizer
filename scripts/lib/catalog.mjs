// Shared catalog logic for the v2 data pipeline.
//
// Used by fetch-catalog.mjs, fetch-catalog-prices.mjs, validate-catalog.mjs, and
// build-scan-index.mjs so that base-number resolution and variant naming are defined
// exactly once. Pure functions only — no I/O, no network.

/**
 * Canonical variant slugs, in the order the UI presents them — value order, least to
 * most (the app's VARIANTS; hotkeys are defined there separately). `promo`/`promo-foil`
 * are the weekly-play OP promos, attached to their base set's cards.
 */
export const VARIANTS = [
  'normal',
  'foil',
  'hyperspace',
  'promo',
  'hyperspace-foil',
  'promo-foil',
  'prestige',
  'prestige-foil',
  'prestige-serialized',
  'showcase',
];

/**
 * Upstream `VariantType` display strings → canonical slug.
 * HMW labels its serialized prestige run plain `Serialized`; every other set that has
 * the run calls it `Prestige Serialized`. They are the same product, so they normalize
 * together (verified across all 11 sets).
 */
const VARIANT_BY_API_NAME = new Map([
  ['Normal', 'normal'],
  ['Foil', 'foil'],
  ['Hyperspace', 'hyperspace'],
  ['Hyperspace Foil', 'hyperspace-foil'],
  ['Prestige', 'prestige'],
  ['Prestige Foil', 'prestige-foil'],
  ['Prestige Serialized', 'prestige-serialized'],
  ['Serialized', 'prestige-serialized'],
  ['Showcase', 'showcase'],
  ['OP Promo', 'promo'],
  ['OP Promo Foil', 'promo-foil'],
]);

/**
 * Decomposition used by the scanner: a camera can read `treatment` but never `finish`.
 *
 * `hasArt` is separate because the two questions differ. The `*-foil` SKUs duplicate a
 * sibling's picture and 404 on the CDN. Showcase is also foil — it has no separate foil
 * SKU precisely because every Showcase card is foil — but its artwork is unique and does
 * exist, so the scan index must include it.
 *
 * Must stay in step with VARIANT_AXES in app/src/domain/catalog.ts.
 */
const VARIANT_AXES = {
  normal: { treatment: 'normal', finish: 'plain', hasArt: true },
  foil: { treatment: 'normal', finish: 'foil', hasArt: false },
  hyperspace: { treatment: 'hyperspace', finish: 'plain', hasArt: true },
  'hyperspace-foil': { treatment: 'hyperspace', finish: 'foil', hasArt: false },
  promo: { treatment: 'promo', finish: 'plain', hasArt: true },
  // Newer sets publish a picture for promo foils too, but it is the promo's own art.
  'promo-foil': { treatment: 'promo', finish: 'foil', hasArt: false },
  prestige: { treatment: 'prestige', finish: 'plain', hasArt: true },
  'prestige-foil': { treatment: 'prestige', finish: 'foil', hasArt: false },
  'prestige-serialized': { treatment: 'prestige', finish: 'serialized', hasArt: true },
  showcase: { treatment: 'showcase', finish: 'foil', hasArt: true },
};

export function variantSlug(apiVariantType) {
  const slug = VARIANT_BY_API_NAME.get(String(apiVariantType ?? '').trim());
  if (!slug) throw new Error(`Unknown VariantType: ${JSON.stringify(apiVariantType)}`);
  return slug;
}

export function variantAxes(slug) {
  const axes = VARIANT_AXES[slug];
  if (!axes) throw new Error(`Unknown variant slug: ${slug}`);
  return axes;
}

/** True when this printing has artwork of its own on the CDN (see VARIANT_AXES). */
export function hasOwnArtwork(slug) {
  return variantAxes(slug).hasArt;
}

/**
 * Tokens (`T01`, `Token Unit`, `Force Token`, …) are play aids, not collectible binder
 * slots. The legacy pipeline dropped them as a side effect of `Number(c.Number)` going
 * NaN; here it is deliberate so the intent survives a refactor.
 */
export function isToken(raw) {
  const number = String(raw?.Number ?? '').trim();
  const type = String(raw?.Type ?? '').trim();
  return /^T\d+$/i.test(number) || type.includes('Token');
}

/**
 * Numeric value of a printing number. Foils in SOR-era sets carry an `F` suffix
 * (`"059F"`); LOF-era sets number them as plain integers (`644`). Both resolve to the
 * leading digits.
 */
export function numericPart(printingNumber) {
  const match = /^(\d+)/.exec(String(printingNumber).trim());
  if (!match) throw new Error(`Printing number has no numeric part: ${printingNumber}`);
  return Number(match[1]);
}

/** Group key for "same card, different printing" — matches the legacy `keyNameType`. */
export function cardKey(raw) {
  const name = String(raw.Name ?? '')
    .trim()
    .toLowerCase();
  const subtitle = String(raw.Subtitle ?? '')
    .trim()
    .toLowerCase();
  const type = String(raw.Type ?? '')
    .trim()
    .toLowerCase();
  return `${name}|${subtitle}|${type}`;
}

/**
 * Base (canonical) number for a group of printings: the lowest numeric part.
 *
 * Verified across all 11 sets to be identical to the legacy algorithm (lowest
 * integer-parseable `Number`), which is what existing saved inventories are keyed by.
 * Changing this silently re-points a user's collection, so `validate-catalog.mjs`
 * re-asserts it on every run.
 */
export function resolveBaseNumber(printings) {
  if (!printings.length) throw new Error('Cannot resolve a base number from zero printings');
  return Math.min(...printings.map((p) => numericPart(p.Number)));
}

function normalizeRarity(value) {
  const raw = typeof value === 'string' ? value : (value?.Name ?? '');
  const text = String(raw).trim();
  const key = text.toLowerCase();
  const map = {
    c: 'Common',
    common: 'Common',
    u: 'Uncommon',
    uncommon: 'Uncommon',
    r: 'Rare',
    rare: 'Rare',
    l: 'Legendary',
    legendary: 'Legendary',
    s: 'Special',
    special: 'Special',
    starter: 'Special',
    'starter deck exclusive': 'Special',
    'starter deck-exclusive': 'Special',
  };
  return map[key] ?? text ?? undefined;
}

function normalizeType(value) {
  const raw = typeof value === 'string' ? value : (value?.Name ?? '');
  return String(raw).trim() || undefined;
}

/**
 * A promo printing's catalog number names its promo set — `SOROP-015` — because the bare
 * number collides with the base set's own, and the picture lives under the promo code.
 */
export function promoNumber(promoSet, number) {
  return `${promoSet}-${String(number).trim()}`;
}

/** `{ set, number }` for a promo printing number, else undefined. */
export function promoParts(printingNumber) {
  const match = /^([A-Z0-9]+)-(.+)$/.exec(String(printingNumber));
  return match ? { set: match[1], number: match[2] } : undefined;
}

/** Deterministic — the CDN serves JPEG bytes under a `.png` path. */
export function artUrl(setKey, printingNumber) {
  const promo = promoParts(printingNumber);
  if (promo) return `https://cdn.swu-db.com/images/cards/${promo.set}/${promo.number}.png`;
  return `https://cdn.swu-db.com/images/cards/${setKey}/${printingNumber}.png`;
}

export function backArtUrl(setKey, printingNumber) {
  return `https://cdn.swu-db.com/images/cards/${setKey}/${printingNumber}-b.png`;
}

const variantOrder = new Map(VARIANTS.map((slug, index) => [slug, index]));

function stringList(value) {
  return Array.isArray(value)
    ? value.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim())
    : [];
}

/** Front text, epic action and a leader's back, one per line — what a deck search reads. */
function rulesText(raw) {
  return [raw.FrontText, raw.EpicAction, raw.BackText]
    .map((t) => String(t ?? '').trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * Build the v2 card-centric catalog for one set.
 *
 * `rawCards` is the upstream `data` array, with any `card-overrides.json` fields already
 * merged in — overrides may correct `Subtitle`, which is part of the group key, so they
 * must be applied before grouping.
 */
export function buildSetCatalog(setKey, rawCards) {
  const groups = new Map();

  for (const raw of rawCards) {
    if (isToken(raw)) continue;
    const name = String(raw.Name ?? '').trim();
    if (!name) continue;
    const key = cardKey(raw);
    const group = groups.get(key) ?? [];
    group.push(raw);
    groups.set(key, group);
  }

  const cards = [];
  for (const printings of groups.values()) {
    const base = resolveBaseNumber(printings);
    // The representative carries the shared card identity. Prefer the Normal printing at
    // the base number: alternate treatments occasionally differ in incidental metadata.
    const representative =
      printings.find((p) => p.VariantType === 'Normal' && numericPart(p.Number) === base) ??
      printings[0];

    const subtitle = String(representative.Subtitle ?? '').trim();
    const aspects = Array.isArray(representative.Aspects)
      ? representative.Aspects.filter((a) => typeof a === 'string')
      : [];

    // Built in display order so committed diffs stay readable in review.
    const card = { base, name: String(representative.Name).trim() };
    if (subtitle) card.subtitle = subtitle;
    card.type = normalizeType(representative.Type);
    card.rarity = normalizeRarity(representative.Rarity);
    card.aspects = aspects;
    if (representative.Unique === true) card.unique = true;
    if (representative.DoubleSided === true) card.doubleSided = true;
    const maxCopies = Number(representative.MaxCopies);
    if (Number.isFinite(maxCopies) && maxCopies > 0) card.maxCopies = maxCopies;
    // Deck-building stats. Bases print no cost or power; a leader's cost is to deploy it.
    for (const [field, from] of [
      ['cost', 'Cost'],
      ['power', 'Power'],
      ['hp', 'HP'],
    ]) {
      const raw = String(representative[from] ?? '').trim();
      // An upgrade's power and HP are bonuses, and can be negative (Kill Switch: -1/-1).
      if (/^[-+]?\d+$/.test(raw)) card[field] = Number(raw);
    }
    const arenas = stringList(representative.Arenas);
    if (arenas.length) card.arenas = arenas;
    const traits = stringList(representative.Traits);
    if (traits.length) card.traits = traits;
    const text = rulesText(representative);
    if (text) card.text = text;
    card.printings = printings
      .map((p) => ({ num: String(p.Number).trim(), variant: variantSlug(p.VariantType) }))
      .sort(
        (a, b) =>
          (variantOrder.get(a.variant) ?? 99) - (variantOrder.get(b.variant) ?? 99) ||
          a.num.localeCompare(b.num),
      );

    cards.push(card);
  }

  cards.sort((a, b) => a.base - b.base);
  return { version: 2, setKey, cards };
}

/**
 * Attaches a weekly-play promo set's rows (`SOROP`) to the base set's cards as `promo` /
 * `promo-foil` printings. Promo rows carry no base number, so they match by name and
 * subtitle (and type), falling back to the name alone when it is unique in the set.
 * Returns the rows that matched nothing — the caller fails on those rather than drop them.
 */
export function attachPromos(catalog, promoSet, promoRows) {
  return attachPromoRows([catalog], promoSet, promoRows, {
    variantOf: (raw) => variantSlug(raw.VariantType),
  }).unmatched;
}

/**
 * Promo sets beyond the weekly OP ones: event, judge, prerelease, convention, gift box,
 * Store Showdown and retail promos (`P26`, `G25`, `SOROPJ`, …). Every set `GET /sets`
 * lists that is neither a main set (`mainKeys`) nor a weekly OP set, and that is either a
 * child of a set or named like a promo product — so a new main set such as `IC27` stays
 * out until it is configured as a set of its own.
 */
export function isEventPromoSet(row, mainKeys) {
  const id = String(row?.setId ?? '')
    .trim()
    .toUpperCase();
  const name = String(row?.fullName ?? '').trim();
  if (!id || mainKeys.has(id)) return false;
  if (/- OP Promo$/i.test(name)) return false;
  const hasParent = String(row?.parentSetId ?? '').trim() !== '';
  return (
    hasParent ||
    /promo|judge|exclusive|gift box|showdown|gamegenic|qualifier|prerelease/i.test(name)
  );
}

/**
 * Event promo sets label each printing by how it was given out (`Store Showdown Judge`,
 * `GC Prize Wall Foil`, `Gift Box`), not by treatment. They are all promos of the card;
 * the foil ones (and Showcase, which is always foil) are Promo Foil.
 */
export function eventPromoVariant(apiVariantType) {
  return /foil|showcase/i.test(String(apiVariantType ?? '')) ? 'promo-foil' : 'promo';
}

/**
 * Attaches an event promo set's rows to whichever set's card they reprint. These sets
 * span every main set (`P26` holds ASH's Hera and LOF's Obi-Wan alike), so every catalog
 * is searched, earliest first: a card reprinted in a later set keeps its promos on the
 * original. The name-only fallback also requires the type to agree, since it looks across
 * every set. Returns the unmatched rows and the set keys that gained printings.
 */
export function attachEventPromos(catalogs, promoSet, promoRows) {
  return attachPromoRows(catalogs, promoSet, promoRows, {
    variantOf: (raw) => eventPromoVariant(raw.VariantType),
    fallbackByType: true,
  });
}

function attachPromoRows(catalogs, promoSet, promoRows, { variantOf, fallbackByType = false }) {
  const norm = (value) =>
    String(value ?? '')
      .trim()
      .toLowerCase();
  const byKey = new Map();
  const byName = new Map();
  for (const catalog of catalogs) {
    for (const card of catalog.cards) {
      const entry = { catalog, card };
      const key = `${norm(card.name)}|${norm(card.subtitle)}|${norm(card.type)}`;
      if (!byKey.has(key)) byKey.set(key, entry);
      byName.set(norm(card.name), [...(byName.get(norm(card.name)) ?? []), entry]);
    }
  }
  const unmatched = [];
  const touched = new Set();
  for (const raw of promoRows) {
    if (isToken(raw)) continue;
    const key = `${norm(raw.Name)}|${norm(raw.Subtitle)}|${norm(normalizeType(raw.Type))}`;
    const type = norm(normalizeType(raw.Type));
    const named = (byName.get(norm(raw.Name)) ?? []).filter(
      ({ card }) => !fallbackByType || norm(card.type) === type,
    );
    const found = byKey.get(key) ?? (named.length === 1 ? named[0] : undefined);
    if (!found) {
      unmatched.push(
        `${promoSet} ${raw.Number} ${raw.Name}${raw.Subtitle ? ` — ${raw.Subtitle}` : ''}`,
      );
      continue;
    }
    const { catalog, card } = found;
    const num = promoNumber(promoSet, raw.Number);
    if (card.printings.some((p) => p.num === num)) continue;
    card.printings.push({ num, variant: variantOf(raw) });
    card.printings.sort(
      (a, b) =>
        (variantOrder.get(a.variant) ?? 99) - (variantOrder.get(b.variant) ?? 99) ||
        a.num.localeCompare(b.num),
    );
    touched.add(catalog.setKey);
  }
  return { unmatched, touched };
}

/** `{ "059": 0.05, "059F": 0.10 }` — keyed by string printing number, not base number. */
export function buildPriceTable(rawCards, promoSet) {
  const prices = {};
  for (const raw of rawCards) {
    if (isToken(raw)) continue;
    // For a foil printing the upstream `MarketPrice` is already that foil's price.
    const price = Number(raw.MarketPrice);
    const num = promoSet ? promoNumber(promoSet, raw.Number) : String(raw.Number).trim();
    if (Number.isFinite(price) && price > 0) prices[num] = price;
  }
  return prices;
}
