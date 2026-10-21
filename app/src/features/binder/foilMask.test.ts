import { describe, expect, it } from 'vitest';

import { foilMask, matteBoxes, turnAnticlockwise, type Box } from './foilMask';

const inside = ([x1, y1, x2, y2]: Box) =>
  x1 >= 0 && y1 >= 0 && x2 <= 100 && y2 <= 100 && x1 < x2 && y1 < y2;
const covers = (boxes: readonly Box[], x: number, y: number) =>
  boxes.some(([x1, y1, x2, y2]) => x >= x1 && x <= x2 && y >= y1 && y <= y2);

describe('matteBoxes', () => {
  it('keeps every box on the card', () => {
    for (const type of ['Unit', 'Upgrade', 'Event', 'Leader', 'Base']) {
      for (const hasSubtitle of [false, true]) {
        for (const aspects of [0, 1, 2]) {
          expect(matteBoxes({ type, hasSubtitle, aspects }).every(inside)).toBe(true);
        }
      }
    }
  });

  it('adds the subtitle box only for cards that have a subtitle', () => {
    const unit = (hasSubtitle: boolean) => matteBoxes({ type: 'Unit', hasSubtitle, aspects: 1 });
    // The middle of a subtitle (~12.5% down), clear of the title above it.
    expect(covers(unit(true), 55, 12.5)).toBe(true);
    expect(covers(unit(false), 55, 12.5)).toBe(false);
  });

  it('keeps a unit’s game information matte and its art foil', () => {
    const boxes = matteBoxes({ type: 'Unit', hasSubtitle: false, aspects: 1 });
    expect(covers(boxes, 50, 8)).toBe(true); // the title
    expect(covers(boxes, 8, 8)).toBe(true); // the cost
    expect(covers(boxes, 10, 63)).toBe(true); // power
    expect(covers(boxes, 90, 63)).toBe(true); // HP
    expect(covers(boxes, 50, 80)).toBe(true); // the rules text
    expect(covers(boxes, 50, 40)).toBe(false); // the art
  });

  it('masks one aspect icon per aspect', () => {
    const below = (aspects: number) =>
      covers(matteBoxes({ type: 'Unit', hasSubtitle: false, aspects }), 10, 22);
    expect(below(1)).toBe(false); // one icon ends at 19%
    expect(below(2)).toBe(true);
  });

  it('turns a sideways card’s boxes into the pocket’s frame', () => {
    // The printed top-right corner lands top-left in the pocket.
    expect(turnAnticlockwise([90, 0, 100, 10])).toEqual([0, 0, 10, 10]);
    // A leader's art (printed left) is the pocket's lower half: foil. Its rules (printed right) are matte.
    const leader = matteBoxes({ type: 'Leader', hasSubtitle: true, aspects: 2 });
    expect(covers(leader, 50, 80)).toBe(false);
    expect(covers(leader, 50, 30)).toBe(true);
  });
});

describe('foilMask', () => {
  it('is a CSS image, the same string each time for the same layout', () => {
    const card = { type: 'Unit', hasSubtitle: true, aspects: 2 };
    const mask = foilMask(card);
    expect(mask).toMatch(/^url\("data:image\/svg\+xml,/);
    expect(foilMask({ ...card })).toBe(mask);
    expect(foilMask({ ...card, aspects: 1 })).not.toBe(mask);
  });
});
