import type { VariantSlug } from '~/domain/catalog';
import type { SetKey } from '~/domain/types';

/**
 * What's in a pack, per set, from FFG's own articles:
 *
 * - "Boosting Ahead of Release" (SOR launch odds):
 *   https://starwarsunlimited.com/articles/boosting-ahead-of-release
 * - "A Shift From What Was" (the change at A Lawless Time, with before/after tables):
 *   https://starwarsunlimited.com/articles/a-shift-from-what-was
 * - "Packs of Prestige" (Carbonite, JTL on):
 *   https://starwarsunlimited.com/articles/packs-of-prestige
 *
 * Packs changed once, at A Lawless Time (LAW), not at Jump to Lightspeed: JTL added
 * Carbonite packs and Prestige printings, but its boosters still match SOR's.
 *
 * FFG never published three things the model needs, so they are estimates and say so:
 * how often the leader is Rare rather than Common (taken as 1 in 3), what rarity the foil
 * slot leans to (worked back from its Hyperspace Foil Rare/Legendary odds), and the
 * rarity spread of a Carbonite pack's non-leader cards (about 2 Rare or Legendary in 14).
 */

export type PackPool =
  | 'common'
  | 'uncommon'
  /** Rares, and the Rare bases that share their slot. */
  | 'rare'
  | 'legendary'
  | 'leaderCommon'
  | 'leaderRare'
  | 'baseCommon';

/**
 * One kind of pull the hit table tracks, with how many a booster and a Carbonite pack
 * hold on average.
 */
export type PackHit = {
  label: string;
  variants: readonly VariantSlug[];
  /** Only non-leader cards of these rarities count; every card when absent. */
  rarities?: readonly string[];
  booster: number;
  carbonite: number;
};

/**
 * The printings a pack's Commons and Uncommons come in, plus its Prestige cards (any
 * rarity). Boosters are mostly plain Commons; a Carbonite pack has none, so the mix of
 * printings tells the two apart. Commons and Uncommons, because nobody buys them as
 * singles; Prestige, because a Carbonite pack always has one.
 */
export type PackSignal = 'normal' | 'foil' | 'hyperspace' | 'hyperspaceFoil' | 'prestige';

export const SIGNAL_VARIANTS: Readonly<Record<PackSignal, readonly VariantSlug[]>> = {
  normal: ['normal'],
  foil: ['foil'],
  hyperspace: ['hyperspace'],
  hyperspaceFoil: ['hyperspace-foil'],
  prestige: ['prestige', 'prestige-foil', 'prestige-serialized'],
};

export type PackProfile = {
  name: string;
  price: number;
  /** One line on what's in the pack, shown above the numbers. */
  summary: string;
  /** Expected cards per pack from each pool, any printing. */
  pools: Partial<Record<PackPool, number>>;
  /** Expected copies per pack of each signal. */
  signature: Readonly<Record<PackSignal, number>>;
};

export type SetPackProfiles = {
  booster: PackProfile;
  carbonite?: PackProfile;
  hits: readonly PackHit[];
};

export const BOOSTER_PRICE = 5;
export const CARBONITE_PRICE = 24;

/** Estimated: FFG doesn't publish the Rare leader rate. */
const RARE_LEADER_SHARE = 1 / 3;

const HYPERSPACE: readonly VariantSlug[] = ['hyperspace', 'hyperspace-foil'];
const PACK_PRINTINGS: readonly VariantSlug[] = [
  'normal',
  'foil',
  'hyperspace',
  'hyperspace-foil',
  'prestige',
  'prestige-foil',
  'prestige-serialized',
  'showcase',
];
const RARE_OR_LEGENDARY = ['Rare', 'Legendary'] as const;

/**
 * A 16-card booster: a leader, a base, 9 Commons, 3 Uncommons, a Rare (Legendary 1 in 8)
 * and a foil of any rarity. `foilRare` and `foilLegendary` are the foil slot's chance of
 * each, worked back from FFG's Hyperspace Foil odds; the rest of it is Commons and
 * Uncommons at the pack's own 9 : 3.
 */
