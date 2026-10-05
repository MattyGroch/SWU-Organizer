/**
 * Card fingerprints for the scanner.
 *
 * One implementation serves both sides of matching: the index builder (Node, images decoded
 * by `sharp`) and the camera (browser, frames drawn to a canvas). Each side does exactly one
 * thing itself — resize the card to a SAMPLE_WIDTH × SAMPLE_HEIGHT RGBA sample — and hands
 * the pixels here. Everything after that is this code, so the two cannot drift apart.
 *
 * A fingerprint has four parts, used in two stages (see `rankMatches` in ./index):
 *
 * 1. Which card is it?
 *    - hash: a 256-bit perceptual hash — the low frequencies of the greyscale card's DCT,
 *      each bit "above or below the median". Captures layout and artwork, and shrugs off
 *      lighting and blur.
 *    - color: the mean colour of each cell of an 8 × 8 grid. SWU frames are coloured by
 *      aspect, which breaks ties the greyscale hash cannot.
 *
 * 2. Which printing of that card? Normal and Hyperspace printings share their artwork; what
 *    differs is the frame. A Normal card frames the art with straight vertical rails down
 *    each side and a dark border; Hyperspace art runs to the edge. A whole-card hash mostly
 *    sees the shared art, so two features look only at the sides:
 *    - rails: how strongly a straight vertical line runs down each side band, beside the art.
 *      A rail gives the same left-right brightness step in one column all the way down; art
 *      does not. Colour cannot do this job — dark artwork looks like a black frame.
 *    - strip: colour and texture of the outermost edge bands.
 *
 * Measured against camera-like copies of every card (off-centre, tilted, relit, blurred,
 * JPEG): see scripts/build-scan-index.ts, which runs that test on every index build.
 */

/** The fingerprint sample: portrait, card-shaped (5:7). */
export const SAMPLE_WIDTH = 160;
export const SAMPLE_HEIGHT = 224;

/**
 * The one size each side resizes a card to before handing it over: three times the sample.
 * Browsers shrink canvases with a cruder filter than sharp does, worst across a big ratio;
 * resizing only to this capture size keeps that step mild, and the exact area-average down
 * to the sample is then this module's own code on both sides.
 */
export const CAPTURE_WIDTH = SAMPLE_WIDTH * 3;
export const CAPTURE_HEIGHT = SAMPLE_HEIGHT * 3;

/** The hash is computed on a square, stretched down-sample of the card. */
export const HASH_SAMPLE = 64;
/** Side of the low-frequency DCT block kept: HASH_SIDE² bits. */
export const HASH_SIDE = 16;
export const HASH_BITS = HASH_SIDE * HASH_SIDE;
export const HASH_WORDS = HASH_BITS / 32;

export const COLOR_GRID = 8;
export const COLOR_BYTES = COLOR_GRID * COLOR_GRID * 3;

/** Edge strips: left and right columns of the square sample, in row blocks. */
const STRIP_COLUMNS: ReadonlyArray<readonly [number, number]> = [
  [1, 7],
  [57, 63],
];
const STRIP_ROWS = { from: 8, to: 56, step: 6 };
/** Per block: mean R, G, B and a luma-spread value. */
export const STRIP_BYTES =
  STRIP_COLUMNS.length * ((STRIP_ROWS.to - STRIP_ROWS.from) / STRIP_ROWS.step) * 4;

/** Rails: side bands (fractions of the width) and the stretches of art height measured. */
const RAIL_BANDS: ReadonlyArray<readonly [number, number]> = [
  [0.04, 0.13],
  [0.87, 0.96],
];
/** Short segments, so a card tilted a degree or two still reads as a straight line in each. */
const RAIL_SEGMENTS: ReadonlyArray<readonly [number, number]> = [
  [0.15, 0.26],
  [0.26, 0.37],
  [0.37, 0.48],
  [0.48, 0.6],
];
export const RAIL_BYTES = RAIL_BANDS.length;

export type Descriptor = {
  /** HASH_BITS bits, packed into 32-bit words. */
  hash: Uint32Array;
  color: Uint8Array;
  strip: Uint8Array;
  rails: Uint8Array;
};

/** RGBA pixels, as from canvas getImageData or sharp raw(). */
export type SamplePixels = { data: Uint8Array | Uint8ClampedArray; width: number; height: number };

const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * Area-averaging resize of RGBA pixels (optionally of just a region of them): every source
 * pixel contributes in proportion to how much of it each destination pixel covers.
 * Deterministic, so both sides agree exactly. The region must lie inside the source.
 */
