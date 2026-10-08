import { describe, expect, it } from 'vitest';

import {
  attachEventPromos,
  attachPromos,
  artUrl,
  buildPriceTable,
  buildSetCatalog,
  eventPromoVariant,
  isEventPromoSet,
  hasOwnArtwork,
  isToken,
  numericPart,
  resolveBaseNumber,
  variantAxes,
  variantSlug,
} from './catalog.mjs';

/** Shape of one upstream `api.swu-db.com/cards/{set}` row, trimmed to what we consume. */
function printing(Number, VariantType, overrides = {}) {
  return {
    Name: 'Adi Gallia',
    Subtitle: 'Stern and Focused',
    Type: 'Unit',
    Rarity: 'Rare',
    Aspects: ['Aggression', 'Heroism'],
    Number,
    VariantType,
    ...overrides,
  };
}

describe('variantSlug', () => {
  it('maps every upstream VariantType seen across all 11 sets', () => {
    expect(variantSlug('Normal')).toBe('normal');
    expect(variantSlug('Foil')).toBe('foil');
    expect(variantSlug('Hyperspace')).toBe('hyperspace');
    expect(variantSlug('Hyperspace Foil')).toBe('hyperspace-foil');
    expect(variantSlug('Prestige')).toBe('prestige');
    expect(variantSlug('Prestige Foil')).toBe('prestige-foil');
    expect(variantSlug('Prestige Serialized')).toBe('prestige-serialized');
    expect(variantSlug('Showcase')).toBe('showcase');
  });

  it('folds HMW’s bare "Serialized" into prestige-serialized', () => {
    // HMW labels the same product differently from every other set that ships it.
    expect(variantSlug('Serialized')).toBe('prestige-serialized');
  });

  it('throws on an unrecognized variant rather than silently dropping it', () => {
    expect(() => variantSlug('Galactic Chrome')).toThrow(/Unknown VariantType/);
  });
});

describe('variantAxes', () => {
  it('splits a variant into the axis a camera can read and the one it cannot', () => {
    expect(variantAxes('hyperspace-foil')).toMatchObject({
      treatment: 'hyperspace',
      finish: 'foil',
    });
    expect(variantAxes('prestige-serialized')).toMatchObject({
      treatment: 'prestige',
      finish: 'serialized',
    });
  });

  it('treats Showcase as foil while keeping its own artwork', () => {
    // No Showcase Foil SKU exists because every Showcase card is already foil — Normal,
    // Hyperspace and Prestige each have a foil sibling and Showcase does not. Its art is
    // unique, so the scan index still needs it.
    expect(variantAxes('showcase')).toEqual({
      treatment: 'showcase',
      finish: 'foil',
      hasArt: true,
    });
    expect(hasOwnArtwork('showcase')).toBe(true);
  });

  it('marks only the duplicate foil SKUs as having no artwork of their own', () => {
    // Their CDN URLs 404; they reuse the non-foil sibling's art.
    expect(hasOwnArtwork('normal')).toBe(true);
    expect(hasOwnArtwork('hyperspace')).toBe(true);
    expect(hasOwnArtwork('foil')).toBe(false);
    expect(hasOwnArtwork('hyperspace-foil')).toBe(false);
    expect(hasOwnArtwork('prestige-foil')).toBe(false);
    // Serialized carries a visible stamp, so it does get its own reference image.
    expect(hasOwnArtwork('prestige-serialized')).toBe(true);
  });
});

describe('isToken', () => {
  it('excludes tokens by number and by type', () => {
    expect(isToken({ Number: 'T02', Type: 'Unit' })).toBe(true);
    expect(isToken({ Number: '014', Type: 'Token Upgrade' })).toBe(true);
    expect(isToken({ Number: '001', Type: 'Force Token' })).toBe(true);
    expect(isToken({ Number: '059', Type: 'Unit' })).toBe(false);
  });
});

