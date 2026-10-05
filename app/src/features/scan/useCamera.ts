import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The camera, as a <video> element to read frames from.
 *
 * Asks for the rear camera at high resolution (a phone's back camera; a laptop falls back
 * to its webcam), in 4:3: the shape of a phone's sensor, so the stream is the camera's
 * whole field of view. A 16:9 stream is a crop of that sensor, which then gets cropped
 * again to fill the 3:4 frame — together about 1.33x zoom, so a card has to be held well
 * above where the phone's own camera app would need it. Browsers only allow cameras on secure pages — https, or localhost — and
 * only after the user grants permission, so every way this can fail is a state the page
 * explains rather than an exception.
 */

export type CameraState =
  | 'idle'
  | 'starting'
  | 'live'
  /** The user (or a site setting) said no. */
  | 'denied'
  /** No camera, or the page is not secure (camera APIs are missing on plain http). */
  | 'unavailable'
  | 'error';

/** `torch` is a real capability on phones but not yet in TypeScript's DOM types. */
type TorchCapabilities = { torch?: boolean };
type TorchTrack = Omit<MediaStreamTrack, 'getCapabilities'> & {
  getCapabilities?: () => TorchCapabilities;
};

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CameraState>('idle');
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setTorchOn(false);
    setTorchAvailable(false);
    setState('idle');
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('unavailable');
      return;
    }
    setState('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1440 },
          aspectRatio: { ideal: 4 / 3 },
        },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => {});
      }
      const track = stream.getVideoTracks()[0] as TorchTrack | undefined;
      setTorchAvailable(Boolean(track?.getCapabilities?.().torch));
      setState('live');
    } catch (error) {
      const name = (error as DOMException).name;
      setState(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'denied'
          : name === 'NotFoundError' || name === 'OverconstrainedError'
            ? 'unavailable'
            : 'error',
      );
    }
  }, []);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch {
      setTorchAvailable(false);
    }
  }, [torchOn]);

  // Release the camera when the page goes away, so its light turns off.
  useEffect(() => stop, [stop]);

  return { videoRef, state, start, stop, torchAvailable, torchOn, toggleTorch };
}
