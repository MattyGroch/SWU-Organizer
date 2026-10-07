import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RarityBadge } from './RarityBadge';

describe('RarityBadge', () => {
  it('shows the rarity letter on a tile in the rarity colour', () => {
    render(<RarityBadge rarity="Legendary" title="Legendary" />);
    const badge = screen.getByTitle('Legendary');
    expect(badge).toHaveTextContent('L');
    expect(badge).toHaveAttribute('data-rarity', 'Legendary');
    expect(badge.style.color).toBe('var(--rarity-legendary)');
  });

  it('renders nothing for a missing or unknown rarity', () => {
    const { container, rerender } = render(<RarityBadge rarity={undefined} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<RarityBadge rarity="Mythic" />);
    expect(container).toBeEmptyDOMElement();
  });
});