describe('numericPart', () => {
  it('reads SOR-era suffixed foils and LOF-era integer foils alike', () => {
    expect(numericPart('059')).toBe(59);
    expect(numericPart('059F')).toBe(59);
    expect(numericPart('644')).toBe(644);
  });

  it('throws rather than yielding NaN, which is how the legacy pipeline lost 1308 foils', () => {
    expect(() => numericPart('F')).toThrow(/no numeric part/);
  });
});

describe('resolveBaseNumber', () => {
  it('picks the lowest numeric part across printings', () => {
    const printings = [
      { Number: '406' }, // hyperspace
      { Number: '142' }, // normal
      { Number: '644' }, // foil, integer-numbered
      { Number: '1152' }, // prestige serialized
    ];
    expect(resolveBaseNumber(printings)).toBe(142);
  });

  it('is unaffected by a suffixed foil sharing the base number', () => {
    expect(resolveBaseNumber([{ Number: '059F' }, { Number: '059' }, { Number: '324' }])).toBe(59);
  });
});

describe('buildSetCatalog', () => {
  it('groups every printing of a card onto one base entry, in hotkey order', () => {
    const { cards } = buildSetCatalog('LOF', [
      printing('406', 'Hyperspace'),
      printing('1152', 'Prestige Serialized'),
      printing('142', 'Normal'),
      printing('644', 'Foil'),
      printing('882', 'Hyperspace Foil'),
      printing('1060', 'Prestige'),
      printing('1106', 'Prestige Foil'),
    ]);

    expect(cards).toHaveLength(1);
    expect(cards[0].base).toBe(142);
    expect(cards[0].name).toBe('Adi Gallia');
    expect(cards[0].subtitle).toBe('Stern and Focused');
    // Order matches the 1-8 digit hotkeys the binder exposes.
    expect(cards[0].printings).toEqual([
      { num: '142', variant: 'normal' },
      { num: '644', variant: 'foil' },
      { num: '406', variant: 'hyperspace' },
      { num: '882', variant: 'hyperspace-foil' },
      { num: '1060', variant: 'prestige' },
      { num: '1106', variant: 'prestige-foil' },
      { num: '1152', variant: 'prestige-serialized' },
    ]);
  });

  it('keeps cards that share a name but differ in subtitle or type apart', () => {
    const { cards } = buildSetCatalog('SOR', [
      printing('010', 'Normal', {
        Name: 'Luke Skywalker',
        Subtitle: 'Faithful Friend',
        Type: 'Leader',
      }),
      printing('210', 'Normal', { Name: 'Luke Skywalker', Subtitle: 'Jedi Knight', Type: 'Unit' }),
    ]);
    expect(cards.map((c) => c.base)).toEqual([10, 210]);
  });

  it('drops tokens', () => {
    const { cards } = buildSetCatalog('SOR', [
      printing('059', 'Normal'),
      printing('T02', 'Normal', { Name: 'Experience', Type: 'Token Upgrade' }),
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0].base).toBe(59);
  });

  it('handles a product that reprints one card at several collector numbers', () => {
    // IBH ships the same card in both decks, e.g. Hoth Trooper at 37, 38 and 48.
    const { cards } = buildSetCatalog('IBH', [
      printing('37', 'Normal', { Name: 'Hoth Trooper', Subtitle: '' }),
      printing('48', 'Normal', { Name: 'Hoth Trooper', Subtitle: '' }),
      printing('38', 'Normal', { Name: 'Hoth Trooper', Subtitle: '' }),
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0].base).toBe(37);
    expect(cards[0].printings.map((p) => p.num)).toEqual(['37', '38', '48']);
  });

  it('carries identity flags and the MaxCopies override', () => {
    const { cards } = buildSetCatalog('JTL', [
      printing('123', 'Normal', {
        Name: 'Swarming Vulture Droid',
        Subtitle: '',
        Unique: false,
        DoubleSided: false,
        MaxCopies: 15,
      }),
    ]);
    expect(cards[0].maxCopies).toBe(15);
    expect(cards[0].unique).toBeUndefined();
    expect(cards[0].doubleSided).toBeUndefined();
  });

  it('carries deck-building stats, arenas, traits and rules text', () => {
    const { cards } = buildSetCatalog('LAW', [
      printing('020', 'Normal', {
        Cost: '5',
        Power: '3',
        HP: '6',
        Arenas: ['Ground'],
        Traits: ['IMPERIAL', 'TROOPER'],
        FrontText: 'Action [C=1, Exhaust]: Play a card.',
        EpicAction: 'Epic Action: Deploy this leader.',
        BackText: '',
      }),
      printing('021', 'Normal', { Name: 'A Base', Subtitle: '', Type: 'Base', HP: '28' }),
    ]);
    expect(cards[0]).toMatchObject({
      cost: 5,
      power: 3,
      hp: 6,
      arenas: ['Ground'],
      traits: ['IMPERIAL', 'TROOPER'],
      text: 'Action [C=1, Exhaust]: Play a card.\nEpic Action: Deploy this leader.',
    });
    expect(cards[1].cost).toBeUndefined();
    expect(cards[1].power).toBeUndefined();
    expect(cards[1].hp).toBe(28);
    expect(cards[1].arenas).toBeUndefined();
  });

  it("keeps an upgrade's negative power and HP bonus", () => {
    const { cards } = buildSetCatalog('LAW', [
      printing('050', 'Normal', { Type: 'Upgrade', Power: '-1', HP: '-1' }),
    ]);
    expect(cards[0]).toMatchObject({ power: -1, hp: -1 });
  });

  it('sorts cards by base number so binder order is stable', () => {
    const { cards } = buildSetCatalog('SOR', [
      printing('200', 'Normal', { Name: 'Zeb', Subtitle: '' }),
      printing('005', 'Normal', { Name: 'Ahsoka', Subtitle: '' }),
      printing('100', 'Normal', { Name: 'Maul', Subtitle: '' }),
    ]);
    expect(cards.map((c) => c.base)).toEqual([5, 100, 200]);
  });
});

