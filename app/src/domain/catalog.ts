import type { CanonicalCatalog } from './inventory';
import type { Card, SetKey } from './types';

/**
 * Canonical printing variants, in presentation order — which is also value order, least
 * to most: Normal, Foil, Hyperspace, Promo, Hyperspace Foil, Promo Foil, Prestige, Prestige
 * Foil, then Serialized and Showcase (equal; Serialized listed first). Promos are the
 * weekly-play OP promos, treated as printings of the base set's card.
 *
 * Must stay in step with `scripts/lib/catalog.mjs`, which writes these slugs into the
 * catalog JSON. `parseSetCatalog` throws on an unrecognized slug rather than silently
 * dropping a printing, so drift fails loudly instead of losing cards.
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
] as const;

export type VariantSlug = (typeof VARIANTS)[number];

/** What a camera can read off the card. */
export type Treatment = 'normal' | 'hyperspace' | 'promo' | 'prestige' | 'showcase';
/** What a camera cannot read: identical art, different stock. */
export type Finish = 'plain' | 'foil' | 'serialized';

/**
 * `hasArt` is tracked separately from `finish` because the two are not the same question.
 *
 * The three `*-foil` SKUs are duplicates of another variant's picture and 404 on the CDN,
 * so they have no art of their own. Showcase is *also* foil — it has no separate foil SKU
 * precisely because every Showcase card is foil, which the catalog corroborates: Normal,
 * Hyperspace and Prestige each have a foil sibling and Showcase does not — but it is
 * printed with unique artwork that does exist on the CDN.
 */
const VARIANT_AXES: Record<VariantSlug, { treatment: Treatment; finish: Finish; hasArt: boolean }> =
  {
    normal: { treatment: 'normal', finish: 'plain', hasArt: true },
    foil: { treatment: 'normal', finish: 'foil', hasArt: false },
    hyperspace: { treatment: 'hyperspace', finish: 'plain', hasArt: true },
    'hyperspace-foil': { treatment: 'hyperspace', finish: 'foil', hasArt: false },
    promo: { treatment: 'promo', finish: 'plain', hasArt: true },
    'promo-foil': { treatment: 'promo', finish: 'foil', hasArt: false },
    prestige: { treatment: 'prestige', finish: 'plain', hasArt: true },
    'prestige-foil': { treatment: 'prestige', finish: 'foil', hasArt: false },
    'prestige-serialized': { treatment: 'prestige', finish: 'serialized', hasArt: true },
    showcase: { treatment: 'showcase', finish: 'foil', hasArt: true },
  };

const VARIANT_LABELS: Record<VariantSlug, string> = {
  normal: 'Normal',
  foil: 'Foil',
  hyperspace: 'Hyperspace',
  'hyperspace-foil': 'Hyperspace Foil',
  promo: 'Promo',
  'promo-foil': 'Promo Foil',
  prestige: 'Prestige',
  'prestige-foil': 'Prestige Foil',
  'prestige-serialized': 'Prestige Serialized',
  showcase: 'Showcase',
};

/** Compact labels for tight controls, e.g. the intake allocation buttons. */
const VARIANT_SHORT_LABELS: Record<VariantSlug, string> = {
  normal: 'N',
  foil: 'F',
  hyperspace: 'H',
  'hyperspace-foil': 'HF',
  promo: 'OP',
  'promo-foil': 'OPF',
  prestige: 'P',
  'prestige-foil': 'PF',
  'prestige-serialized': 'PS',
  showcase: 'S',
};

const VARIANT_SET = new Set<string>(VARIANTS);

export function isVariantSlug(value: unknown): value is VariantSlug {
  return typeof value === 'string' && VARIANT_SET.has(value);
}

export function variantAxes(slug: VariantSlug) {
  return VARIANT_AXES[slug];
}

/**
 * Is this printing on foil stock? Serialized is its own finish — the stamp sets it apart
 * — but every Prestige Serialized is also foil, like every Showcase.
 */
export function isFoilPrinting(slug: VariantSlug): boolean {
  return VARIANT_AXES[slug].finish !== 'plain';
}

