import { describe as suite, expect, it } from 'vitest';

import {
  COLOR_BYTES,
  HASH_BITS,
  HASH_SAMPLE,
  RAIL_BYTES,
  SAMPLE_HEIGHT,
  SAMPLE_WIDTH,
  STRIP_BYTES,
  areaResize,
  byteDistance,
  describe,
  hammingDistance,
  lowFrequencyDct,
} from './descriptor';

type Rgb = [number, number, number];

/** A card-sized sample from a per-pixel colour function. */
function sample(fn: (x: number, y: number) => Rgb) {
  const data = new Uint8ClampedArray(SAMPLE_WIDTH * SAMPLE_HEIGHT * 4);
  for (let y = 0; y < SAMPLE_HEIGHT; y++) {
    for (let x = 0; x < SAMPLE_WIDTH; x++) {
      const [r, g, b] = fn(x, y);
      const i = (y * SAMPLE_WIDTH + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { data, width: SAMPLE_WIDTH, height: SAMPLE_HEIGHT };
}

/** Seeded texture with energy at every frequency, like real art (unsigned arithmetic). */
const noise = Array.from({ length: SAMPLE_WIDTH * SAMPLE_HEIGHT }, (_, i) => {
  let seed = Math.imul(i + 1, 2654435761) >>> 0;
  seed = (seed ^ (seed >>> 15)) >>> 0;
  seed = Math.imul(seed, 2246822519) >>> 0;
  return ((seed ^ (seed >>> 13)) >>> 0) % 200;
});
const art = (x: number, y: number, gain = 1, lift = 0): Rgb => {
  const v = Math.min(255, noise[y * SAMPLE_WIDTH + x]! * gain + 20 + lift);
  return [v, v * 0.8, v * 0.6];
};

/** A "Normal" card: the art, framed by straight dark rails down each side. */
const railColumns = new Set([12, 13, 146, 147]);
/** The turned equivalent: rows in the top and bottom bands. */
const crossRows = new Set([12, 13, 210, 211]);
const framed = sample((x, y) => (railColumns.has(x) ? [10, 10, 30] : art(x, y)));
const fullBleed = sample((x, y) => art(x, y));

suite('areaResize', () => {
  it('averages exactly, so both sides of matching agree', () => {
    const src = {
      data: Uint8ClampedArray.from([0, 0, 0, 255, 100, 100, 100, 255]),
      width: 2,
      height: 1,
    };
    expect(Array.from(areaResize(src, 1, 1))).toEqual([50, 50, 50, 255]);
  });
});

suite('lowFrequencyDct', () => {
  it('puts a flat image entirely in the DC term', () => {
    const out = lowFrequencyDct(new Float64Array(HASH_SAMPLE * HASH_SAMPLE).fill(100));
    expect(out[0]).toBeCloseTo(100 * HASH_SAMPLE * HASH_SAMPLE);
    expect(Math.max(...Array.from(out.slice(1)).map(Math.abs))).toBeLessThan(1e-6);
  });
});

suite('describe', () => {
  it('is deterministic and sized as declared', () => {
    const a = describe(fullBleed);
    expect(a.hash.length * 32).toBe(HASH_BITS);
    expect([a.color.length, a.strip.length, a.rails.length]).toEqual([
      COLOR_BYTES,
      STRIP_BYTES,
      RAIL_BYTES,
    ]);
    expect(hammingDistance(a.hash, describe(fullBleed).hash)).toBe(0);
  });

  it('shrugs off lighting, which a camera always changes', () => {
    const base = describe(fullBleed).hash;
    expect(
      hammingDistance(base, describe(sample((x, y) => art(x, y, 0.7))).hash),
    ).toBeLessThanOrEqual(4);
    expect(
      hammingDistance(base, describe(sample((x, y) => art(x, y, 1, 25))).hash),
    ).toBeLessThanOrEqual(4);
  });

  it('tells different artwork far apart', () => {
    const other = sample((x, y) => art(SAMPLE_WIDTH - 1 - x, y));
    expect(hammingDistance(describe(fullBleed).hash, describe(other).hash)).toBeGreaterThan(64);
  });

  it('reads straight side rails, the mark of a Normal printing, and none on full-bleed art', () => {
    const withRails = describe(framed).rails;
    const without = describe(fullBleed).rails;
    for (const side of [0, 1]) {
      expect(withRails[side]).toBeGreaterThan(3 * without[side]!);
    }
  });

  it('reads the same rails across the top and bottom of a sideways card turned upright', () => {
    // A Leader's frame, turned into the portrait guide, runs horizontally.
    const turned = sample((x, y) => (crossRows.has(y) ? [10, 10, 30] : art(x, y)));
    const withRails = describe(turned).rails;
    const without = describe(fullBleed).rails;
    expect(RAIL_BYTES).toBe(4);
    for (const side of [2, 3]) {
      expect(withRails[side]).toBeGreaterThan(3 * without[side]!);
    }
  });

  it('refuses a sample of the wrong size rather than fingerprinting garbage', () => {
    expect(() => describe({ data: new Uint8Array(16), width: 2, height: 2 })).toThrow(
      /expected 160x224/,
    );
  });
});

suite('byteDistance', () => {
  it('is the mean absolute difference', () => {
    expect(byteDistance(Uint8Array.from([0, 10]), Uint8Array.from([9, 4, 20]), 1, 2)).toBe(7);
  });
});