describe('buildPriceTable', () => {
  it('keys prices by printing number so each variant is valued separately', () => {
    const prices = buildPriceTable([
      printing('142', 'Normal', { MarketPrice: '0.35' }),
      printing('1152', 'Prestige Serialized', { MarketPrice: '210.00' }),
    ]);
    expect(prices).toEqual({ 142: 0.35, 1152: 210 });
  });

  it('skips tokens and unpriced printings', () => {
    const prices = buildPriceTable([
      printing('059', 'Normal', { MarketPrice: '0.05' }),
      printing('060', 'Normal', { MarketPrice: '' }),
      printing('T01', 'Normal', { Type: 'Force Token', MarketPrice: '1.00' }),
    ]);
    expect(prices).toEqual({ '059': 0.05 });
  });
});

describe('attachPromos', () => {
  const catalog = () => ({
    setKey: 'SOR',
    cards: [
      {
        base: 15,
        name: 'Bossk',
        subtitle: 'Deadly Stalker',
        type: 'Unit',
        printings: [{ num: '015', variant: 'normal' }],
      },
      {
        base: 33,
        name: 'Death Trooper',
        type: 'Unit',
        printings: [{ num: '033', variant: 'normal' }],
      },
    ],
  });
  const promo = (Number, Name, Subtitle, VariantType = 'OP Promo') => ({
    Number,
    Name,
    Subtitle,
    Type: 'Unit',
    VariantType,
  });

  it('adds weekly-play promos to their base card, numbered under the promo set', () => {
    const cat = catalog();
    const unmatched = attachPromos(cat, 'SOROP', [
      promo('015', 'Bossk', 'Deadly Stalker'),
      promo('015F', 'Bossk', 'Deadly Stalker', 'OP Promo Foil'),
      promo('013', 'Death Trooper'),
    ]);
    expect(unmatched).toEqual([]);
    expect(cat.cards[0].printings).toEqual([
      { num: '015', variant: 'normal' },
      { num: 'SOROP-015', variant: 'promo' },
      { num: 'SOROP-015F', variant: 'promo-foil' },
    ]);
    expect(cat.cards[1].printings.at(-1)).toEqual({ num: 'SOROP-013', variant: 'promo' });
  });

  it('reports a promo that matches no card instead of dropping it', () => {
    expect(attachPromos(catalog(), 'SOROP', [promo('099', 'Nobody', 'At All')])).toEqual([
      'SOROP 099 Nobody — At All',
    ]);
  });

  it('files event promos on the earliest set with the card, and says which sets', () => {
    const ash = {
      setKey: 'ASH',
      cards: [
        {
          base: 31,
          name: 'Hera Syndulla',
          subtitle: 'Renegade General',
          type: 'Unit',
          printings: [{ num: '031', variant: 'normal' }],
        },
      ],
    };
    const later = { setKey: 'TS26', cards: [structuredClone(ash.cards[0])] };
    const sor = catalog();
    const { unmatched, touched } = attachEventPromos([sor, ash, later], 'P26', [
      promo('14', 'Hera Syndulla', 'Renegade General', 'Store Showdown Participation'),
      promo('164', 'Bossk', 'Deadly Stalker', 'GC Prize Wall Foil'),
      promo('140', 'Death Trooper', undefined, 'Showcase'),
      promo('233', 'Bossk', 'Some Other Subtitle', 'SQ Silver Pack'),
      { ...promo('999', 'Bossk', 'Leader Side'), Type: 'Leader' },
    ]);
    expect(unmatched).toEqual(['P26 999 Bossk — Leader Side']);
    expect([...touched].sort()).toEqual(['ASH', 'SOR']);
    expect(ash.cards[0].printings.at(-1)).toEqual({ num: 'P26-14', variant: 'promo' });
    expect(later.cards[0].printings).toHaveLength(1);
    expect(sor.cards[0].printings.map((p) => p.num)).toEqual(['015', 'P26-233', 'P26-164']);
    expect(sor.cards[1].printings.at(-1)).toEqual({ num: 'P26-140', variant: 'promo-foil' });
  });

  it('reads event promo variants by finish', () => {
    expect(eventPromoVariant('Gift Box')).toBe('promo');
    expect(eventPromoVariant('Store Showdown Judge')).toBe('promo');
    expect(eventPromoVariant('SQ Prize Wall Foil')).toBe('promo-foil');
    expect(eventPromoVariant('Showcase')).toBe('promo-foil');
  });

  it('treats promo products as event promo sets, but not main or weekly OP sets', () => {
    const main = new Set(['SOR', 'ASH']);
    const set = (setId, fullName, parentSetId) => ({ setId, fullName, parentSetId });
    expect(isEventPromoSet(set('G25', '2025 Gift Box'), main)).toBe(true);
    expect(isEventPromoSet(set('P26', '2026 Promos'), main)).toBe(true);
    expect(isEventPromoSet(set('SS1', 'Store Showdown - 1'), main)).toBe(true);
    expect(isEventPromoSet(set('GG', 'Gamegenic'), main)).toBe(true);
    expect(
      isEventPromoSet(set('PSOR', 'Spark of Rebellion - Prerelease Promos', 'SOR'), main),
    ).toBe(true);
    expect(
      isEventPromoSet(set('SOROPJ', 'Spark of Rebellion - OP Promo - Judge', 'SOR'), main),
    ).toBe(true);
    expect(isEventPromoSet(set('ASHOP', 'Ashes of the Empire - OP Promo', 'ASH'), main)).toBe(
      false,
    );
    expect(isEventPromoSet(set('ASH', 'Ashes of the Empire'), main)).toBe(false);
    expect(isEventPromoSet(set('IC27', 'Icons 2027'), main)).toBe(false);
  });

  it('finds promo art under the promo set code', () => {
    expect(artUrl('SOR', 'SOROP-015')).toBe('https://cdn.swu-db.com/images/cards/SOROP/015.png');
  });

  it('prices promo printings under their promo numbers', () => {
    expect(buildPriceTable([{ ...promo('015', 'Bossk'), MarketPrice: 2.5 }], 'SOROP')).toEqual({
      'SOROP-015': 2.5,
    });
  });
});
