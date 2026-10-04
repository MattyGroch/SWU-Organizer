// Shared catalog logic for the v2 data pipeline.
//
// Used by fetch-catalog.mjs, fetch-catalog-prices.mjs, validate-catalog.mjs, and
// build-scan-index.mjs so that base-number resolution and variant naming are defined
// exactly once. Pure functions only — no I/O, no network.

/**
 * Canonical variant slugs, in the order the UI presents them. The index in this array
 * is the digit hotkey (1-based): 1 normal, 2 foil, 3 hyperspace, 4 hyperspace-foil,
 * 5 prestige, 6 prestige-foil, 7 prestige-serialized, 8 showcase.
 */
export const VARIANTS = [
  'normal',
  'foil',
  'hyperspace',
  'hyperspace-foil',
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

/** Deterministic — the CDN serves JPEG bytes under a `.png` path. */
export function artUrl(setKey, printingNumber) {
  return `https://cdn.swu-db.com/images/cards/${setKey}/${printingNumber}.png`;
}

export function backArtUrl(setKey, printingNumber) {
  return `https://cdn.swu-db.com/images/cards/${setKey}/${printingNumber}-b.png`;
}

const variantOrder = new Map(VARIANTS.map((slug, index) => [slug, index]));

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

/** `{ "059": 0.05, "059F": 0.10 }` — keyed by string printing number, not base number. */
export function buildPriceTable(rawCards) {
  const prices = {};
  for (const raw of rawCards) {
    if (isToken(raw)) continue;
    // For a foil printing the upstream `MarketPrice` is already that foil's price.
    const price = Number(raw.MarketPrice);
    if (Number.isFinite(price) && price > 0) prices[String(raw.Number).trim()] = price;
  }
  return prices;
}
