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
