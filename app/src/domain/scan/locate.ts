import {
  CAPTURE_HEIGHT,
  CAPTURE_WIDTH,
  HASH_WORDS,
  SAMPLE_HEIGHT,
  SAMPLE_WIDTH,
  areaResize,
  describe,
  hammingDistance,
  hashRegion,
  type Descriptor,
  type SamplePixels,
} from './descriptor';
import type { ScanIndex } from './index';

/**
 * Finding the card inside the guide.
 *
 * A hand-held card never fills the guide exactly: it sits a little small, or off-centre,
 * and a fingerprint of the whole guide then includes table and misses card — enough to
 * lose the match entirely. So the camera captures a scene a margin larger than the guide,
 * and this searches it for the card-shaped crop whose fingerprint lies closest to some
 * card in the index. The real card wins by a wide margin: a correctly framed crop is
 * nearly identical to its reference, while every misframed one is far from everything.
 */

/** Scene margin around the guide on each side, as a fraction of the guide. */
export const SCENE_MARGIN = 0.1;
/** The scene: the guide plus its margin, at capture resolution for the guide itself. */
export const SCENE_WIDTH = Math.round(CAPTURE_WIDTH * (1 + 2 * SCENE_MARGIN));
export const SCENE_HEIGHT = Math.round(CAPTURE_HEIGHT * (1 + 2 * SCENE_MARGIN));

/** A candidate card: its size as a fraction of the guide, and its centre in guide units. */
export type Placement = { size: number; cx: number; cy: number };

/** The card exactly filling the guide. */
export const GUIDE: Placement = { size: 1, cx: 0.5, cy: 0.5 };

const SIZES = [1.1, 1, 0.92, 0.85, 0.78, 0.72];
const OFFSETS = [-0.08, -0.04, 0, 0.04, 0.08];

/** The scene pixels a placement covers, or null when part of it falls outside the scene. */
function regionOf(p: Placement) {
  const width = p.size * CAPTURE_WIDTH;
  const height = p.size * CAPTURE_HEIGHT;
  const x = (SCENE_MARGIN + p.cx) * CAPTURE_WIDTH - width / 2;
  const y = (SCENE_MARGIN + p.cy) * CAPTURE_HEIGHT - height / 2;
  if (x < 0 || y < 0 || x + width > SCENE_WIDTH || y + height > SCENE_HEIGHT) return null;
  return { x, y, width, height };
}

/** Fingerprints one placement in the scene. */
export function describePlacement(scene: SamplePixels, p: Placement): Descriptor | null {
  if (scene.width !== SCENE_WIDTH || scene.height !== SCENE_HEIGHT) {
    throw new Error(
      `expected ${SCENE_WIDTH}x${SCENE_HEIGHT} pixels, got ${scene.width}x${scene.height}`,
    );
  }
  const region = regionOf(p);
  if (!region) return null;
  return describe({
    data: areaResize(scene, SAMPLE_WIDTH, SAMPLE_HEIGHT, region),
    width: SAMPLE_WIDTH,
    height: SAMPLE_HEIGHT,
  });
}

/** Hash bits to the nearest card in the index: how card-like a crop is. */
function nearestBits(index: ScanIndex, hash: Uint32Array): number {
  let best = Infinity;
  const count = index.entries.length;
  for (let i = 0; i < count; i++) {
    const bits = hammingDistance(hash, index.hashes, i * HASH_WORDS);
    if (bits < best) best = bits;
  }
  return best;
}

/** The search runs on the scene shrunk by this much: hashes only need 64x64 pixels. */
const SEARCH_SHRINK = 3;

export type Located = { placement: Placement; descriptor: Descriptor; bits: number };

/**
 * The placement of the card in the scene: a coarse grid over size and position, then two
 * rounds of refinement around the best so far, each at half the step. Candidates are
 * compared by hash alone on a shrunken scene; only the winner is fully fingerprinted.
 */
