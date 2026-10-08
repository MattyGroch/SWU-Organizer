import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import { hammingDistance, type Descriptor, type SamplePixels } from '~/domain/scan/descriptor';
import {
  rankMatches,
  twinsOf,
  type Match,
  type ScanEntry,
  type ScanIndex,
} from '~/domain/scan/index';
import {
  GUIDE,
  cardGone,
  cardOverflows,
  describePlacement,
  locateCard,
  type Fired,
} from '~/domain/scan/locate';
import {
  MAX_MISSES,
  DEFAULT_TRACKER,
  createMissCounter,
  createTracker,
  looksLikeCard,
  type TrackerEvent,
} from '~/domain/scan/tracker';

import { captureScene, type View } from './capture';

/** How often a frame is fingerprinted. Fast enough to feel instant, light on the battery. */
const FRAME_INTERVAL_MS = 150;
/**
 * A located card further than this (hash bits) from every card in the index is not a card
 * the index knows — a table, a hand, glare. Cards land around 20; non-cards around 80.
 */
const NO_CARD_BITS = 64;

export type ScanResult = {
  /** Best first; the first is what was recognised. */
  matches: Match[];
  at: number;
  /**
   * Whether the previous scan's card left the guide since: the view went empty, or
   * something else took the card's place for a moment (a hand, the next card landing on
   * top). Without that, a result for the same card is that card re-read — a phone close to
   * a card keeps refocusing and re-exposing, which can shift the picture enough to fire
   * again — not a second copy.
   */
  afterGap: boolean;
  /** The card ran past the captured frame — the phone is too close for a sure read. */
  tooClose: boolean;
  /**
   * Pictures in other sets that look just like the top match's — the same art reprinted,
   * which the camera can't tell apart (see `twinsOf`).
   */
  twins?: ScanEntry[];
};

/**
 * The scanning loop: fingerprint the guide every FRAME_INTERVAL_MS, and once the tracker
 * says a card has settled, rank it against the index and report it.
 */
