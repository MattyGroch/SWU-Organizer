import { describe, expect, it } from 'vitest';

import { setAccent } from './setAccent';

describe('setAccent', () => {
  it('returns the accent hex for a known set', () => {
    expect(setAccent('SOR')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('returns undefined for sets without an accent', () => {
    expect(setAccent('IBH')).toBeUndefined();
    expect(setAccent('NOPE')).toBeUndefined();
  });
});