export function locateCard(scene: SamplePixels, index: ScanIndex): Located | null {
  const small = {
    data: areaResize(
      scene,
      Math.round(SCENE_WIDTH / SEARCH_SHRINK),
      Math.round(SCENE_HEIGHT / SEARCH_SHRINK),
    ),
    width: Math.round(SCENE_WIDTH / SEARCH_SHRINK),
    height: Math.round(SCENE_HEIGHT / SEARCH_SHRINK),
  };
  const kx = small.width / SCENE_WIDTH;
  const ky = small.height / SCENE_HEIGHT;
  let best: { placement: Placement; bits: number } | null = null;
  const consider = (p: Placement) => {
    const region = regionOf(p);
    if (!region) return;
    const hash = hashRegion(small, {
      x: region.x * kx,
      y: region.y * ky,
      width: region.width * kx,
      height: region.height * ky,
    });
    const bits = nearestBits(index, hash);
    if (!best || bits < best.bits) best = { placement: p, bits };
  };
  for (const size of SIZES) {
    for (const dx of OFFSETS) {
      for (const dy of OFFSETS) consider({ size, cx: 0.5 + dx, cy: 0.5 + dy });
    }
  }
  let sizeStep = 0.04;
  let offsetStep = 0.02;
  for (let round = 0; round < 2 && best; round++) {
    const centre: Placement = (best as { placement: Placement }).placement;
    for (const ds of [-sizeStep, 0, sizeStep]) {
      for (const dx of [-offsetStep, 0, offsetStep]) {
        for (const dy of [-offsetStep, 0, offsetStep]) {
          if (ds || dx || dy) {
            consider({ size: centre.size + ds, cx: centre.cx + dx, cy: centre.cy + dy });
          }
        }
      }
    }
    sizeStep /= 2;
    offsetStep /= 2;
  }
  if (!best) return null;
  const { placement, bits } = best as { placement: Placement; bits: number };
  const descriptor = describePlacement(scene, placement);
  return descriptor && { placement, descriptor, bits };
}

/**
 * Hash bits past which the card that was just scanned is no longer what sits where it was
 * found. Refocusing or re-exposing a card that hasn't moved stays well inside this (about
 * 30 bits, even blurred or dimmed); a hand reaching in, or the next card sliding or
 * dropping on top, goes past it for at least a frame.
 */
export const GONE_BITS = 64;

/** The card a scan fired on, and where in the scene it was found. */
export type Fired = { placement: Placement; entries: readonly number[] };

/**
 * Whether the scanned card has left its spot: what is there now is far from every picture
 * of it (`entries`, positions in the index). This is what tells a second copy of the same
 * card from the first one re-read, in a rig where the guide always holds some card.
 */
export function cardGone(scene: SamplePixels, fired: Fired, index: ScanIndex): boolean {
  const now = describePlacement(scene, fired.placement);
  if (!now) return true;
  let best = Infinity;
  for (const i of fired.entries) {
    best = Math.min(best, hammingDistance(now.hash, index.hashes, i * HASH_WORDS));
  }
  return best > GONE_BITS;
}

/** How much of the scene's height and width each edge band covers. */
const EDGE_BAND = 0.03;
/** Brightness spread above which an edge band holds part of a card, not table or rig. */
export const EDGE_BUSY = 24;

/**
 * Whether the card overflows the captured scene — the phone too close, so the card's
 * art and frame run into the scene's edges on both sides, where a framed card leaves
 * table or rig. Recognition needs the whole card, so this is worth saying out loud.
 */
export function cardOverflows(scene: SamplePixels): boolean {
  const { width: w, height: h, data } = scene;
  const spread = (x0: number, y0: number, x1: number, y1: number) => {
    let sum = 0;
    let squares = 0;
    let n = 0;
    for (let y = Math.floor(y0); y < y1; y += 2) {
      for (let x = Math.floor(x0); x < x1; x += 2) {
        const i = (y * w + x) * 4;
        const luma = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
        sum += luma;
        squares += luma * luma;
        n++;
      }
    }
    const mean = sum / n;
    return Math.sqrt(Math.max(0, squares / n - mean * mean));
  };
  const bh = Math.max(2, Math.round(h * EDGE_BAND));
  const bw = Math.max(2, Math.round(w * EDGE_BAND));
  // The middle half of each edge: corners can catch the card's rounded corner or the rig.
  const top = spread(w / 4, 0, (3 * w) / 4, bh);
  const bottom = spread(w / 4, h - bh, (3 * w) / 4, h);
  const left = spread(0, h / 4, bw, (3 * h) / 4);
  const right = spread(w - bw, h / 4, w, (3 * h) / 4);
  return (top >= EDGE_BUSY && bottom >= EDGE_BUSY) || (left >= EDGE_BUSY && right >= EDGE_BUSY);
}
