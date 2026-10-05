import { describe, expect, it } from 'vitest';

import { COLOR_BYTES, HASH_WORDS, RAIL_BYTES, STRIP_BYTES, type Descriptor } from './descriptor';
import { MAX_MISSES, createMissCounter, createTracker, looksLikeCard } from './tracker';

/** A frame whose hash has the first `ones` bits set — so frames differ by known bit counts. */
function frame(ones: number): Descriptor {
  const hash = new Uint32Array(HASH_WORDS);
  for (let i = 0; i < ones; i++) hash[i >> 5]! |= 1 << (i & 31);
  return {
    hash,
    color: new Uint8Array(COLOR_BYTES),
    strip: new Uint8Array(STRIP_BYTES),
    rails: new Uint8Array(RAIL_BYTES),
  };
}

const options = { steadyFrames: 3, steadyBits: 10, releaseBits: 50 };

describe('scan tracker', () => {
  it('fires once the picture has held still for a few frames', () => {
    const t = createTracker(options);
    expect(t.observe(frame(0))).toBe('moving');
    expect(t.observe(frame(4))).toBe('steady');
    expect(t.observe(frame(6))).toBe('fired');
  });

  it('does not fire while the card is still moving', () => {
    const t = createTracker(options);
    const events = [0, 40, 80, 120, 160].map((n) => t.observe(frame(n)));
    expect(events).not.toContain('fired');
  });

  it('fires once per card, however long it stays in view', () => {
    const t = createTracker(options);
    const events = [0, 2, 4, 3, 5, 2, 4, 3].map((n) => t.observe(frame(n)));
    expect(events.filter((e) => e === 'fired')).toHaveLength(1);
    expect(events.at(-1)).toBe('holding');
  });

  it('re-arms when the card is swapped, even for a second copy of the same card', () => {
    const t = createTracker(options);
    [0, 2, 4].forEach((n) => t.observe(frame(n))); // fired on card A
    t.observe(frame(200)); // hand in the way: a very different picture
    // The same card again:
    const again = [0, 2, 4].map((n) => t.observe(frame(n)));
    expect(again).toContain('fired');
  });

  it('can be reset to fire on the card already in view', () => {
    const t = createTracker(options);
    [0, 2, 4].forEach((n) => t.observe(frame(n)));
    t.reset();
    expect([3, 2, 4].map((n) => t.observe(frame(n)))).toContain('fired');
  });
});

describe('miss counter', () => {
  it('counts misses on the same card, up to the point of asking', () => {
    const counter = createMissCounter();
    let count = 0;
    for (let i = 0; i < MAX_MISSES; i++) count = counter.miss(frame(10 + (i % 2)));
    expect(count).toBe(MAX_MISSES);
  });

  it('starts again for a different card, and after a reset', () => {
    const counter = createMissCounter();
    counter.miss(frame(10));
    counter.miss(frame(10));
    expect(counter.miss(frame(200))).toBe(1);
    counter.reset();
    expect(counter.miss(frame(200))).toBe(1);
  });
});

describe('looksLikeCard', () => {
  const withColors = (luma: (cell: number) => number): Descriptor => ({
    ...frame(0),
    color: Uint8Array.from({ length: COLOR_BYTES }, (_, i) => luma(Math.floor(i / 3))),
  });

  it('sees a varied picture as a possible card', () => {
    expect(looksLikeCard(withColors((cell) => (cell % 2 ? 200 : 60)))).toBe(true);
  });

  it('sees an empty table as nothing to retry', () => {
    expect(looksLikeCard(withColors(() => 120))).toBe(false);
    expect(looksLikeCard(withColors((cell) => 110 + (cell % 3) * 5))).toBe(false);
  });
});