function booster(foilRare: number, foilLegendary: number) {
  const foilLow = 1 - foilRare - foilLegendary;
  return {
    common: 9 + foilLow * 0.75,
    uncommon: 3 + foilLow * 0.25,
    rare: 7 / 8 + foilRare,
    legendary: 1 / 8 + foilLegendary,
    leaderCommon: 1 - RARE_LEADER_SHARE,
    leaderRare: RARE_LEADER_SHARE,
    baseCommon: 1,
  } satisfies Record<PackPool, number>;
}

/** SOR to SEC. Foil slot: a Hyperspace Foil 1 in 6, of which Rare 1 in 72, Legendary 1 in 181. */
const BEFORE_LAW_POOLS = booster((1 / 72) * 6, (1 / 181) * 6);

const BEFORE_LAW: PackProfile = {
  name: 'Booster',
  price: BOOSTER_PRICE,
  summary:
    '16 cards: a leader, a base, 9 Commons, 3 Uncommons, a Rare or Legendary (1 in 8) and a foil of any rarity. Any card can be Hyperspace.',
  pools: BEFORE_LAW_POOLS,
  // The foil slot's Common or Uncommon (88%) is a foil 5 times in 6, else a Hyperspace
  // Foil; of the other twelve, a Hyperspace Common 1 in 3 packs and the odd Uncommon.
  signature: { normal: 11.58, foil: 0.74, hyperspace: 0.42, hyperspaceFoil: 0.15, prestige: 0 },
};

/** LAW on. Foil slot: always a Hyperspace Foil, Rare 1 in 24, Legendary 1 in 96. */
const FROM_LAW_POOLS = booster(1 / 24, 1 / 96);

const FROM_LAW: PackProfile = {
  name: 'Booster',
  price: BOOSTER_PRICE,
  summary:
    '16 cards: a leader, a base, 9 Commons, 3 Uncommons, a Rare or Legendary (1 in 8) and a Hyperspace Foil of any rarity. At least one Hyperspace card besides; no plain foils.',
  pools: FROM_LAW_POOLS,
  // The Hyperspace Foil is a Common or Uncommon 95% of the time; a Hyperspace Common is
  // guaranteed, "sometimes more" taken as a tenth of a card.
  signature: { normal: 10.95, foil: 0, hyperspace: 1.05, hyperspaceFoil: 0.95, prestige: 1 / 18 },
};

/**
 * Carbonite: 16 cards, every one a special printing — a Hyperspace or Showcase leader, a
 * Prestige, and 14 foils and Hyperspace. No base. The Prestige is left out of the pools:
 * which cards have one varies, and it's one card in sixteen. Of the 14, about 12 are
 * Commons and Uncommons, in the pack's own split of printings.
 */
function carbonite(summary: string, signature: PackProfile['signature']): PackProfile {
  return {
    name: 'Carbonite',
    price: CARBONITE_PRICE,
    summary,
    pools: {
      common: 9,
      uncommon: 3,
      rare: 1.6,
      legendary: 0.4,
      leaderCommon: 1 - RARE_LEADER_SHARE,
      leaderRare: RARE_LEADER_SHARE,
    },
    signature,
  };
}

const CARBONITE_BEFORE_LAW = carbonite(
  '16 cards: a Hyperspace or Showcase leader, 7 foils, 5 Hyperspace, 2 Hyperspace Foils and a Prestige.',
  { normal: 0, foil: 6, hyperspace: 4.3, hyperspaceFoil: 1.7, prestige: 1 },
);
const CARBONITE_FROM_LAW = carbonite(
  '16 cards: a Hyperspace or Showcase leader, 6 Hyperspace Foils, 8 Hyperspace and a Prestige.',
  { normal: 0, foil: 0, hyperspace: 6.86, hyperspaceFoil: 5.14, prestige: 1 },
);

