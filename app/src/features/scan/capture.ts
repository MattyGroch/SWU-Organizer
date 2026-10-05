import {
  CAPTURE_HEIGHT,
  CAPTURE_WIDTH,
  describeCapture,
  type Descriptor,
} from '~/domain/scan/descriptor';

/**
 * Framing and capturing: turning a camera frame into a fingerprint.
 *
 * The guide is defined in the video's own pixels, then drawn on screen by mapping those
 * pixels through the same object-fit: cover transform the <video> uses — so the box on
 * screen and the crop that gets fingerprinted are the same region.
 */

export type Orientation = 'portrait' | 'landscape';

/** SWU cards are 5:7; Leaders and Bases lie sideways at 7:5. */
const ASPECT: Record<Orientation, number> = { portrait: 5 / 7, landscape: 7 / 5 };
/** How much of the frame the guide fills: room to hold the card, without wasting pixels. */
const FILL = 0.8;

export type Rect = { x: number; y: number; width: number; height: number };

/** The guide, in video pixels: centred, as large as FILL allows at the card's aspect. */
export function guideRect(videoWidth: number, videoHeight: number, orientation: Orientation): Rect {
  const aspect = ASPECT[orientation];
  let height = videoHeight * FILL;
  let width = height * aspect;
  if (width > videoWidth * FILL) {
    width = videoWidth * FILL;
    height = width / aspect;
  }
  return { x: (videoWidth - width) / 2, y: (videoHeight - height) / 2, width, height };
}

/** Where a video-pixel rectangle appears on screen inside an object-fit: cover element. */
export function toScreen(
  rect: Rect,
  video: { width: number; height: number },
  box: { width: number; height: number },
): Rect {
  const scale = Math.max(box.width / video.width, box.height / video.height);
  const offsetX = (box.width - video.width * scale) / 2;
  const offsetY = (box.height - video.height * scale) / 2;
  return {
    x: offsetX + rect.x * scale,
    y: offsetY + rect.y * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  };
}

/**
 * Fingerprints whatever is inside the guide. Landscape cards are stretched into the
 * portrait capture, exactly as the index builder stretches their reference images.
 */
export function captureGuide(
  video: HTMLVideoElement,
  orientation: Orientation,
  canvas: HTMLCanvasElement,
): Descriptor | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const rect = guideRect(vw, vh, orientation);
  canvas.width = CAPTURE_WIDTH;
  canvas.height = CAPTURE_HEIGHT;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    video,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    CAPTURE_WIDTH,
    CAPTURE_HEIGHT,
  );
  const image = context.getImageData(0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);
  return describeCapture(image);
}
