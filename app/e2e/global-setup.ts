import { mkdir, stat, writeFile } from 'node:fs/promises';

import sharp, { type Sharp } from 'sharp';

import { CACHE_DIR, CAMERA_CARD, FAKE_CAMERA, UNKNOWN_CAMERA } from './paths';

/** A webcam-shaped frame. */
const WIDTH = 1280;
const HEIGHT = 720;
const TABLE = { r: 120, g: 95, b: 70 };

/**
 * Writes the fake camera's video: the card on a table, at about 85% of the scan guide's
 * height and a little off-centre, tilted a degree — a hand-held card, not a perfect crop.
 * The card image comes from the CDN once and is kept in e2e/.cache.
 */
export default async function globalSetup() {
  await mkdir(CACHE_DIR, { recursive: true });
  const art = `${CACHE_DIR}${CAMERA_CARD.setKey}-${CAMERA_CARD.num}.png`;
  if (!(await exists(art))) {
    const url = `https://cdn.swu-db.com/images/cards/${CAMERA_CARD.setKey}/${CAMERA_CARD.num}.png`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not fetch ${url}: ${response.status}`);
    await writeFile(art, Buffer.from(await response.arrayBuffer()));
  }

  await writeFile(FAKE_CAMERA, await cameraFrame(sharp(art), 18, -10));
  await writeFile(
    UNKNOWN_CAMERA,
    await cameraFrame(sharp(art).flop().negate({ alpha: false }), 0, 0),
  );
}

/**
 * One camera video: the card on a table, at about 85% of the scan guide's height, offset
 * by (dx, dy) and tilted a degree — a hand-held card, not a perfect crop.
 */
async function cameraFrame(card: Sharp, dx: number, dy: number): Promise<Buffer> {
  // The guide is 80% of the frame height at 5:7; the card fills ~85% of that.
  const cardHeight = Math.round(HEIGHT * 0.8 * 0.85);
  const cardWidth = Math.round((cardHeight * 5) / 7);
  const picture = await card
    .resize(cardWidth, cardHeight, { fit: 'fill' })
    .rotate(1, { background: TABLE })
    .png()
    .toBuffer();
  const meta = await sharp(picture).metadata();
  const { data } = await sharp({
    create: { width: WIDTH, height: HEIGHT, channels: 3, background: TABLE },
  })
    .composite([
      {
        input: picture,
        left: Math.round(WIDTH / 2 - meta.width! / 2 + dx),
        top: Math.round(HEIGHT / 2 - meta.height! / 2 + dy),
      },
    ])
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return toY4m(data, WIDTH, HEIGHT, 2);
}

/** RGB → YUV4MPEG2 (4:2:0), the uncompressed format Chromium's fake camera plays. */
function toY4m(rgb: Buffer, width: number, height: number, frames: number): Buffer {
  const y = Buffer.alloc(width * height);
  const u = Buffer.alloc((width / 2) * (height / 2));
  const v = Buffer.alloc((width / 2) * (height / 2));
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = (row * width + col) * 3;
      const [r, g, b] = [rgb[i]!, rgb[i + 1]!, rgb[i + 2]!];
      y[row * width + col] = clamp(0.299 * r + 0.587 * g + 0.114 * b);
      if (row % 2 === 0 && col % 2 === 0) {
        const j = (row / 2) * (width / 2) + col / 2;
        u[j] = clamp(128 - 0.168736 * r - 0.331264 * g + 0.5 * b);
        v[j] = clamp(128 + 0.5 * r - 0.418688 * g - 0.081312 * b);
      }
    }
  }
  const header = Buffer.from(`YUV4MPEG2 W${width} H${height} F30:1 Ip A1:1 C420jpeg\n`);
  const frame = Buffer.concat([Buffer.from('FRAME\n'), y, u, v]);
  return Buffer.concat([header, ...Array.from({ length: frames }, () => frame)]);
}

const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

async function exists(path: string) {
  return stat(path).then(
    () => true,
    () => false,
  );
}
