import { describe, expect, it } from 'vitest';

import { foilMask, frameOf, matteBoxes, turnAnticlockwise, type Box } from './foilMask';

const inside = ([x1, y1, x2, y2]: Box) =>
  x1 >= 0 && y1 >= 0 && x2 <= 100 && y2 <= 100 && x1 < x2 && y1 < y2;
const covers = (boxes: readonly Box[], x: number, y: number) =>
  boxes.some(([x1, y1, x2, y2]) => x >= x1 && x <= x2 && y >= y1 && y <= y2);

describe('matteBoxes', () => {
  it('keeps every box on the card', () => {
    for (const type of ['Unit', 'Upgrade', 'Event', 'Leader', 'Base']) {
      for (const artNumber of ['059', 'SOROP-014', 'HMWP-37']) {
        for (const hasSubtitle of [false, true]) {
          for (const aspects of [0, 1, 2, 3]) {
            const boxes = matteBoxes({ type, hasSubtitle, aspects, artNumber });
            expect(boxes.every(inside)).toBe(true);
          }
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

  it('keeps an event’s traits strip matte, under its title', () => {
    expect(covers(matteBoxes({ type: 'Event', hasSubtitle: false, aspects: 1 }), 55, 14)).toBe(
      true,
    );
  });

  it('follows the full-art promo frames', () => {
    expect(frameOf('059')).toBe('standard');
    expect(frameOf('SOROP-014')).toBe('promo-light');
    expect(frameOf('HMWP-37')).toBe('promo-dark');
    // A one-off line whose layout isn't measured falls back to the standard frame.
    expect(frameOf('C26-2')).toBe('standard');

    // A dark promo event's rules text sits in the top third; the standard frame's runs to half way.
    const event = (artNumber: string) =>
      matteBoxes({ type: 'Event', hasSubtitle: false, aspects: 1, artNumber });
    expect(covers(event('HMWP-37'), 50, 45)).toBe(false);
    expect(covers(event('217'), 50, 45)).toBe(true);
    // A dark promo unit's rules text starts lower than the standard frame's.
    const unit = (artNumber: string) =>
      matteBoxes({ type: 'Unit', hasSubtitle: false, aspects: 1, artNumber });
    expect(covers(unit('HMWP-39'), 50, 72)).toBe(true);
    expect(covers(unit('HMWP-39'), 50, 64)).toBe(false);
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
    expect(foilMask({ ...card, artNumber: 'HMWP-39' })).not.toBe(mask);
  });
});
