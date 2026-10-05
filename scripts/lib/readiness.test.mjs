import { describe, expect, it } from 'vitest';

import { missingNumbers, requiredArt } from './readiness.mjs';

describe('requiredArt', () => {
  it('lists each printing with its own art, and Leader backs, but not foil duplicates', () => {
    const urls = requiredArt({
      setKey: 'HMW',
      cards: [
        {
          base: 5,
          doubleSided: true,
          printings: [
            { num: '005', variant: 'normal' },
            { num: '277', variant: 'hyperspace' },
          ],
        },
        {
          base: 60,
          printings: [
            { num: '060', variant: 'normal' },
            { num: '060F', variant: 'foil' },
          ],
        },
      ],
    });
    expect(urls.map((u) => u.split('/cards/')[1])).toEqual([
      'HMW/005.png',
      'HMW/005-b.png',
      'HMW/277.png',
      'HMW/277-b.png',
      'HMW/060.png',
    ]);
  });
});

describe('missingNumbers', () => {
  const set = (...nums) => ({ cards: [{ printings: nums.map((num) => ({ num })) }] });

  it('finds the cards of the main run not yet published', () => {
    expect(missingNumbers(set('001', '002', '004', '263', '263F'), 4)).toEqual([3]);
  });

  it('counts a run complete whatever variants follow it', () => {
    expect(missingNumbers(set('001', '002', '003', '269', '300'), 3)).toEqual([]);
  });

  it('judges by art alone when no total is listed', () => {
    expect(missingNumbers(set('001'), undefined)).toEqual([]);
  });
});