/**
 * The same printing on the other stock: Normal ⇄ Foil, Hyperspace ⇄ Hyperspace Foil,
 * Promo ⇄ Promo Foil, Prestige ⇄ Prestige Foil. Undefined when there is none — Showcase
 * and Serialized come only as they are, and not every card was printed in foil.
 */
export function finishCounterpart<P extends { variant: VariantSlug }>(
  printings: readonly P[],
  variant: VariantSlug,
): P | undefined {
  const { treatment, finish } = VARIANT_AXES[variant];
  if (finish === 'serialized') return undefined;
  const wanted: Finish = finish === 'plain' ? 'foil' : 'plain';
  return printings.find((p) => {
    const axes = VARIANT_AXES[p.variant];
    return axes.treatment === treatment && axes.finish === wanted;
  });
}

/**
 * The printing number whose picture shows this printing. A foil SKU has no picture of its
 * own (its URL 404s), so it borrows its plain counterpart's — the same art on other stock.
 */
export function artNumber(printings: readonly Printing[], printing: Printing): string {
  if (VARIANT_AXES[printing.variant].hasArt) return printing.num;
  return finishCounterpart(printings, printing.variant)?.num ?? printing.num;
}

export function variantLabel(slug: VariantSlug): string {
  return VARIANT_LABELS[slug];
}

export function variantShortLabel(slug: VariantSlug): string {
  return VARIANT_SHORT_LABELS[slug];
}

/**
 * Digit hotkeys. 1–8 keep the keys they had before promos existed (muscle memory); the
 * promos take 9 and 0, together at the end of the row.
 */
const HOTKEYS: Record<VariantSlug, number> = {
  normal: 1,
  foil: 2,
  hyperspace: 3,
  'hyperspace-foil': 4,
  prestige: 5,
  'prestige-foil': 6,
  'prestige-serialized': 7,
  showcase: 8,
  promo: 9,
  'promo-foil': 0,
};

/** Variants in hotkey order, 1 to 9 then 0 — the order the shortcuts help lists them. */
export const VARIANTS_BY_HOTKEY: readonly VariantSlug[] = [...VARIANTS].sort(
  (a, b) => ((HOTKEYS[a] + 9) % 10) - ((HOTKEYS[b] + 9) % 10),
);

export function variantHotkey(slug: VariantSlug): number {
  return HOTKEYS[slug];
}

export function variantForHotkey(digit: number): VariantSlug | undefined {
  return VARIANTS.find((slug) => HOTKEYS[slug] === digit);
}

/**
 * Numeric value of a printing number. SOR-era foils carry an `F` suffix (`"059F"`);
 * LOF-era sets number them as plain integers (`644`). Both resolve to the leading digits.
 */
export function numericPart(printingNumber: string): number {
  const match = /^(\d+)/.exec(printingNumber.trim());
  if (!match?.[1]) throw new Error(`Printing number has no numeric part: ${printingNumber}`);
  return Number(match[1]);
}

/**
 * Deterministic art path, served same-origin.
 *
 * The upstream CDN (`cdn.swu-db.com`) is an S3 bucket with no CORS headers, so fetching
 * it directly from the browser fails and the canvas could not read it even if it did not.
 * Both dev (vite proxy) and production (nginx) map `/card-art` onto it.
 *
 * The path ends `.png` but the bytes are JPEG.
 */
export function artUrl(setKey: SetKey, printingNumber: string): string {
  const promo = promoParts(printingNumber);
  return promo
    ? `/card-art/${promo.set}/${promo.number}.png`
    : `/card-art/${setKey}/${printingNumber}.png`;
}

/**
 * A promo printing's number names the promo set it comes from — `SOROP-015`, `HMWP-14` —
 * because the number alone collides with the base set's own (`015`), and the art lives
 * under the promo set's code on the CDN.
 */
export function promoParts(printingNumber: string): { set: string; number: string } | undefined {
  const match = /^([A-Z0-9]+)-(.+)$/.exec(printingNumber);
  return match ? { set: match[1]!, number: match[2]! } : undefined;
}

