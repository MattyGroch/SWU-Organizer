import { describe, expect, it } from 'vitest';

import type { OwnedCounts } from '~/domain/ownership';
import type { PreconCatalogEntry } from '~/domain/precons';
import type { SetKey } from '~/domain/types';

import { withPreconCards } from './collectionStats';

const ref = (setKey: SetKey, baseNumber: number, count = 1) => ({ setKey, baseNumber, count });
const precon: PreconCatalogEntry = {
  key: 'p1',
  label: 'P1',
  setKey: 'ASH' as SetKey,
  aspect: 'Heroism',
  file: 'p1.json',
  contents: {
    leader: ref('ASH' as SetKey, 5),
    base: ref('ASH' as SetKey, 24),
    mainDeck: [ref('ASH' as SetKey, 72, 2), ref('LAW' as SetKey, 47, 3)],
    sideboard: [],
  },
};

describe('withPreconCards', () => {
  it('returns the same collection when no precon is owned', () => {
    const own = new Map<SetKey, Map<number, OwnedCounts>>();
    expect(withPreconCards(own, [precon], {})).toBe(own);
    expect(withPreconCards(own, [precon], { p1: 0 })).toBe(own);
  });

  it('adds the whole list as Normal copies, per copy of the precon', () => {
    const own = new Map<SetKey, Map<number, OwnedCounts>>([
      ['ASH' as SetKey, new Map([[72, { total: 1, byVariant: { hyperspace: 1 } }]])],
    ]);
    const out = withPreconCards(own, [precon], { p1: 2 });
    expect(out.get('ASH' as SetKey)?.get(72)).toEqual({
      total: 5,
      byVariant: { hyperspace: 1, normal: 4 },
    });
    expect(out.get('ASH' as SetKey)?.get(5)?.total).toBe(2);
    expect(out.get('LAW' as SetKey)?.get(47)?.total).toBe(6);
    // The input is left alone.
    expect(own.get('ASH' as SetKey)?.get(72)?.total).toBe(1);
  });
});
