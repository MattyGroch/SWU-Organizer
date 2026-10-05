import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import type { Descriptor, SamplePixels } from '~/domain/scan/descriptor';
import { rankMatches, type Match, type ScanIndex } from '~/domain/scan/index';
import { GUIDE, describePlacement, locateCard } from '~/domain/scan/locate';
import { createTracker, type TrackerEvent } from '~/domain/scan/tracker';

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
  const [phase, setPhase] = useState<TrackerEvent | 'idle' | 'unknown'>('idle');
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
          trackerRef.current.reset();
          setPhase('unknown');
          return;
        }
        setPhase('fired');
        onResultRef.current({ matches: rankMatches(index, located.descriptor, 8), at: Date.now() });
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

  return { phase, rearm };
}
