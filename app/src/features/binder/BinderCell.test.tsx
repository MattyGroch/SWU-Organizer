import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CatalogCard } from '~/domain/catalog';
import {
  indexOwnership,
  quotaForCard,
  type OwnedCounts,
  type VariantCounts,
} from '~/domain/ownership';
import type { Card } from '~/domain/types';

import { BinderCell } from './BinderCell';

// The cache is mocked so the art path renders without a network or a canvas; the cache
// itself is covered by src/data/images.test.ts.
vi.mock('~/data/images', () => ({
  getCardImage: vi.fn(async () => new Blob(['art'])),
  objectUrlFor: (url: string) => `blob:${url}`,
}));

const leader: Card = {
  Name: 'Director Krennic',
  Subtitle: 'Aspiring to Authority',
  Number: 1,
  Type: 'Leader',
  Rarity: 'Rare',
  Aspects: ['Vigilance'],
  Set: 'SOR',
};

const unit: Card = {
  Name: '2-1B Surgical Droid',
  Number: 59,
  Type: 'Unit',
  Rarity: 'Common',
  Aspects: ['Vigilance'],
  Set: 'SOR',
};

const leaderCatalog: CatalogCard = {
  base: 1,
  name: 'Director Krennic',
  type: 'Leader',
  aspects: [],
  printings: [
    { num: '001', variant: 'normal' },
    { num: '253', variant: 'showcase' },
  ],
};

const unitCatalog: CatalogCard = {
  base: 59,
  name: '2-1B Surgical Droid',
  type: 'Unit',
  aspects: [],
  printings: [
    { num: '059', variant: 'normal' },
    { num: '059F', variant: 'foil' },
  ],
};

/**
 * The art carries `alt=""` because it is decorative — the button itself holds the
 * accessible name — so it is exposed as presentational and has to be found in the DOM
 * rather than by role.
 */
function artElement(container: HTMLElement): HTMLImageElement {
  const img = container.querySelector('img');
  if (!img) throw new Error('no art rendered');
  return img;
}

function renderCell(
  card: Card,
  catalogCard: CatalogCard,
  owned: Array<[string, number]> = [],
  held: VariantCounts = {},
  quota = quotaForCard(catalogCard),
): HTMLElement {
  const counts: OwnedCounts = indexOwnership(
    owned.map(([variant, count]) => ({ base: catalogCard.base, variant: variant as never, count })),
  ).get(catalogCard.base) ?? { total: 0, byVariant: {} };

  return render(
    <BinderCell
      colIndex={1}
      card={card}
      catalogCard={catalogCard}
      setKey="SOR"
      page={1}
      row={1}
      column={1}
      selected={false}
      counts={counts}
      held={{ binder: held, bulk: {} }}
      quota={quota}
      onSelect={vi.fn()}
    />,
  ).container;
}

beforeEach(() => vi.clearAllMocks());

describe('landscape rotation', () => {
  it('turns Leader art 90° counter-clockwise, as it sits in the pocket', async () => {
    const container = renderCell(leader, leaderCatalog, [['normal', 1]]);
    const art = await waitFor(() => artElement(container));
    expect(art).toHaveAttribute('data-rotated', 'true');
  });

  it('turns Base art too', async () => {
    const container = renderCell(
      { ...leader, Type: 'Base', Name: 'Crystal Caves' },
      { ...leaderCatalog, type: 'Base' },
      [['normal', 1]],
    );
    const art = await waitFor(() => artElement(container));
    expect(art).toHaveAttribute('data-rotated', 'true');
  });

  it('leaves portrait cards upright', async () => {
    const container = renderCell(unit, unitCatalog, [['normal', 1]]);
    const art = await waitFor(() => artElement(container));
    expect(art).toHaveAttribute('data-rotated', 'false');
  });
});

describe('ownership presentation', () => {
  it('greyscales a slot you own none of', async () => {
    const container = renderCell(unit, unitCatalog);
    const art = await waitFor(() => artElement(container));
    expect(art).toHaveAttribute('data-unowned', 'true');
  });

  it('shows the art at full colour once owned', async () => {
    const container = renderCell(unit, unitCatalog, [['normal', 1]]);
    const art = await waitFor(() => artElement(container));
    expect(art).toHaveAttribute('data-unowned', 'false');
  });

  it('looks empty when every copy is out in a deck, like the physical pocket', async () => {
    const container = renderCell(unit, unitCatalog, [['foil', 2]], { foil: 2 });
    const art = await waitFor(() => artElement(container));
    expect(art).toHaveAttribute('data-unowned', 'true');
    expect(container.querySelector('svg')).not.toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveAccessibleName(/0 of 3 in binder, 2 in decks\./);
  });

  it('stays in colour while at least one copy is still in the pocket', async () => {
    const container = renderCell(unit, unitCatalog, [['normal', 3]], { normal: 2 });
    const art = await waitFor(() => artElement(container));
    expect(art).toHaveAttribute('data-unowned', 'false');
  });
});

describe('foil marker', () => {
  it('marks a slot holding a foil, and says so for screen readers', async () => {
    const container = renderCell(unit, unitCatalog, [['foil', 1]]);

    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument());
    expect(screen.getByRole('button')).toHaveAccessibleName(/Includes a foil\./);
  });

  it('shows no marker for non-foil holdings', async () => {
    const container = renderCell(unit, unitCatalog, [['normal', 3]]);

    await waitFor(() => artElement(container));
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByRole('button')).not.toHaveAccessibleName(/foil/i);
  });

  it('marks Showcase copies as foil, since every Showcase card is one', async () => {
    const container = renderCell(leader, leaderCatalog, [['showcase', 1]]);

    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument());
    expect(screen.getByRole('button')).toHaveAccessibleName(/Includes a foil\./);
  });

  it('still uses the Showcase artwork, which is unique unlike the foil SKUs', async () => {
    const container = renderCell(leader, leaderCatalog, [['showcase', 1]]);
    await waitFor(() => artElement(container));

    // #253 is the Showcase printing; falling back to #001 would lose the alternate art.
    expect(artElement(container).src).toContain('/card-art/SOR/253.png');
  });
});

describe('copies out in decks', () => {
  it('leave the pocket showing the art of what is still in it', async () => {
    // Own a Showcase and a Normal leader; the copy in a deck is the Showcase.
    const container = renderCell(
      leader,
      leaderCatalog,
      [
        ['showcase', 1],
        ['normal', 1],
      ],
      { showcase: 1 },
    );
    await waitFor(() => artElement(container));
    expect(artElement(container).src).toContain('/card-art/SOR/001.png');
    // The Showcase was the foil one, so the sparkle left with it.
    expect(container.querySelector('svg')).not.toBeInTheDocument();
  });
});
