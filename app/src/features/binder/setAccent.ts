/**
 * Each set's marketing accent colour, used to tint the binder so the set is recognisable at a
 * glance. The values are picked from the range sampled off the printed boxes (lighting makes a
 * single exact value impossible) and nudged to sit well on the dark ground.
 *
 * Sets without an entry (promo and starter products) keep the plain background.
 */
export const SET_ACCENTS: Readonly<Record<string, string>> = {
  SOR: '#ff2530',
  SHD: '#4552c4',
  TWI: '#8d2e37',
  JTL: '#fedf24',
  LOF: '#1fb8fe',
  SEC: '#5e3191',
  LAW: '#f95a25',
  ASH: '#566a80',
  HMW: '#12853f',
};

export function setAccent(setKey: string): string | undefined {
  return SET_ACCENTS[setKey];
}

/** Black or white, whichever reads better on `hex` (WCAG contrast against its luminance). */
export function accentText(hex: string): '#000000' | '#ffffff' {
  const channel = (offset: number) => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  // Contrast with black is (L + 0.05) / 0.05, with white 1.05 / (L + 0.05); they cross here.
  return luminance > 0.179 ? '#000000' : '#ffffff';
}