export function areaResize(
  src: SamplePixels,
  width: number,
  height: number,
  region: { x: number; y: number; width: number; height: number } = {
    x: 0,
    y: 0,
    width: src.width,
    height: src.height,
  },
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  const sx = region.width / width;
  const sy = region.height / height;
  for (let y = 0; y < height; y++) {
    const y0 = region.y + y * sy;
    const y1 = y0 + sy;
    for (let x = 0; x < width; x++) {
      const x0 = region.x + x * sx;
      const x1 = x0 + sx;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let total = 0;
      for (let py = Math.floor(y0); py < Math.ceil(y1); py++) {
        const wy = Math.min(y1, py + 1) - Math.max(y0, py);
        for (let px = Math.floor(x0); px < Math.ceil(x1); px++) {
          const w = wy * (Math.min(x1, px + 1) - Math.max(x0, px));
          const i = (py * src.width + px) * 4;
          r += src.data[i]! * w;
          g += src.data[i + 1]! * w;
          b += src.data[i + 2]! * w;
          a += src.data[i + 3]! * w;
          total += w;
        }
      }
      const o = (y * width + x) * 4;
      out[o] = r / total;
      out[o + 1] = g / total;
      out[o + 2] = b / total;
      out[o + 3] = a / total;
    }
  }
  return out;
}

const COS = (() => {
  const n = HASH_SAMPLE;
  const table = new Float64Array(n * n);
  for (let k = 0; k < n; k++) {
    for (let x = 0; x < n; x++) table[k * n + x] = Math.cos(((2 * x + 1) * k * Math.PI) / (2 * n));
  }
  return table;
})();

/** Low-frequency HASH_SIDE × HASH_SIDE block of the 2-D DCT of a HASH_SAMPLE² signal. */
export function lowFrequencyDct(values: Float64Array): Float64Array {
  const n = HASH_SAMPLE;
  const m = HASH_SIDE;
  const rows = new Float64Array(n * m);
  for (let y = 0; y < n; y++) {
    for (let u = 0; u < m; u++) {
      let sum = 0;
      for (let x = 0; x < n; x++) sum += values[y * n + x]! * COS[u * n + x]!;
      rows[y * m + u] = sum;
    }
  }
  const out = new Float64Array(m * m);
  for (let v = 0; v < m; v++) {
    for (let u = 0; u < m; u++) {
      let sum = 0;
      for (let y = 0; y < n; y++) sum += rows[y * m + u]! * COS[v * n + y]!;
      out[v * m + u] = sum;
    }
  }
  return out;
}

function hashOf(square: Uint8ClampedArray): Uint32Array {
  const n = HASH_SAMPLE;
  const values = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++)
    values[i] = luma(square[i * 4]!, square[i * 4 + 1]!, square[i * 4 + 2]!);
  // The DC term is overall brightness: excluded from the median so lighting cannot shift
  // every bit, but still hashed.
  const dct = lowFrequencyDct(values);
  const ac = Array.from(dct.slice(1)).sort((a, b) => a - b);
  const median = (ac[(ac.length - 1) >> 1]! + ac[ac.length >> 1]!) / 2;
  const hash = new Uint32Array(HASH_WORDS);
  for (let i = 0; i < HASH_BITS; i++) {
    if (dct[i]! > median) hash[i >> 5]! |= 1 << (i & 31);
  }
  return hash;
}

function colorOf(square: Uint8ClampedArray): Uint8Array {
  const n = HASH_SAMPLE;
  const cell = n / COLOR_GRID;
  const color = new Uint8Array(COLOR_BYTES);
  for (let gy = 0; gy < COLOR_GRID; gy++) {
    for (let gx = 0; gx < COLOR_GRID; gx++) {
      const sum = [0, 0, 0];
      for (let y = gy * cell; y < (gy + 1) * cell; y++) {
        for (let x = gx * cell; x < (gx + 1) * cell; x++) {
          const i = (y * n + x) * 4;
          sum[0]! += square[i]!;
          sum[1]! += square[i + 1]!;
          sum[2]! += square[i + 2]!;
        }
      }
      const o = (gy * COLOR_GRID + gx) * 3;
      for (let c = 0; c < 3; c++) color[o + c] = Math.round(sum[c]! / (cell * cell));
    }
  }
  return color;
}

