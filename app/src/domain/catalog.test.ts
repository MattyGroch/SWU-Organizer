import { describe, expect, it } from 'vitest';

import {
  artUrl,
  numericPart,
  parsePriceTable,
  parseSetCatalog,
  parseSetManifest,
  toLoadedSet,
  toSearchCatalog,
  variantAxes,
  variantForHotkey,
  variantHotkey,
  variantLabel,
  VARIANTS,
} from './catalog';

const sorPayload = {
  version: 2,
  setKey: 'SOR',
  label: 'Spark of Rebellion (SOR)',
  cards: [
    {
      base: 1,
      name: 'Director Krennic',
      subtitle: 'Aspiring to Authority',
      type: 'Leader',
      rarity: 'Rare',
      aspects: ['Vigilance', 'Villainy'],
      unique: true,
      doubleSided: true,
      printings: [
        { num: '001', variant: 'normal' },
        { num: '269', variant: 'hyperspace' },
        { num: '253', variant: 'showcase' },
      ],
    },
    {
      base: 59,
      name: '2-1B Surgical Droid',
      type: 'Unit',
      rarity: 'Common',
      aspects: ['Vigilance'],
      printings: [
        { num: '059', variant: 'normal' },
        { num: '059F', variant: 'foil' },
        { num: '324', variant: 'hyperspace' },
        { num: '324F', variant: 'hyperspace-foil' },
      ],
    },
  ],
};

describe('variant vocabulary', () => {
  it('maps each variant to a hotkey digit and back', () => {
    expect(variantHotkey('normal')).toBe(1);
    expect(variantHotkey('foil')).toBe(2);
    expect(variantHotkey('hyperspace')).toBe(3);
    expect(variantHotkey('hyperspace-foil')).toBe(4);
    expect(variantHotkey('prestige')).toBe(5);
    expect(variantHotkey('showcase')).toBe(8);

    for (const slug of VARIANTS) {
      expect(variantForHotkey(variantHotkey(slug))).toBe(slug);
    }
  });

  it('has no hotkey outside the 1-8 range', () => {
    expect(variantForHotkey(0)).toBeUndefined();
    expect(variantForHotkey(9)).toBeUndefined();
  });

  it('splits variants into the axis a camera reads and the one it cannot', () => {
    // The scanner resolves treatment from artwork; finish needs a keystroke.
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
    // Every Showcase card is foil, which is why the catalog has no Showcase Foil SKU —
    // Normal, Hyperspace and Prestige each have a foil sibling and Showcase does not.
    // Its art is unique though, unlike the `*-foil` SKUs which reuse a sibling's picture.
    expect(variantAxes('showcase')).toEqual({
      treatment: 'showcase',
      finish: 'foil',
      hasArt: true,
    });
  });

  it('marks only the duplicate foil SKUs as having no art of their own', () => {
    expect(variantAxes('foil').hasArt).toBe(false);
    expect(variantAxes('hyperspace-foil').hasArt).toBe(false);
    expect(variantAxes('prestige-foil').hasArt).toBe(false);
    expect(variantAxes('normal').hasArt).toBe(true);
    expect(variantAxes('prestige-serialized').hasArt).toBe(true);
  });

  it('labels variants for display', () => {
    expect(variantLabel('hyperspace-foil')).toBe('Hyperspace Foil');
  });
});

describe('numericPart', () => {
  it('reads suffixed and plain printing numbers alike', () => {
    expect(numericPart('059')).toBe(59);
    expect(numericPart('059F')).toBe(59);
    expect(numericPart('1152')).toBe(1152);
  });

  it('throws instead of yielding NaN', () => {
    expect(() => numericPart('F')).toThrow(/no numeric part/);
  });
});

describe('artUrl', () => {
  it('derives a same-origin path without storing it', () => {
    // Proxied rather than pointed straight at cdn.swu-db.com: that bucket sends no CORS
    // header, so the browser blocks the fetch and a canvas could not read the pixels.
    expect(artUrl('SOR', '059')).toBe('/card-art/SOR/059.png');
  });
});

