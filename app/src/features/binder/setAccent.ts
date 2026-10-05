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
