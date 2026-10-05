import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import type { Descriptor, SamplePixels } from '~/domain/scan/descriptor';
import { rankMatches, type Match, type ScanIndex } from '~/domain/scan/index';
import { GUIDE, describePlacement, locateCard } from '~/domain/scan/locate';
import {
  MAX_MISSES,
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
   * Whether the guide showed no card (an empty rig, a hand, the table) since the previous
   * scan. Without one, a result for the same card is that card re-read — a phone close to
   * a card keeps refocusing and re-exposing, which can shift the picture enough to fire
   * again — not a second copy.
   */
  afterGap: boolean;
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
  /** Seen a view with no card in it since the last result? Starts true: nothing came before. */
  const gapRef = useRef(true);
  /** Set after MAX_MISSES on one card: no more tries until the user looks it up or skips. */
  const stuckRef = useRef(false);
  const [phase, setPhase] = useState<TrackerEvent | 'idle' | 'unknown' | 'stuck'>('idle');
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
      if (!video || video.readyState < 2 || stuckRef.current) return;
      let scene: SamplePixels | null;
      let frame: Descriptor | null;
      try {
        scene = captureScene(video, viewRef.current, canvasRef.current!);
        frame = scene && describePlacement(scene, GUIDE);
      } catch {
        return;
      }
      if (!scene || !frame) return;
      if (!looksLikeCard(frame)) gapRef.current = true;
      const event = trackerRef.current.observe(frame);
      if (event !== 'fired') {
        // After a miss the tracker is re-armed and keeps retrying the same view: keep
        // saying so until the view moves.
        setPhase((current) => (current === 'unknown' && event !== 'moving' ? current : event));
        return;
      }
      try {
        const located = locateCard(scene, index);
        if (!located || located.bits > NO_CARD_BITS) {
          if (looksLikeCard(frame) && missesRef.current.miss(frame) >= MAX_MISSES) {
            // Stop retrying a card the index doesn't know. The tracker stays fired on it,
            // so after resume() it waits for the next card rather than trying again.
            stuckRef.current = true;
            setPhase('stuck');
            return;
          }
          trackerRef.current.reset();
          setPhase('unknown');
          return;
        }
        missesRef.current.reset();
        setPhase('fired');
        const afterGap = gapRef.current;
        gapRef.current = false;
        onResultRef.current({
          matches: rankMatches(index, located.descriptor, 8),
          at: Date.now(),
          afterGap,
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
    setPhase('holding');
  }, []);

  return { phase, rearm, resume };
}