describe('parseSetManifest', () => {
  it('reads manifest entries', () => {
    const entries = parseSetManifest({
      version: 2,
      sets: [{ key: 'SOR', label: 'Spark of Rebellion (SOR)', file: 'SWU-SOR.json' }],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.key).toBe('SOR');
  });

  it('rejects a malformed payload', () => {
    expect(() => parseSetManifest({ sets: 'nope' })).toThrow(/Invalid set manifest/);
  });
});

describe('parseSetCatalog', () => {
  it('parses cards and their printings', () => {
    const catalog = parseSetCatalog(sorPayload);
    expect(catalog.setKey).toBe('SOR');
    expect(catalog.cards).toHaveLength(2);

    const krennic = catalog.cards[0]!;
    expect(krennic.base).toBe(1);
    expect(krennic.unique).toBe(true);
    expect(krennic.doubleSided).toBe(true);
    expect(krennic.printings.map((p) => p.variant)).toEqual(['normal', 'hyperspace', 'showcase']);
  });

  it('sorts cards by base number', () => {
    const catalog = parseSetCatalog({
      setKey: 'SOR',
      cards: [
        { base: 200, name: 'B', aspects: [], printings: [{ num: '200', variant: 'normal' }] },
        { base: 5, name: 'A', aspects: [], printings: [{ num: '005', variant: 'normal' }] },
      ],
    });
    expect(catalog.cards.map((c) => c.base)).toEqual([5, 200]);
  });

  it('throws on an unknown variant rather than silently dropping the printing', () => {
    expect(() =>
      parseSetCatalog({
        setKey: 'SOR',
        cards: [
          { base: 1, name: 'X', aspects: [], printings: [{ num: '001', variant: 'chrome' }] },
        ],
      }),
    ).toThrow(/Unknown variant "chrome"/);
  });

  it('skips cards with no usable identity', () => {
    const catalog = parseSetCatalog({
      setKey: 'SOR',
      cards: [
        { base: 0, name: 'Bad base', aspects: [], printings: [{ num: '1', variant: 'normal' }] },
        { base: 2, name: '', aspects: [], printings: [{ num: '2', variant: 'normal' }] },
        { base: 3, name: 'No printings', aspects: [], printings: [] },
      ],
    });
    expect(catalog.cards).toHaveLength(0);
  });

  it('rejects a malformed payload', () => {
    expect(() => parseSetCatalog({ cards: [] })).toThrow(/Invalid set catalog/);
  });
});

describe('parsePriceTable', () => {
  it('keys prices by printing number', () => {
    const prices = parsePriceTable({ prices: { '059': 0.05, '324': 0.24, bad: 'x' } });
    expect(prices.get('059')).toBe(0.05);
    expect(prices.get('324')).toBe(0.24);
    expect(prices.has('bad')).toBe(false);
  });

  it('tolerates a missing overlay', () => {
    expect(parsePriceTable(null).size).toBe(0);
  });
});

describe('toLoadedSet', () => {
  const catalog = parseSetCatalog(sorPayload);
  const prices = parsePriceTable({ prices: { '001': 1.5, '059': 0.05, '324': 0.24 } });
  const set = toLoadedSet(catalog, prices);

  it('exposes base cards in the legacy Card shape the ported modules consume', () => {
    const droid = set.byNumber.get(59)!;
    expect(droid.Name).toBe('2-1B Surgical Droid');
    expect(droid.Number).toBe(59);
    expect(droid.Set).toBe('SOR');
    expect(droid.Type).toBe('Unit');
  });

  it('prices a base card from its Normal printing', () => {
    expect(set.byNumber.get(59)!.MarketPrice).toBe(0.05);
    expect(set.byNumber.get(1)!.MarketPrice).toBe(1.5);
  });

  it('maps every printing back to its base card, including suffixed foils', () => {
    expect(set.baseByPrinting.get('059')).toBe(59);
    expect(set.baseByPrinting.get('059F')).toBe(59);
    expect(set.baseByPrinting.get('324')).toBe(59);
    expect(set.baseByPrinting.get('324F')).toBe(59);
    // All three Leader printings collapse onto the same binder slot.
    expect(set.baseByPrinting.get('253')).toBe(1);
    expect(set.baseByPrinting.get('269')).toBe(1);
  });

  it('keeps printings available per base card', () => {
    expect(set.printingsByBase.get(59)!.map((p) => p.num)).toEqual(['059', '059F', '324', '324F']);
  });
});

describe('toSearchCatalog', () => {
  it('collapses suffixed foils onto their sibling number for suggestions', () => {
    const set = toLoadedSet(parseSetCatalog(sorPayload), new Map());
    const search = toSearchCatalog(set);

    // "059F" and "059" are one printing number as far as search is concerned.
    expect(search.printingNumbersByBase.get(59)).toEqual([59, 324]);
    expect(search.baseByPrintingNumber.get(324)).toBe(59);
    expect(search.cards).toHaveLength(2);
  });
});
