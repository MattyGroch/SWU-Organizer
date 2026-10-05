/**
 * Builds the scanner's reference index: one fingerprint per printing with its own artwork.
 *
 *   npx tsx scripts/build-scan-index.ts [--sets SOR,SHD] [--no-robust] [--download-only]
 *
 * Card images come from the swu-db.com CDN and are cached in ~/.cache/swu-organizer/card-art
 * (override with SWU_SCAN_CACHE), so a rebuild only downloads printings it has not seen.
 * Fingerprints use src/domain/scan/descriptor.ts — the same code the camera runs — after
 * sharp resizes each image to the sample size.
 *
 * Writes app/public/scan-data/index.bin (fingerprints) and index.json (which printing each is).
 *
 * Then self-tests, and exits non-zero if matching is not good enough:
 * - separation: every reference's nearest neighbour is itself or the same artwork;
 * - robustness: a camera-like distorted copy of each card (off-centre crop, slight tilt,
 *   lighting, blur, JPEG) still matches its own printing.
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp, { type Sharp } from 'sharp';

import {
  COLOR_BYTES,
  HASH_BITS,
  HASH_WORDS,
  CAPTURE_HEIGHT,
  CAPTURE_WIDTH,
  RAIL_BYTES,
  STRIP_BYTES,
  describeCapture,
  hammingDistance,
  type Descriptor,
} from '../src/domain/scan/descriptor';
import { packIndex, rankMatches, type ScanEntry, type ScanIndex } from '../src/domain/scan/index';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SETS_DIR = join(APP_DIR, 'public/sets');
const OUT_DIR = join(APP_DIR, 'public/scan-data');
const CACHE_DIR = process.env.SWU_SCAN_CACHE ?? join(homedir(), '.cache/swu-organizer/card-art');
const CDN = 'https://cdn.swu-db.com/images/cards';
const CONCURRENCY = 8;

/** Printings with their own picture. Foil SKUs share their sibling's art and 404 on the CDN;
 * a Prestige Serialized is its Prestige with a small stamp, so the camera cannot tell them
 * apart — the scanner reports the Prestige and the user picks Serialized by hand. */
const INDEXED = new Set(['normal', 'hyperspace', 'showcase', 'prestige']);

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

type Manifest = { sets: Array<{ key: string; file: string }> };
type CatalogFile = {
  cards: Array<{ base: number; name: string; printings: Array<{ num: string; variant: string }> }>;
};
type Ref = ScanEntry & { name: string; file: string };

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function references(): Promise<Ref[]> {
  const manifest = JSON.parse(await readFile(join(SETS_DIR, 'manifest.json'), 'utf8')) as Manifest;
  const only = option('--sets')?.split(',');
  const refs: Ref[] = [];
  for (const set of manifest.sets) {
    if (only && !only.includes(set.key)) continue;
    const catalog = JSON.parse(await readFile(join(SETS_DIR, set.file), 'utf8')) as CatalogFile;
    for (const card of catalog.cards) {
      for (const printing of card.printings) {
        if (!INDEXED.has(printing.variant)) continue;
        refs.push({
          setKey: set.key,
          num: printing.num,
          base: card.base,
          variant: printing.variant,
          name: card.name,
          file: join(CACHE_DIR, set.key, `${printing.num}.png`),
        });
      }
    }
  }
  return refs;
}

async function download(ref: Ref): Promise<boolean> {
  if (await exists(ref.file)) return true;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(`${CDN}/${ref.setKey}/${ref.num}.png`);
      if (response.status === 404 || response.status === 403) return false;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await mkdir(dirname(ref.file), { recursive: true });
      await writeFile(ref.file, Buffer.from(await response.arrayBuffer()));
      return true;
    } catch (error) {
      if (attempt === 3) {
        console.warn(`  ! ${ref.setKey} ${ref.num}: ${(error as Error).message}`);
        return false;
      }
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  return false;
}

async function inParallel<T>(items: T[], worker: (item: T, i: number) => Promise<void>) {
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < items.length) {
        const i = next++;
        await worker(items[i]!, i);
        if (++done % 250 === 0) process.stdout.write(`  ${done}/${items.length}\n`);
      }
    }),
  );
}

