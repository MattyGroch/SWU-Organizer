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

export type PackHit = {
  label: string;
  variants: readonly VariantSlug[];
  /** Only cards of these rarities count; every rarity when absent. */
  rarities?: readonly string[];
  /** Expected copies per pack. */
  perPack: number;
};

export type PackProfile = {
  name: string;
  price: number;
  /** One line on what's in the pack, shown above the numbers. */
  summary: string;
  /** Expected cards per pack from each pool, any printing. */
  pools: Partial<Record<PackPool, number>>;
  hits: readonly PackHit[];
};

export type SetPackProfiles = { booster: PackProfile; carbonite?: PackProfile };

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
  hits: [
    {
      label: 'Legendary',
      variants: PACK_PRINTINGS,
      rarities: ['Legendary'],
      perPack: BEFORE_LAW_POOLS.legendary,
    },
    { label: 'Foil', variants: ['foil'], perPack: 5 / 6 },
    { label: 'Hyperspace', variants: HYPERSPACE, perPack: 1 / 2 + 1 / 6 },
    { label: 'Hyperspace Foil', variants: ['hyperspace-foil'], perPack: 1 / 6 },
    {
      label: 'Hyperspace Rare/Legendary',
      variants: HYPERSPACE,
      rarities: RARE_OR_LEGENDARY,
      perPack: 1 / 21 + 1 / 72 + 1 / 53 + 1 / 181,
    },
    { label: 'Showcase', variants: ['showcase'], perPack: 1 / 288 },
  ],
};

/** LAW on. Foil slot: always a Hyperspace Foil, Rare 1 in 24, Legendary 1 in 96. */
const FROM_LAW_POOLS = booster(1 / 24, 1 / 96);

const FROM_LAW: PackProfile = {
  name: 'Booster',
  price: BOOSTER_PRICE,
  summary:
    '16 cards: a leader, a base, 9 Commons, 3 Uncommons, a Rare or Legendary (1 in 8) and a Hyperspace Foil of any rarity. At least one Hyperspace card besides; no plain foils.',
  pools: FROM_LAW_POOLS,
  hits: [
    {
      label: 'Legendary',
      variants: PACK_PRINTINGS,
      rarities: ['Legendary'],
      perPack: FROM_LAW_POOLS.legendary,
    },
    { label: 'Hyperspace Foil', variants: ['hyperspace-foil'], perPack: 1 },
    {
      label: 'Hyperspace Rare/Legendary',
      variants: HYPERSPACE,
      rarities: RARE_OR_LEGENDARY,
      perPack: 1 / 12 + 1 / 24 + 1 / 48 + 1 / 96,
    },
    { label: 'Prestige', variants: ['prestige'], perPack: 1 / 18 },
    { label: 'Showcase', variants: ['showcase'], perPack: 1 / 288 },
  ],
};

/**
 * Carbonite: 16 cards, every one a special printing — a Hyperspace or Showcase leader, a
 * Prestige, and 14 foils and Hyperspace. No base. The Prestige is left out of the pools:
 * which cards have one varies, and it's one card in sixteen.
 */
function carbonite(summary: string): PackProfile {
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
    hits: [],
  };
}

const CARBONITE_BEFORE_LAW = carbonite(
  '16 cards: a Hyperspace or Showcase leader, 7 foils, 5 Hyperspace, 2 Hyperspace Foils and a Prestige.',
);
const CARBONITE_FROM_LAW = carbonite(
  '16 cards: a Hyperspace or Showcase leader, 6 Hyperspace Foils, 8 Hyperspace and a Prestige.',
);

const PROFILES: Readonly<Record<SetKey, SetPackProfiles>> = {
  SOR: { booster: BEFORE_LAW },
  SHD: { booster: BEFORE_LAW },
  TWI: { booster: BEFORE_LAW },
  JTL: { booster: BEFORE_LAW, carbonite: CARBONITE_BEFORE_LAW },
  LOF: { booster: BEFORE_LAW, carbonite: CARBONITE_BEFORE_LAW },
  SEC: { booster: BEFORE_LAW, carbonite: CARBONITE_BEFORE_LAW },
  LAW: { booster: FROM_LAW, carbonite: CARBONITE_FROM_LAW },
  ASH: { booster: FROM_LAW, carbonite: CARBONITE_FROM_LAW },
  HMW: { booster: FROM_LAW, carbonite: CARBONITE_FROM_LAW },
};

/** The packs a set came in; undefined for sets sold only as decks (IBH, Twin Suns). */
export function packProfiles(setKey: SetKey): SetPackProfiles | undefined {
  return PROFILES[setKey];
}
