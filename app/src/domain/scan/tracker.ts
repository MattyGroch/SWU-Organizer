import { hammingDistance, type Descriptor } from './descriptor';

/**
 * Decides when a camera frame is worth acting on.
 *
 * Frames arrive several times a second. A match is reported only once the picture has held
 * still for a few frames — a card still moving into the guide is blurred and half-framed —
 * and then not again until the picture has clearly changed. That second rule is what lets
 * a stack be fed through hands-free: each card fires once, and lifting it away (or sliding
 * the next one in) re-arms the scanner, even for two copies of the same card in a row.
 */

export type TrackerOptions = {
  /** Consecutive frames whose hashes stay within `steadyBits` of each other. */
  steadyFrames: number;
  steadyBits: number;
  /** After firing, the picture must move this far from what fired before it can fire again. */
  releaseBits: number;
};

export const DEFAULT_TRACKER: TrackerOptions = { steadyFrames: 3, steadyBits: 24, releaseBits: 70 };

export type TrackerEvent = 'moving' | 'steady' | 'fired' | 'holding';

export function createTracker(options: TrackerOptions = DEFAULT_TRACKER) {
  let previous: Descriptor | null = null;
  let steadyCount = 0;
  let firedOn: Descriptor | null = null;

  return {
    /** Feed one frame; returns what the scanner should do with it. */
    observe(frame: Descriptor): TrackerEvent {
      const steady =
        previous !== null && hammingDistance(frame.hash, previous.hash) <= options.steadyBits;
      previous = frame;
      steadyCount = steady ? steadyCount + 1 : 0;

      if (firedOn) {
        if (hammingDistance(frame.hash, firedOn.hash) <= options.releaseBits) return 'holding';
        firedOn = null;
      }
      if (steadyCount + 1 < options.steadyFrames) return steady ? 'steady' : 'moving';
      firedOn = frame;
      steadyCount = 0;
      return 'fired';
    },
    /** Forget the last card, so the one in view can fire again (e.g. after a mode change). */
    reset() {
      previous = null;
      steadyCount = 0;
      firedOn = null;
    },
  };
}

/** Misses on one card before the scanner stops retrying it and asks the user instead. */
export const MAX_MISSES = 5;

/**
 * Whether the view could be a card at all: how much brightness varies across its 8×8
 * colour grid. A card's art, text boxes and frame vary a lot — 99% of the index above 22,
 * median 47 — while an empty table or a bare scanning rig sits near zero. Only a card-like
 * view counts toward MAX_MISSES, so nothing in the guide never trips "not recognised".
 */
export const CARD_LIKE_SPREAD = 15;

export function looksLikeCard(frame: Descriptor): boolean {
  const cells = frame.color.length / 3;
  let sum = 0;
  let sumSquares = 0;
  for (let i = 0; i < cells; i++) {
    const luma =
      0.299 * frame.color[i * 3]! +
      0.587 * frame.color[i * 3 + 1]! +
      0.114 * frame.color[i * 3 + 2]!;
    sum += luma;
    sumSquares += luma * luma;
  }
  const mean = sum / cells;
  return Math.sqrt(Math.max(0, sumSquares / cells - mean * mean)) >= CARD_LIKE_SPREAD;
}

/**
 * Counts consecutive failed scans of the same card. A card the index doesn't know — a
 * promo, another game — would otherwise be retried forever. A miss whose picture is far
 * from the last one (`releaseBits`, as for the tracker) is a different card: the count
 * starts again.
 */
export function createMissCounter(options: TrackerOptions = DEFAULT_TRACKER) {
  let last: Descriptor | null = null;
  let count = 0;
  return {
    /** Records a miss; returns how many in a row this card has had. */
    miss(frame: Descriptor): number {
      const same = last !== null && hammingDistance(frame.hash, last.hash) <= options.releaseBits;
      count = same ? count + 1 : 1;
      last = frame;
      return count;
    },
    /** A card was recognised, or the user dealt with the one in view. */
    reset() {
      last = null;
      count = 0;
    },
  };
}