/** The capture the camera also produces, from any sharp pipeline, fingerprinted. */
async function sample(image: Sharp): Promise<Descriptor> {
  const { data, info } = await image
    .resize(CAPTURE_WIDTH, CAPTURE_HEIGHT, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return describeCapture({ data, width: info.width, height: info.height });
}

/** A deterministic pseudo-random number in [0, 1) per (card, salt). */
function jitter(i: number, salt: number): number {
  let x = (Math.imul(i + 1, 2654435761) ^ Math.imul(salt + 7, 40503)) >>> 0;
  x = (x ^ (x >>> 13)) >>> 0;
  x = Math.imul(x, 1274126177) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** What a phone camera might make of the card: off-centre in the guide, a little tilted,
 * differently lit, slightly soft, then JPEG-compressed. */
async function cameraLike(file: string, i: number): Promise<Descriptor> {
  const base = sharp(file);
  const meta = await base.metadata();
  const w = meta.width ?? 1000;
  const h = meta.height ?? 1400;
  const inset = (s: number) => Math.round((0.01 + 0.03 * jitter(i, s)) * Math.min(w, h));
  const left = inset(1);
  const top = inset(2);
  const width = w - left - inset(3);
  const height = h - top - inset(4);
  const jpeg = await sharp(file)
    .extract({ left, top, width, height })
    .rotate((jitter(i, 5) - 0.5) * 4, { background: { r: 40, g: 40, b: 40 } })
    .modulate({ brightness: 0.75 + 0.5 * jitter(i, 6), saturation: 0.85 + 0.3 * jitter(i, 7) })
    .blur(0.6 + jitter(i, 8))
    .jpeg({ quality: 60 })
    .toBuffer();
  return sample(sharp(jpeg));
}

async function main() {
  const all = await references();
  console.log(`Scan index: ${all.length} printings with their own art · cache ${CACHE_DIR}`);

  const available: boolean[] = new Array(all.length).fill(false);
  await inParallel(all, async (ref, i) => {
    available[i] = await download(ref);
  });
  const refs = all.filter((_, i) => available[i]);
  console.log(`Images: ${refs.length} available, ${all.length - refs.length} missing on the CDN`);
  if (flag('--download-only')) return;

  const descriptors: Descriptor[] = new Array(refs.length);
  await inParallel(refs, async (ref, i) => {
    descriptors[i] = await sample(sharp(ref.file));
  });

  const hashes = new Uint32Array(refs.length * HASH_WORDS);
  const colors = new Uint8Array(refs.length * COLOR_BYTES);
  const strips = new Uint8Array(refs.length * STRIP_BYTES);
  const rails = new Uint8Array(refs.length * RAIL_BYTES);
  descriptors.forEach((d, i) => {
    hashes.set(d.hash, i * HASH_WORDS);
    colors.set(d.color, i * COLOR_BYTES);
    strips.set(d.strip, i * STRIP_BYTES);
    rails.set(d.rails, i * RAIL_BYTES);
  });

  const scanIndex: ScanIndex = {
    entries: refs.map(({ setKey, num, base, variant }) => ({ setKey, num, base, variant })),
    hashes,
    colors,
    strips,
    rails,
  };

  await mkdir(OUT_DIR, { recursive: true });
  const entries: ScanEntry[] = refs.map(({ setKey, num, base, variant }) => ({
    setKey,
    num,
    base,
    variant,
  }));
  const { bin, json } = packIndex(entries, descriptors);
  await writeFile(join(OUT_DIR, 'index.bin'), bin);
  await writeFile(join(OUT_DIR, 'index.json'), JSON.stringify(json));
  console.log(
    `Wrote scan-data/index.bin (${(bin.length / 1024).toFixed(0)} KB) and scan-data/index.json · ${HASH_BITS}-bit hash`,
  );

  // ---- Self-test: separation ----
  const sameCard = (a: Ref, b: Ref) => a.name === b.name;
  let collisions = 0;
  let crossCard = 0;
  let minNormalHyper = Infinity;
  const examples: string[] = [];
  // Hash distance to every other reference, directly: each one's nearest neighbour, and the
  // closest Normal/Hyperspace pair of the same card (the hard case).
  for (let i = 0; i < refs.length; i++) {
    const a = refs[i]!;
    let nearest = -1;
    let nearestBits = Infinity;
    for (let j = 0; j < refs.length; j++) {
      if (j === i) continue;
      const bits = hammingDistance(descriptors[i]!.hash, hashes, j * HASH_WORDS);
      if (bits < nearestBits) {
        nearestBits = bits;
        nearest = j;
      }
      const c = refs[j]!;
      if (
        a.variant === 'normal' &&
        c.variant === 'hyperspace' &&
        c.setKey === a.setKey &&
        c.base === a.base
      ) {
        minNormalHyper = Math.min(minNormalHyper, bits);
      }
    }
    if (nearestBits === 0) {
      const b = refs[nearest]!;
      collisions++;
      if (!sameCard(a, b)) {
        crossCard++;
        if (examples.length < 8)
          examples.push(`${a.setKey} ${a.num} ${a.name} ≡ ${b.setKey} ${b.num} ${b.name}`);
      }
    }
  }
  console.log(
    `\nSeparation: ${collisions} references share an identical fingerprint with another ` +
      `(${collisions - crossCard} same card — reprints/identical art; ${crossCard} different cards)`,
  );
  for (const e of examples) console.log(`  different cards, identical hash: ${e}`);
  console.log(`  Normal vs Hyperspace of the same card: closest pair ${minNormalHyper} bits apart`);

  // ---- Self-test: robustness ----
  if (!flag('--no-robust')) {
    let exact = 0;
    let card = 0;
    let top3 = 0;
    const margins: number[] = [];
    await inParallel(refs, async (ref, i) => {
      const query = await cameraLike(ref.file, i);
      const ranked = rankMatches(scanIndex, query, 5);
      const top = ranked[0]!;
      const hit = refs[top.index]!;
      const same = (r: { index: number }) => {
        const x = refs[r.index]!;
        return x.setKey === ref.setKey && x.num === ref.num;
      };
      if (same(top)) exact++;
      if (hit.name === ref.name && hit.variant === ref.variant) card++;
      if (ranked.slice(0, 3).some(same)) top3++;
      if (same(top) && ranked[1]) margins.push(ranked[1].score - top.score);
    });
    margins.sort((a, b) => a - b);
    const pct = (n: number) => `${((100 * n) / refs.length).toFixed(1)}%`;
    console.log(`\nRobustness (camera-like copy of every card):`);
    console.log(
      `  exact printing first: ${pct(exact)} · right card & treatment first: ${pct(card)} · exact printing in top 3: ${pct(top3)}`,
    );
    console.log(
      `  winning margin over runner-up: 10th percentile ${margins[Math.floor(margins.length * 0.1)]?.toFixed(1)}, median ${margins[margins.length >> 1]?.toFixed(1)}`,
    );
    if (card / refs.length < 0.95) {
      console.error(
        '\n✖ Robustness below 95% — the fingerprint is not good enough for the camera.',
      );
      process.exitCode = 1;
    }
  }
  if (crossCard > 0) {
    console.error(`\n✖ ${crossCard} different cards share a fingerprint.`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
