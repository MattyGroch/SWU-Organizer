import { describe as suite, expect, it } from 'vitest';

import { CAPTURE_HEIGHT, CAPTURE_WIDTH, describeCapture, type Descriptor } from './descriptor';
import { packIndex, parseIndex, rankMatches } from './index';
import {
  GUIDE,
  SCENE_HEIGHT,
  SCENE_MARGIN,
  SCENE_WIDTH,
  cardGone,
  cardOverflows,
  describePlacement,
  locateCard,
} from './locate';

/** Seeded per-card texture with energy at every frequency, like real art. */
function artPixel(card: number, x: number, y: number): number {
  let seed =
    Math.imul(((x >> 3) + 1) * 977 + ((y >> 3) + 1) * 7919, 2654435761 + card * 40503) >>> 0;
  seed = (seed ^ (seed >>> 15)) >>> 0;
  seed = Math.imul(seed, 2246822519) >>> 0;
  return 30 + (((seed ^ (seed >>> 13)) >>> 0) % 200);
}

/** A card's reference capture: its art filling CAPTURE_WIDTH x CAPTURE_HEIGHT. */
function reference(card: number): Descriptor {
  const data = new Uint8ClampedArray(CAPTURE_WIDTH * CAPTURE_HEIGHT * 4);
  for (let y = 0; y < CAPTURE_HEIGHT; y++) {
    for (let x = 0; x < CAPTURE_WIDTH; x++) {
      const v = artPixel(card, x, y);
      data.set([v, v * 0.8, v * 0.6, 255], (y * CAPTURE_WIDTH + x) * 4);
    }
  }
  return describeCapture({ data, width: CAPTURE_WIDTH, height: CAPTURE_HEIGHT });
}

/** A scene: plain table, with the card at `size` of the guide, centred at (cx, cy). */
function scene(card: number, size: number, cx: number, cy: number) {
  const data = new Uint8ClampedArray(SCENE_WIDTH * SCENE_HEIGHT * 4);
  const w = size * CAPTURE_WIDTH;
  const h = size * CAPTURE_HEIGHT;
  const left = (SCENE_MARGIN + cx) * CAPTURE_WIDTH - w / 2;
  const top = (SCENE_MARGIN + cy) * CAPTURE_HEIGHT - h / 2;
  for (let y = 0; y < SCENE_HEIGHT; y++) {
    for (let x = 0; x < SCENE_WIDTH; x++) {
      const u = (x - left) / size;
      const v = (y - top) / size;
      const inside = u >= 0 && v >= 0 && u < CAPTURE_WIDTH && v < CAPTURE_HEIGHT;
      const p = inside ? artPixel(card, Math.floor(u), Math.floor(v)) : 0;
      data.set(inside ? [p, p * 0.8, p * 0.6, 255] : [120, 95, 70, 255], (y * SCENE_WIDTH + x) * 4);
    }
  }
  return { data, width: SCENE_WIDTH, height: SCENE_HEIGHT };
}

const cards = [0, 1, 2, 3, 4, 5];
const { bin, json } = packIndex(
  cards.map((c) => ({ setKey: 'SOR', num: String(c), base: c, variant: 'normal' })),
  cards.map(reference),
);
const index = parseIndex(bin.buffer as ArrayBuffer, json);

suite('locateCard', () => {
  it('finds a card sitting small and off-centre in the guide', () => {
    const view = scene(3, 0.8, 0.45, 0.55);
    const located = locateCard(view, index)!;
    expect(located.placement.size).toBeCloseTo(0.8, 1);
    expect(rankMatches(index, located.descriptor, 1)[0]!.entry.num).toBe('3');
    // Fingerprinting the guide as-is is what failed before: far worse than located.
    const fixed = rankMatches(index, describePlacement(view, GUIDE)!, 1)[0]!;
    expect(located.bits).toBeLessThan(fixed.bits / 2);
  });

  it('scores an empty table as far from every card', () => {
    const table = scene(0, 0, 0.5, 0.5);
    expect(locateCard(table, index)!.bits).toBeGreaterThan(64);
  });

  it('refuses a scene of the wrong size', () => {
    expect(() =>
      describePlacement({ data: new Uint8Array(16), width: 2, height: 2 }, GUIDE),
    ).toThrow(/expected/);
  });

  it('notices a card too close to see whole: it runs into the edges of the scene', () => {
    expect(cardOverflows(scene(2, 0.85, 0.5, 0.5))).toBe(false);
    expect(cardOverflows(scene(2, 1.0, 0.5, 0.5))).toBe(false);
    expect(cardOverflows(scene(2, 1.35, 0.5, 0.5))).toBe(true);
    expect(cardOverflows(scene(0, 0, 0.5, 0.5))).toBe(false);
  });
});

suite('cardGone', () => {
  /** The scene with every pixel passed through `f`: a lighting change, a blur, a hand. */
  const edit = (
    view: ReturnType<typeof scene>,
    f: (rgb: [number, number, number], x: number, y: number) => [number, number, number],
  ) => {
    const data = new Uint8ClampedArray(view.data);
    for (let y = 0; y < view.height; y++) {
      for (let x = 0; x < view.width; x++) {
        const i = (y * view.width + x) * 4;
        data.set(f([data[i]!, data[i + 1]!, data[i + 2]!], x, y), i);
      }
    }
    return { ...view, data };
  };
  /** A box blur over `r` pixels: a phone hunting for focus. */
  const blur = (view: ReturnType<typeof scene>, r: number) => {
    const { width: w, height: h, data } = view;
    const out = new Uint8ClampedArray(data);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          let n = 0;
          for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
              const xx = Math.min(w - 1, Math.max(0, x + dx));
              const yy = Math.min(h - 1, Math.max(0, y + dy));
              sum += data[(yy * w + xx) * 4 + c]!;
              n++;
            }
          }
          out[(y * w + x) * 4 + c] = sum / n;
        }
      }
    }
    return { ...view, data: out };
  };

  const view = scene(2, 0.9, 0.5, 0.5);
  const located = locateCard(view, index)!;
  const fired = { placement: located.placement, entries: [2] };

  it('keeps a card that hasn’t moved, refocused or re-exposed', () => {
    expect(cardGone(view, fired, index)).toBe(false);
    expect(cardGone(blur(view, 2), fired, index)).toBe(false);
    expect(
      cardGone(
        edit(view, ([r, g, b]) => [r * 0.6, g * 0.6, b * 0.6]),
        fired,
        index,
      ),
    ).toBe(false);
  });

  it('sees it go when another card takes its place — even the same card is a new copy then', () => {
    expect(cardGone(scene(4, 0.9, 0.5, 0.5), fired, index)).toBe(true);
    // A hand reaching over half the card, on its way to put the next one down.
    const hand = edit(view, (rgb, x) => (x < view.width / 2 ? [200, 160, 140] : rgb));
    expect(cardGone(hand, fired, index)).toBe(true);
  });
});
