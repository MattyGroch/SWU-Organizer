import { describe, expect, it } from 'vitest';

import type { CatalogCard } from './catalog';
import { indexOwnership, type OwnedCounts } from './ownership';
import { hasOwnArtwork, isLandscapeArt, selectArtPrinting } from './artSelection';

/** A LOF card with the full seven-printing run. */
const adiGallia: CatalogCard = {
  base: 142,
  name: 'Adi Gallia',
  type: 'Unit',
  aspects: [],
  printings: [
    { num: '142', variant: 'normal' },
    { num: '644', variant: 'foil' },
    { num: '406', variant: 'hyperspace' },
    { num: '882', variant: 'hyperspace-foil' },
    { num: '1060', variant: 'prestige' },
    { num: '1106', variant: 'prestige-foil' },
    { num: '1152', variant: 'prestige-serialized' },
  ],
};

/** A SOR Leader: Normal, Hyperspace and Showcase, no Prestige run. */
const krennic: CatalogCard = {
  base: 1,
  name: 'Director Krennic',
  type: 'Leader',
  aspects: [],
  printings: [
    { num: '001', variant: 'normal' },
    { num: '269', variant: 'hyperspace' },
    { num: '253', variant: 'showcase' },
  ],
};

function owned(
  entries: Array<[OwnedCounts['byVariant'] extends infer _ ? string : never, number]>,
) {
  return (
    indexOwnership(
      entries.map(([variant, count]) => ({
        base: 1,
        variant: variant as never,
        count,
      })),
    ).get(1) ?? { total: 0, byVariant: {} }
  );
}

describe('isLandscapeArt', () => {
  it('identifies the types printed in landscape', () => {
    // Verified against the CDN: Leaders and Bases are 1560x1117, everything else is
    // 1120x1560. These are the cards turned sideways in a binder pocket.
    expect(isLandscapeArt('Leader')).toBe(true);
    expect(isLandscapeArt('Base')).toBe(true);
    expect(isLandscapeArt('Unit')).toBe(false);
    expect(isLandscapeArt('Event')).toBe(false);
    expect(isLandscapeArt('Upgrade')).toBe(false);
  });

  it('tolerates casing, padding and a missing type', () => {
    expect(isLandscapeArt(' leader ')).toBe(true);
    expect(isLandscapeArt('BASE')).toBe(true);
    expect(isLandscapeArt(undefined)).toBe(false);
  });
});

describe('hasOwnArtwork', () => {
  it('excludes foil printings, which have no CDN image', () => {
    expect(hasOwnArtwork({ num: '142', variant: 'normal' })).toBe(true);
    expect(hasOwnArtwork({ num: '406', variant: 'hyperspace' })).toBe(true);
    expect(hasOwnArtwork({ num: '1152', variant: 'prestige-serialized' })).toBe(true);
    expect(hasOwnArtwork({ num: '644', variant: 'foil' })).toBe(false);
    expect(hasOwnArtwork({ num: '882', variant: 'hyperspace-foil' })).toBe(false);
  });
});

