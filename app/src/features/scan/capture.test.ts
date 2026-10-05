import { describe, expect, it } from 'vitest';

import { guideRect, toScreen } from './capture';

describe('guide framing', () => {
  it('is centred at the card aspect, filling most of the frame', () => {
    const r = guideRect(1920, 1080, 'portrait');
    expect(r.height).toBeCloseTo(864);
    expect(r.width / r.height).toBeCloseTo(5 / 7);
    expect(r.x + r.width / 2).toBeCloseTo(960);
  });

  it('turns sideways for Leaders and Bases, and never overflows a narrow frame', () => {
    const r = guideRect(1080, 1920, 'landscape');
    expect(r.width / r.height).toBeCloseTo(7 / 5);
    expect(r.width).toBeLessThanOrEqual(1080 * 0.8 + 1e-9);
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
