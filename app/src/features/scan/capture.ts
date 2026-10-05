import type { SamplePixels } from '~/domain/scan/descriptor';
import { SCENE_HEIGHT, SCENE_MARGIN, SCENE_WIDTH } from '~/domain/scan/locate';

/**
 * Framing and capturing: turning a camera frame into a fingerprint.
 *
 * The guide is defined in the video's own pixels, then drawn on screen by mapping those
 * pixels through the same object-fit: cover transform the <video> uses — so the box on
 * screen and the crop that gets fingerprinted are the same region.
 */

/**
 * The guide is always portrait, 5:7. Leaders and Bases (7:5) are scanned turned on their
 * side, either way round: the index holds them at both turns.
 */
const ASPECT = 5 / 7;
/**
 * How much of the frame the guide fills: room to hold the card, without wasting pixels.
 * The guide plus SCENE_MARGIN on each side must still fit in the frame.
 */
const FILL = 0.8;

export type Rect = { x: number; y: number; width: number; height: number };

/** The on-screen box the video fills (object-fit: cover), which may crop the video. */
export type View = { width: number; height: number };

/**
 * The guide, in video pixels: centred, as large as FILL allows at the card's aspect —
 * within the part of the video the view actually shows, so the whole guide is on screen.
 */
export function guideRect(videoWidth: number, videoHeight: number, view?: View | null): Rect {
  let visibleWidth = videoWidth;
  let visibleHeight = videoHeight;
  if (view?.width && view.height) {
    const scale = Math.max(view.width / videoWidth, view.height / videoHeight);
    visibleWidth = Math.min(videoWidth, view.width / scale);
    visibleHeight = Math.min(videoHeight, view.height / scale);
  }

  let height = visibleHeight * FILL;
  let width = height * ASPECT;
  if (width > visibleWidth * FILL) {
    width = visibleWidth * FILL;
    height = width / ASPECT;
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
 * Captures the guide plus SCENE_MARGIN around it — room for locateCard to find a card that
 * sits small or off-centre in the guide.
 */
export function captureScene(
  video: HTMLVideoElement,
  view: View | null,
  canvas: HTMLCanvasElement,
): SamplePixels | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const rect = guideRect(vw, vh, view);
  canvas.width = SCENE_WIDTH;
  canvas.height = SCENE_HEIGHT;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    video,
    rect.x - rect.width * SCENE_MARGIN,
    rect.y - rect.height * SCENE_MARGIN,
    rect.width * (1 + 2 * SCENE_MARGIN),
    rect.height * (1 + 2 * SCENE_MARGIN),
    0,
    0,
    SCENE_WIDTH,
    SCENE_HEIGHT,
  );
  return context.getImageData(0, 0, SCENE_WIDTH, SCENE_HEIGHT);
}