describe('selectArtPrinting', () => {
  it('falls back to the Normal art and flags the slot unowned when you have none', () => {
    const choice = selectArtPrinting(adiGallia, owned([]));
    expect(choice).toEqual({
      printing: { num: '142', variant: 'normal' },
      owned: false,
      foil: false,
      fullFoil: false,
    });
  });

  it('shows the Normal art when that is all you own', () => {
    const choice = selectArtPrinting(adiGallia, owned([['normal', 3]]));
    expect(choice.printing.num).toBe('142');
    expect(choice.owned).toBe(true);
  });

  it('prefers the most premium treatment you own', () => {
    expect(
      selectArtPrinting(
        adiGallia,
        owned([
          ['normal', 3],
          ['hyperspace', 1],
        ]),
      ).printing.num,
    ).toBe('406');
    expect(
      selectArtPrinting(
        adiGallia,
        owned([
          ['hyperspace', 1],
          ['prestige', 1],
        ]),
      ).printing.num,
    ).toBe('1060');
  });

  it('ranks Showcase above Hyperspace', () => {
    expect(
      selectArtPrinting(
        krennic,
        owned([
          ['hyperspace', 1],
          ['showcase', 1],
        ]),
      ).printing.num,
    ).toBe('253');
  });

  it('resolves a foil-only holding to its sibling’s artwork, flagged as foil', () => {
    // Foil and non-foil share one image, so the art is the sibling's and the finish is
    // painted on separately.
    const choice = selectArtPrinting(adiGallia, owned([['foil', 1]]));
    expect(choice.printing).toEqual({ num: '142', variant: 'normal' });
    expect(choice.owned).toBe(true);
    expect(choice.foil).toBe(true);
  });

  it('treats a Prestige Serialized as foil, while keeping its own stamped art', () => {
    const choice = selectArtPrinting(adiGallia, owned([['prestige-serialized', 1]]));
    expect(choice.foil).toBe(true);
    expect(choice.printing.variant).toBe('prestige-serialized');
  });

  it('flags foil when the copy shown is foil', () => {
    expect(selectArtPrinting(adiGallia, owned([['hyperspace-foil', 1]])).foil).toBe(true);
    expect(selectArtPrinting(adiGallia, owned([['prestige-foil', 1]])).foil).toBe(true);
    expect(
      selectArtPrinting(
        adiGallia,
        owned([
          ['normal', 3],
          ['foil', 1],
        ]),
      ).foil,
    ).toBe(true);
  });

  it('does not flag foil for plain holdings', () => {
    expect(selectArtPrinting(adiGallia, owned([['normal', 3]])).foil).toBe(false);
    expect(selectArtPrinting(adiGallia, owned([['hyperspace', 1]])).foil).toBe(false);
    expect(selectArtPrinting(adiGallia, owned([['prestige', 1]])).foil).toBe(false);
  });

  it('resolves a Hyperspace Foil holding to the Hyperspace artwork', () => {
    expect(selectArtPrinting(adiGallia, owned([['hyperspace-foil', 2]])).printing.num).toBe('406');
  });

  it('shows the serialized stamp when that is the copy you own', () => {
    // Prestige Serialized has visibly different art — the 000/250 stamp.
    expect(selectArtPrinting(adiGallia, owned([['prestige-serialized', 1]])).printing.num).toBe(
      '1152',
    );
  });

  it('prefers a plain Prestige over the serialized one when you own both', () => {
    const choice = selectArtPrinting(
      adiGallia,
      owned([
        ['prestige', 1],
        ['prestige-serialized', 1],
      ]),
    );
    expect(choice.printing.num).toBe('1060');
  });

  it('falls back to the foil’s sibling when a prestige run is foil-only', () => {
    expect(selectArtPrinting(adiGallia, owned([['prestige-foil', 1]])).printing.num).toBe('1060');
  });

  it('marks Prestige and Showcase foils as foil edge to edge', () => {
    expect(selectArtPrinting(adiGallia, owned([['prestige-foil', 1]])).fullFoil).toBe(true);
    expect(selectArtPrinting(adiGallia, owned([['prestige-serialized', 1]])).fullFoil).toBe(true);
    expect(selectArtPrinting(krennic, owned([['showcase', 1]])).fullFoil).toBe(true);
  });

  it('keeps the matte text box on other foils, and on a plain Prestige beside one', () => {
    expect(selectArtPrinting(adiGallia, owned([['foil', 1]])).fullFoil).toBe(false);
    expect(selectArtPrinting(adiGallia, owned([['hyperspace-foil', 1]])).fullFoil).toBe(false);
    // The pocket shows the plain Prestige art; the foil you own is a Normal.
    const mixed = selectArtPrinting(
      adiGallia,
      owned([
        ['prestige', 1],
        ['foil', 1],
      ]),
    );
    expect(mixed.printing.num).toBe('1060');
    expect(mixed.foil).toBe(false);
    expect(mixed.fullFoil).toBe(false);
  });
});

describe('selectArtPrinting with promos', () => {
  /** ASH Emperor's Messenger: a card with a promo beside its Hyperspace run. */
  const messenger: CatalogCard = {
    base: 189,
    name: "Emperor's Messenger",
    type: 'Unit',
    aspects: [],
    printings: [
      { num: '189', variant: 'normal' },
      { num: '645', variant: 'foil' },
      { num: '453', variant: 'hyperspace' },
      { num: 'ASHOP-010', variant: 'promo' },
      { num: '721', variant: 'hyperspace-foil' },
      { num: 'ASHOP-010F', variant: 'promo-foil' },
    ],
  };

  it('shows a Hyperspace Foil over a plain Promo, without shining the Promo', () => {
    const choice = selectArtPrinting(
      messenger,
      owned([
        ['promo', 1],
        ['hyperspace-foil', 2],
      ]),
    );
    expect(choice.printing.num).toBe('453');
    expect(choice.foil).toBe(true);
  });

  it('shows a plain Promo over a plain Hyperspace', () => {
    const choice = selectArtPrinting(
      messenger,
      owned([
        ['promo', 1],
        ['hyperspace', 1],
      ]),
    );
    expect(choice.printing.num).toBe('ASHOP-010');
    expect(choice.foil).toBe(false);
  });

  it('shows a Promo Foil over a Hyperspace Foil, shining', () => {
    const choice = selectArtPrinting(
      messenger,
      owned([
        ['promo-foil', 1],
        ['hyperspace-foil', 1],
      ]),
    );
    expect(choice.printing.num).toBe('ASHOP-010');
    expect(choice.foil).toBe(true);
  });

  it('does not shine a plain Hyperspace for a foil Normal', () => {
    const choice = selectArtPrinting(
      messenger,
      owned([
        ['hyperspace', 1],
        ['foil', 1],
      ]),
    );
    expect(choice.printing.num).toBe('453');
    expect(choice.foil).toBe(false);
  });
});
