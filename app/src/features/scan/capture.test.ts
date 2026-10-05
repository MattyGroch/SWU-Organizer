import { describe, expect, it } from 'vitest';

import { guideRect, toScreen } from './capture';

describe('guide framing', () => {
  it('is centred at the card aspect, filling most of the frame', () => {
    const r = guideRect(1920, 1080);
    expect(r.height).toBeCloseTo(864);
    expect(r.width / r.height).toBeCloseTo(5 / 7);
    expect(r.x + r.width / 2).toBeCloseTo(960);
  });

  it('is always portrait — Leaders and Bases are scanned turned — and fits a narrow frame', () => {
    const r = guideRect(1080, 1920);
    expect(r.width / r.height).toBeCloseTo(5 / 7);
    expect(r.width).toBeLessThanOrEqual(1080 * 0.8 + 1e-9);
  });

  it('stays inside the part of the video the viewfinder shows', () => {
    // A tall 1080x1920 video in a squat 400x400 box: only the middle 1080x1080 is visible.
    const view = { width: 400, height: 400 };
    const r = guideRect(1080, 1920, view);
    const onScreen = toScreen(r, { width: 1080, height: 1920 }, view);
    expect(onScreen.y).toBeGreaterThanOrEqual(0);
    expect(onScreen.y + onScreen.height).toBeLessThanOrEqual(400 + 1e-9);
    expect(onScreen.height).toBeCloseTo(320);
  });

  it('maps to the screen through object-fit: cover, so the box shows what gets captured', () => {
    // A 1920x1080 video covering a 400x800 portrait screen: scaled to 800 tall, cropped sides.
    const onScreen = toScreen(
      { x: 960, y: 540, width: 0, height: 0 },
      { width: 1920, height: 1080 },
      { width: 400, height: 800 },
    );
    expect(onScreen.x).toBeCloseTo(200);
    expect(onScreen.y).toBeCloseTo(400);
  });
});