/**
 * The hit table before LAW. Carbonite figures: its 14 non-leader cards hold about 2 Rares
 * or Legendaries, half of them Hyperspace; its leader is Hyperspace, or Showcase 1 in 20.
 */
const HITS_BEFORE_LAW: readonly PackHit[] = [
  {
    label: 'Legendary',
    variants: PACK_PRINTINGS,
    rarities: ['Legendary'],
    booster: BEFORE_LAW_POOLS.legendary,
    carbonite: 0.4,
  },
  { label: 'Foil', variants: ['foil'], booster: 5 / 6, carbonite: 7 },
  { label: 'Hyperspace', variants: HYPERSPACE, booster: 1 / 2 + 1 / 6, carbonite: 7 + 19 / 20 },
  { label: 'Hyperspace Foil', variants: ['hyperspace-foil'], booster: 1 / 6, carbonite: 2 },
  {
    label: 'Hyperspace R/L',
    variants: HYPERSPACE,
    rarities: RARE_OR_LEGENDARY,
    booster: 1 / 21 + 1 / 72 + 1 / 53 + 1 / 181,
    carbonite: 1,
  },
  { label: 'Prestige', variants: SIGNAL_VARIANTS.prestige, booster: 0, carbonite: 1 },
  { label: 'Showcase', variants: ['showcase'], booster: 1 / 288, carbonite: 1 / 20 },
];

/** LAW on. A Carbonite pack's non-leader cards are all Hyperspace, so both its Rares are. */
const HITS_FROM_LAW: readonly PackHit[] = [
  {
    label: 'Legendary',
    variants: PACK_PRINTINGS,
    rarities: ['Legendary'],
    booster: FROM_LAW_POOLS.legendary,
    carbonite: 0.4,
  },
  { label: 'Hyperspace', variants: ['hyperspace'], booster: 1.2, carbonite: 8 + 47 / 48 },
  { label: 'Hyperspace Foil', variants: ['hyperspace-foil'], booster: 1, carbonite: 6 },
  {
    label: 'Hyperspace R/L',
    variants: HYPERSPACE,
    rarities: RARE_OR_LEGENDARY,
    booster: 1 / 12 + 1 / 24 + 1 / 48 + 1 / 96,
    carbonite: 2,
  },
  { label: 'Prestige', variants: SIGNAL_VARIANTS.prestige, booster: 1 / 18, carbonite: 1 },
  { label: 'Showcase', variants: ['showcase'], booster: 1 / 288, carbonite: 1 / 48 },
];

const PROFILES: Readonly<Record<SetKey, SetPackProfiles>> = {
  SOR: { booster: BEFORE_LAW, hits: HITS_BEFORE_LAW },
  SHD: { booster: BEFORE_LAW, hits: HITS_BEFORE_LAW },
  TWI: { booster: BEFORE_LAW, hits: HITS_BEFORE_LAW },
  JTL: { booster: BEFORE_LAW, carbonite: CARBONITE_BEFORE_LAW, hits: HITS_BEFORE_LAW },
  LOF: { booster: BEFORE_LAW, carbonite: CARBONITE_BEFORE_LAW, hits: HITS_BEFORE_LAW },
  SEC: { booster: BEFORE_LAW, carbonite: CARBONITE_BEFORE_LAW, hits: HITS_BEFORE_LAW },
  LAW: { booster: FROM_LAW, carbonite: CARBONITE_FROM_LAW, hits: HITS_FROM_LAW },
  ASH: { booster: FROM_LAW, carbonite: CARBONITE_FROM_LAW, hits: HITS_FROM_LAW },
  HMW: { booster: FROM_LAW, carbonite: CARBONITE_FROM_LAW, hits: HITS_FROM_LAW },
};

/** The packs a set came in; undefined for sets sold only as decks (IBH, Twin Suns). */
export function packProfiles(setKey: SetKey): SetPackProfiles | undefined {
  return PROFILES[setKey];
}