export function useScanner({
  videoRef,
  index,
  view,
  active,
  onResult,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  index: ScanIndex | undefined;
  /** The on-screen viewfinder box, which decides where the guide is. */
  view: View | null;
  active: boolean;
  onResult: (result: ScanResult) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const trackerRef = useRef(createTracker());
  const missesRef = useRef(createMissCounter());
  /**
   * The view a miss was reported for. Its message ("too close", "can't make out a card")
   * stays up while the view stays put — retries re-arm the tracker, whose first frame
   * always reads as moving, so the tracker alone can't say when the view really changed.
   */
  const missedRef = useRef<Descriptor | null>(null);
  /**
   * Has the last scanned card left the guide since its result? Starts true: nothing came
   * before. An empty view counts, and so does anything else taking the card's place — a
   * hand, or the next card landing on top in a rig that is never empty.
   */
  const gapRef = useRef(true);
  /** The card the last result was for, and where it sat: watched to see it leave. */
  const firedRef = useRef<Fired | null>(null);
  /** Set after MAX_MISSES on one card: no more tries until the user looks it up or skips. */
  const stuckRef = useRef(false);
  /** The view it gave up on: while paused, a clearly different view resumes scanning. */
  const stuckOnRef = useRef<Descriptor | null>(null);
  const [phase, setPhase] = useState<TrackerEvent | 'idle' | 'unknown' | 'stuck' | 'tooClose'>(
    'idle',
  );
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    if (!active || !index) {
      setPhase('idle');
      return;
    }
    canvasRef.current ??= document.createElement('canvas');
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;
      let scene: SamplePixels | null;
      let frame: Descriptor | null;
      try {
        scene = captureScene(video, viewRef.current, canvasRef.current!);
        frame = scene && describePlacement(scene, GUIDE);
      } catch {
        return;
      }
      if (!scene || !frame) return;
      if (stuckRef.current) {
        // Paused on "couldn't recognise", but still watching: a card dropped into an
        // empty tray changes the view enough to clear the prompt and carry on, untouched.
        const stuckOn = stuckOnRef.current;
        if (stuckOn && hammingDistance(frame.hash, stuckOn.hash) > DEFAULT_TRACKER.releaseBits) {
          stuckRef.current = false;
          stuckOnRef.current = null;
          missesRef.current.reset();
          missedRef.current = null;
          trackerRef.current.reset();
          setPhase('moving');
        }
        return;
      }
      if (!gapRef.current) {
        const fired = firedRef.current;
        if (!looksLikeCard(frame) || (fired && cardGone(scene, fired, index))) {
          gapRef.current = true;
        }
      }
      const event = trackerRef.current.observe(frame);
      if (event !== 'fired') {
        const missed = missedRef.current;
        if (missed && hammingDistance(frame.hash, missed.hash) <= DEFAULT_TRACKER.releaseBits) {
          return; // still the view that missed: keep its message
        }
        missedRef.current = null;
        setPhase(event);
        return;
      }
      try {
        const located = locateCard(scene, index);
        if (!located || located.bits > NO_CARD_BITS) {
          // A card running off the frame can't be read whole: say so, and don't count it
          // toward giving up — moving the phone back fixes it.
          if (cardOverflows(scene)) {
            trackerRef.current.reset();
            missedRef.current = frame;
            setPhase('tooClose');
            return;
          }
          if (looksLikeCard(frame) && missesRef.current.miss(frame) >= MAX_MISSES) {
            // Stop retrying a card the index doesn't know. The tracker stays fired on it,
            // so after resume() it waits for the next card rather than trying again.
            stuckRef.current = true;
            stuckOnRef.current = frame;
            setPhase('stuck');
            return;
          }
          trackerRef.current.reset();
          missedRef.current = frame;
          setPhase('unknown');
          return;
        }
        missesRef.current.reset();
        missedRef.current = null;
        setPhase('fired');
        const afterGap = gapRef.current;
        gapRef.current = false;
        const matches = rankMatches(index, located.descriptor, 8);
        const top = matches[0]?.entry;
        firedRef.current = top
          ? {
              placement: located.placement,
              entries: index.entries.flatMap((e, i) =>
                e.setKey === top.setKey && e.base === top.base ? [i] : [],
              ),
            }
          : null;
        onResultRef.current({
          matches,
          at: Date.now(),
          afterGap,
          tooClose: cardOverflows(scene),
          twins: matches[0] ? twinsOf(index, matches[0]) : [],
        });
      } catch (error) {
        console.error('Scan failed', error);
        trackerRef.current.reset();
        setPhase('unknown');
      }
    }, FRAME_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [active, index, videoRef]);

  /** Lets the card already in view fire again — after Rescan or a mode change. */
  const rearm = useCallback(() => trackerRef.current.reset(), []);

  /**
   * Scanning again after a card it gave up on was looked up or skipped. The card still in
   * view does not fire again; the next one does.
   */
  const resume = useCallback(() => {
    missesRef.current.reset();
    stuckRef.current = false;
    stuckOnRef.current = null;
    setPhase('holding');
  }, []);

  /**
   * Quick Scan's "Scan next card": the card was swapped while scanning was paused, so the
   * scanner never saw it leave. The user's say-so counts as that gap — the next card fires
   * even if it is another copy of the same one. The tracker stays fired on the old view, so
   * a card left in place still does not fire again.
   */
  const next = useCallback(() => {
    gapRef.current = true;
  }, []);

  /** "Rescan" on the prompt: try again now, on whatever is in view. */
  const retry = useCallback(() => {
    missesRef.current.reset();
    stuckRef.current = false;
    stuckOnRef.current = null;
    missedRef.current = null;
    trackerRef.current.reset();
    setPhase('moving');
  }, []);

  return { phase, rearm, resume, retry, next };
}
