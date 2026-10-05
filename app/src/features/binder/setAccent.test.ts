import { describe, expect, it } from 'vitest';

import { accentText, setAccent } from './setAccent';

describe('setAccent', () => {
  it('returns the accent hex for a known set', () => {
    expect(setAccent('SOR')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('returns undefined for sets without an accent', () => {
    expect(setAccent('IBH')).toBeUndefined();
    expect(setAccent('NOPE')).toBeUndefined();
  });
});

describe('accentText', () => {
  it('puts black on light accents and white on dark ones', () => {
    expect(accentText('#fedf24')).toBe('#000000');
    expect(accentText('#1fb8fe')).toBe('#000000');
    expect(accentText('#8d2e37')).toBe('#ffffff');
    expect(accentText('#5e3191')).toBe('#ffffff');
  });
});