function stripOf(square: Uint8ClampedArray): Uint8Array {
  const n = HASH_SAMPLE;
  const out = new Uint8Array(STRIP_BYTES);
  let o = 0;
  for (const [x0, x1] of STRIP_COLUMNS) {
    for (let y0 = STRIP_ROWS.from; y0 < STRIP_ROWS.to; y0 += STRIP_ROWS.step) {
      const sum = [0, 0, 0];
      const lumas: number[] = [];
      for (let y = y0; y < y0 + STRIP_ROWS.step; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * n + x) * 4;
          sum[0]! += square[i]!;
          sum[1]! += square[i + 1]!;
          sum[2]! += square[i + 2]!;
          lumas.push(luma(square[i]!, square[i + 1]!, square[i + 2]!));
        }
      }
      const count = lumas.length;
      const mean = lumas.reduce((a, b) => a + b, 0) / count;
      const spread = Math.sqrt(lumas.reduce((a, b) => a + (b - mean) ** 2, 0) / count);
      out[o++] = Math.round(sum[0]! / count);
      out[o++] = Math.round(sum[1]! / count);
      out[o++] = Math.round(sum[2]! / count);
      out[o++] = Math.min(255, Math.round(spread * 2));
    }
  }
  return out;
}

function railsOf(sample: SamplePixels): Uint8Array {
  const { width: w, height: h, data } = sample;
  const grey = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) grey[i] = luma(data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!);
  const out = new Uint8Array(RAIL_BYTES);
  RAIL_BANDS.forEach(([a, b], side) => {
    let total = 0;
    for (const [s0, s1] of RAIL_SEGMENTS) {
      const y0 = Math.round(h * s0);
      const y1 = Math.round(h * s1);
      let best = 0;
      for (let x = Math.round(w * a); x < Math.round(w * b); x++) {
        let step = 0;
        for (let y = y0; y < y1; y++) step += grey[y * w + x + 1]! - grey[y * w + x]!;
        best = Math.max(best, Math.abs(step / (y1 - y0)));
      }
      total += best;
    }
    out[side] = Math.min(255, Math.round(total / RAIL_SEGMENTS.length));
  });
  return out;
}

/** Just the hash of a region of some pixels — the cheap part of a fingerprint, for searching. */
export function hashRegion(
  pixels: SamplePixels,
  region: { x: number; y: number; width: number; height: number },
): Uint32Array {
  return hashOf(areaResize(pixels, HASH_SAMPLE, HASH_SAMPLE, region));
}

export function describe(sample: SamplePixels): Descriptor {
  if (sample.width !== SAMPLE_WIDTH || sample.height !== SAMPLE_HEIGHT) {
    throw new Error(
      `expected ${SAMPLE_WIDTH}x${SAMPLE_HEIGHT} pixels, got ${sample.width}x${sample.height}`,
    );
  }
  const square = areaResize(sample, HASH_SAMPLE, HASH_SAMPLE);
  return {
    hash: hashOf(square),
    color: colorOf(square),
    strip: stripOf(square),
    rails: railsOf(sample),
  };
}

/** Fingerprints a CAPTURE_WIDTH × CAPTURE_HEIGHT capture — what both sides actually call. */
export function describeCapture(capture: SamplePixels): Descriptor {
  if (capture.width !== CAPTURE_WIDTH || capture.height !== CAPTURE_HEIGHT) {
    throw new Error(
      `expected ${CAPTURE_WIDTH}x${CAPTURE_HEIGHT} pixels, got ${capture.width}x${capture.height}`,
    );
  }
  return describe({
    data: areaResize(capture, SAMPLE_WIDTH, SAMPLE_HEIGHT),
    width: SAMPLE_WIDTH,
    height: SAMPLE_HEIGHT,
  });
}

function popcount32(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Bits that differ between two hashes: 0 = identical, HASH_BITS = opposite. */
export function hammingDistance(a: Uint32Array, b: Uint32Array, bOffset = 0): number {
  let distance = 0;
  for (let w = 0; w < HASH_WORDS; w++) distance += popcount32((a[w]! ^ b[bOffset + w]!) >>> 0);
  return distance;
}

/** Mean absolute difference between two byte vectors of `length`, 0–255. */
export function byteDistance(
  a: Uint8Array,
  b: Uint8Array,
  bOffset: number,
  length: number,
): number {
  let sum = 0;
  for (let i = 0; i < length; i++) sum += Math.abs(a[i]! - b[bOffset + i]!);
  return sum / length;
}
