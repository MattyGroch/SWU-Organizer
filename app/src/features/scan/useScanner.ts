import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import type { Descriptor } from '~/domain/scan/descriptor';
import { rankMatches, type Match, type ScanIndex } from '~/domain/scan/index';
import { createTracker, type TrackerEvent } from '~/domain/scan/tracker';

import { captureGuide, type Orientation } from './capture';

/** How often a frame is fingerprinted. Fast enough to feel instant, light on the battery. */
const FRAME_INTERVAL_MS = 150;

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
  orientation,
  active,
  onResult,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  index: ScanIndex | undefined;
  orientation: Orientation;
  active: boolean;
  onResult: (result: ScanResult) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const trackerRef = useRef(createTracker());
  const [phase, setPhase] = useState<TrackerEvent | 'idle'>('idle');
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  // A different orientation frames a different region: start fresh.
  useEffect(() => trackerRef.current.reset(), [orientation]);

  useEffect(() => {
    if (!active || !index) {
      setPhase('idle');
      return;
    }
    canvasRef.current ??= document.createElement('canvas');
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;
      let frame: Descriptor | null;
      try {
        frame = captureGuide(video, orientation, canvasRef.current!);
      } catch {
        return;
      }
      if (!frame) return;
      const event = trackerRef.current.observe(frame);
      setPhase(event);
      if (event === 'fired') {
        onResultRef.current({ matches: rankMatches(index, frame, 8), at: Date.now() });
      }
    }, FRAME_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [active, index, orientation, videoRef]);

  /** Lets the card already in view fire again — after Rescan or a mode change. */
  const rearm = useCallback(() => trackerRef.current.reset(), []);

  return { phase, rearm };
}