export type Printing = { num: string; variant: VariantSlug };

export type CatalogCard = {
  base: number;
  name: string;
  subtitle?: string;
  type?: string;
  rarity?: string;
  aspects: string[];
  unique?: boolean;
  doubleSided?: boolean;
  maxCopies?: number;
  printings: Printing[];
};

export type SetCatalog = {
  setKey: SetKey;
  label: string;
  cards: CatalogCard[];
};

export type SetManifestEntry = {
  key: SetKey;
  label: string;
  file: string;
  cards: number;
  printings: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function parseSetManifest(payload: unknown): SetManifestEntry[] {
  if (!isRecord(payload) || !Array.isArray(payload.sets)) {
    throw new Error('Invalid set manifest payload.');
  }
  return payload.sets.filter(
    (entry): entry is SetManifestEntry =>
      isRecord(entry) && typeof entry.key === 'string' && typeof entry.file === 'string',
  );
}

export function parseSetCatalog(payload: unknown): SetCatalog {
  if (!isRecord(payload) || typeof payload.setKey !== 'string' || !Array.isArray(payload.cards)) {
    throw new Error('Invalid set catalog payload.');
  }

  const cards: CatalogCard[] = [];
  for (const raw of payload.cards) {
    if (!isRecord(raw)) continue;
    const base = Number(raw.base);
    const name = typeof raw.name === 'string' ? raw.name : '';
    if (!Number.isInteger(base) || base <= 0 || !name) continue;

    const printings: Printing[] = [];
    for (const p of Array.isArray(raw.printings) ? raw.printings : []) {
      if (!isRecord(p) || typeof p.num !== 'string') continue;
      if (!isVariantSlug(p.variant)) {
        // Loud on purpose: a new upstream variant must be taught to the app, not dropped.
        throw new Error(`Unknown variant "${String(p.variant)}" on ${payload.setKey}#${base}`);
      }
      printings.push({ num: p.num, variant: p.variant });
    }
    if (!printings.length) continue;

    cards.push({
      base,
      name,
      subtitle: typeof raw.subtitle === 'string' ? raw.subtitle : undefined,
      type: typeof raw.type === 'string' ? raw.type : undefined,
      rarity: typeof raw.rarity === 'string' ? raw.rarity : undefined,
      aspects: Array.isArray(raw.aspects) ? raw.aspects.filter((a) => typeof a === 'string') : [],
      unique: raw.unique === true ? true : undefined,
      doubleSided: raw.doubleSided === true ? true : undefined,
      maxCopies: Number.isFinite(Number(raw.maxCopies)) ? Number(raw.maxCopies) : undefined,
      printings,
    });
  }

  cards.sort((a, b) => a.base - b.base);
  return {
    setKey: payload.setKey,
    label: typeof payload.label === 'string' ? payload.label : payload.setKey,
    cards,
  };
}

export function parsePriceTable(payload: unknown): Map<string, number> {
  const prices = new Map<string, number>();
  if (!isRecord(payload) || !isRecord(payload.prices)) return prices;
  for (const [num, value] of Object.entries(payload.prices)) {
    const price = Number(value);
    if (Number.isFinite(price)) prices.set(num, price);
  }
  return prices;
}

/**
 * A set in the shape the app consumes.
 *
 * `baseCards` is deliberately the legacy `Card` shape: every ported domain module
 * (search, decklist, deckContents, pickList) already speaks it, and keeping it means
 * those modules — and their 153 unchanged tests — carry over untouched. Variant data
 * rides alongside in the printing maps rather than reshaping card identity.
 */
export type LoadedSet = {
  setKey: SetKey;
  label: string;
  baseCards: Card[];
  byNumber: Map<number, Card>;
  cardsByBase: Map<number, CatalogCard>;
  /** Base number → its printings, in hotkey order. */
  printingsByBase: Map<number, Printing[]>;
  /** Printing number → the base card it belongs to. */
  baseByPrinting: Map<string, number>;
  /** Printing number → market price. */
  prices: Map<string, number>;
};

/**
 * Price shown for a base card: the Normal printing's price, matching the legacy app.
 * Variant-aware valuation (Phase 3) sums each owned printing at its own price instead.
 */
function basePrice(card: CatalogCard, prices: Map<string, number>): number {
  const normal = card.printings.find((p) => p.variant === 'normal') ?? card.printings[0];
  return (normal && prices.get(normal.num)) ?? 0;
}

export function toLoadedSet(catalog: SetCatalog, prices: Map<string, number>): LoadedSet {
  const baseCards: Card[] = [];
  const cardsByBase = new Map<number, CatalogCard>();
  const printingsByBase = new Map<number, Printing[]>();
  const baseByPrinting = new Map<string, number>();

  for (const card of catalog.cards) {
    cardsByBase.set(card.base, card);
    printingsByBase.set(card.base, card.printings);
    for (const printing of card.printings) baseByPrinting.set(printing.num, card.base);

    baseCards.push({
      Name: card.name,
      Subtitle: card.subtitle,
      Number: card.base,
      Aspects: card.aspects,
      Type: card.type,
      Rarity: card.rarity,
      MarketPrice: basePrice(card, prices),
      MaxCopies: card.maxCopies,
      Set: catalog.setKey,
    });
  }

  return {
    setKey: catalog.setKey,
    label: catalog.label,
    baseCards,
    byNumber: new Map(baseCards.map((c) => [c.Number, c])),
    cardsByBase,
    printingsByBase,
    baseByPrinting,
    prices,
  };
}

/**
 * The `CanonicalCatalog` shape `decklist.ts` and `inventory.ts` expect: every printing
 * number mapped to the base card it belongs to.
 *
 * Built from the loaded sets rather than stored, so the decklist resolver keeps working
 * unchanged against the new catalog. Suffixed foils collapse onto their sibling's numeric
 * value ("059F" → 59), which is harmless here because both resolve to the same base.
 */
export function toCanonicalCatalog(sets: Iterable<LoadedSet>): CanonicalCatalog {
  const catalog: CanonicalCatalog = new Map();

  for (const set of sets) {
    for (const card of set.cardsByBase.values()) {
      for (const printing of card.printings) {
        // A promo is filed under its own set code (`SOROP:15`), pointing at the base card.
        const promo = promoParts(printing.num);
        const code = promo?.set ?? set.setKey;
        const number = numericPart(promo?.number ?? printing.num);
        catalog.set(`${code}:${number}`, {
          setKey: set.setKey,
          printingNumber: number,
          baseNumber: card.base,
          type: card.type,
          maxCopies: card.maxCopies,
        });
      }
    }
  }

  return catalog;
}

/**
 * Numeric printing maps for `buildSearchSuggestions`, which predates string printing
 * numbers. Suffixed foils collapse onto their sibling's number ("059F" → 59), which is
 * what search should show anyway — the suggestion list names printings, not finishes.
 */
export function toSearchCatalog(set: LoadedSet) {
  const printingNumbersByBase = new Map<number, number[]>();
  const baseByPrintingNumber = new Map<number, number>();

  for (const [base, printings] of set.printingsByBase) {
    // Promo numbers belong to the promo set's own run, so they are left out: SOR #15 and
    // SOROP #15 are different cards.
    const numbers = [
      ...new Set(printings.filter((p) => !promoParts(p.num)).map((p) => numericPart(p.num))),
    ].sort((a, b) => a - b);
    printingNumbersByBase.set(base, numbers);
    for (const n of numbers) baseByPrintingNumber.set(n, base);
  }

  const promosByBase = new Map<number, Array<{ set: string; number: number }>>();
  for (const [base, printings] of set.printingsByBase) {
    const promos = printings.flatMap((p) => {
      const parts = promoParts(p.num);
      return parts && p.variant === 'promo'
        ? [{ set: parts.set, number: numericPart(parts.number) }]
        : [];
    });
    if (promos.length) promosByBase.set(base, promos);
  }

  return {
    setKey: set.setKey,
    cards: set.baseCards,
    printingNumbersByBase,
    baseByPrintingNumber,
    promosByBase,
  };
}
