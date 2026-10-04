import { describe, expect, it } from 'vitest';

import {
  aspectBackground,
  aspectFillVars,
  aspectSwatchBackground,
  isLightFill,
  rarityStyle,
} from './aspect';

describe('aspectFillVars', () => {
  it('uses primary aspects when present', () => {
    expect(aspectFillVars(['Vigilance'])).toEqual(['--aspect-vigilance']);
    expect(aspectFillVars(['Vigilance', 'Command'])).toEqual([
      '--aspect-vigilance',
      '--aspect-command',
    ]);
  });

  it('ignores affiliations when a primary aspect exists', () => {
    expect(aspectFillVars(['Vigilance', 'Villainy'])).toEqual(['--aspect-vigilance']);
  });

  it('falls back to the affiliation for cards with no primary aspect', () => {
    expect(aspectFillVars(['Heroism'])).toEqual(['--aspect-heroism']);
    expect(aspectFillVars(['Villainy'])).toEqual(['--aspect-villainy']);
  });

  it('collapses a double pip into a single colour', () => {
    // A card with two Aggression pips is one red card, not a red-to-red gradient.
    expect(aspectFillVars(['Aggression', 'Aggression'])).toEqual(['--aspect-aggression']);
  });

  it('is empty for true neutrals', () => {
    expect(aspectFillVars([])).toEqual([]);
    expect(aspectFillVars(undefined)).toEqual([]);
  });
});

describe('aspectBackground', () => {
  it('renders a solid fill for one aspect', () => {
    expect(aspectBackground(['Command'])).toBe('var(--aspect-command)');
  });

  it('falls back to neutral when there is no aspect', () => {
    expect(aspectBackground([])).toBe('var(--aspect-neutral)');
  });

  it('blends dual aspects only across a narrow central band', () => {
    const background = aspectBackground(['Vigilance', 'Villainy']);
    // Villainy is an affiliation, so this is really a mono-Vigilance card.
    expect(background).toBe('var(--aspect-vigilance)');

    const dual = aspectBackground(['Vigilance', 'Command']);
    expect(dual).toContain('linear-gradient(to right');
    expect(dual).toContain('42.5%');
    expect(dual).toContain('57.5%');
  });
});

describe('aspectSwatchBackground', () => {
  it('splits dual aspects diagonally so they read at small sizes', () => {
    expect(aspectSwatchBackground(['Vigilance', 'Command'])).toBe(
      'linear-gradient(135deg, var(--aspect-vigilance) 0 50%, var(--aspect-command) 50% 100%)',
    );
  });

  it('stays solid for a single aspect', () => {
    expect(aspectSwatchBackground(['Cunning'])).toBe('var(--aspect-cunning)');
  });
});

describe('isLightFill', () => {
  it('flags only mono-Heroism, which needs dark text', () => {
    expect(isLightFill(['Heroism'])).toBe(true);
    expect(isLightFill(['Villainy'])).toBe(false);
    expect(isLightFill(['Command', 'Heroism'])).toBe(false);
  });
});

describe('rarityStyle', () => {
  it('maps each rarity to a letter and colour', () => {
    expect(rarityStyle('Common')).toEqual({ letter: 'C', colorVar: '--rarity-common' });
    expect(rarityStyle('Legendary')).toEqual({ letter: 'L', colorVar: '--rarity-legendary' });
  });

  it('returns null for missing or unknown rarities', () => {
    expect(rarityStyle(undefined)).toBeNull();
    expect(rarityStyle('Mythic')).toBeNull();
  });
});
