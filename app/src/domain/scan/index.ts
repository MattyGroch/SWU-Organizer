import {
  COLOR_BYTES,
  HASH_BITS,
  HASH_WORDS,
  RAIL_BYTES,
  SAMPLE_HEIGHT,
  SAMPLE_WIDTH,
  STRIP_BYTES,
  byteDistance,
  hammingDistance,
  type Descriptor,
} from './descriptor';

/**
 * The scanner's reference index, and matching against it.
 *
 * Built by scripts/build-scan-index.ts and served as two files: `index.bin` holds the
 * packed fingerprints, `index.json` says which printing each is. Matching is brute force —
 * a few thousand 256-bit XOR + popcounts take a millisecond or two, so no search structure
 * is needed.
 */

export type ScanEntry = { setKey: string; num: string; base: number; variant: string };

export type ScanIndex = {
  entries: ScanEntry[];
  /** HASH_WORDS words per entry. */
  hashes: Uint32Array;
  /** COLOR_BYTES per entry. */
  colors: Uint8Array;
  /** STRIP_BYTES per entry. */
  strips: Uint8Array;
  /** RAIL_BYTES per entry. */
  rails: Uint8Array;
};

export type IndexJson = {
  version: 1;
  hashBits: number;
  sample: [number, number];
  /** [setKey, num, base, variant] per entry, in index.bin order. */
  entries: Array<[string, string, number, string]>;
};

const MAGIC = 0x53555753; // "SWUS", little-endian
const HEADER_BYTES = 20;
const ENTRY_BYTES = HASH_WORDS * 4 + COLOR_BYTES + STRIP_BYTES + RAIL_BYTES;

export function packIndex(
  entries: ScanEntry[],
  descriptors: Descriptor[],
): { bin: Uint8Array; json: IndexJson } {
  const count = entries.length;
  const bin = new Uint8Array(HEADER_BYTES + count * ENTRY_BYTES);
  const view = new DataView(bin.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint16(4, 1, true);
  view.setUint16(6, HASH_BITS, true);
  view.setUint16(8, COLOR_BYTES, true);
  view.setUint16(10, STRIP_BYTES, true);
  view.setUint16(12, RAIL_BYTES, true);
  view.setUint16(14, SAMPLE_WIDTH, true);
  view.setUint32(16, count, true);

  let offset = HEADER_BYTES;
  for (const d of descriptors) {
    for (let w = 0; w < HASH_WORDS; w++) {
      view.setUint32(offset, d.hash[w]!, true);
      offset += 4;
    }
  }
  for (const part of ['color', 'strip', 'rails'] as const) {
    for (const d of descriptors) {
      bin.set(d[part], offset);
      offset += d[part].length;
    }
  }
  return {
    bin,
    json: {
      version: 1,
      hashBits: HASH_BITS,
      sample: [SAMPLE_WIDTH, SAMPLE_HEIGHT],
      entries: entries.map((e) => [e.setKey, e.num, e.base, e.variant]),
    },
  };
}

/**
 * Reads the two index files. Throws if they were built with different fingerprint settings
 * than this app computes — matching across the two would silently be garbage.
 */
export function parseIndex(bin: ArrayBuffer, json: IndexJson): ScanIndex {
  const view = new DataView(bin);
  if (bin.byteLength < HEADER_BYTES || view.getUint32(0, true) !== MAGIC) {
    throw new Error('scan index: not a scan index file');
  }
  if (view.getUint16(4, true) !== 1 || json.version !== 1)
    throw new Error('scan index: unknown version');
  if (
    view.getUint16(6, true) !== HASH_BITS ||
    view.getUint16(8, true) !== COLOR_BYTES ||
    view.getUint16(10, true) !== STRIP_BYTES ||
    view.getUint16(12, true) !== RAIL_BYTES ||
    view.getUint16(14, true) !== SAMPLE_WIDTH ||
    json.hashBits !== HASH_BITS
  ) {
    throw new Error('scan index: built with different fingerprint settings than this app');
  }
  const count = view.getUint32(16, true);
  if (count !== json.entries.length || bin.byteLength !== HEADER_BYTES + count * ENTRY_BYTES) {
    throw new Error('scan index: files disagree on the entry count');
  }

  const hashes = new Uint32Array(count * HASH_WORDS);
  let offset = HEADER_BYTES;
  for (let i = 0; i < hashes.length; i++) {
    hashes[i] = view.getUint32(offset, true);
    offset += 4;
  }
  const take = (bytes: number) => {
    const part = new Uint8Array(bin.slice(offset, offset + count * bytes));
    offset += count * bytes;
    return part;
  };
  const colors = take(COLOR_BYTES);
  const strips = take(STRIP_BYTES);
  const rails = take(RAIL_BYTES);

  return {
    entries: json.entries.map(([setKey, num, base, variant]) => ({ setKey, num, base, variant })),
    hashes,
    colors,
    strips,
    rails,
  };
}

/** Stage 1 — which card: score = hash bits + COLOR_WEIGHT × mean colour difference. */
export const COLOR_WEIGHT = 0.5;
/** Stage 2 — which printing of it: added to the stage-1 score among that card's printings. */
export const STRIP_WEIGHT = 0.5;
export const RAIL_WEIGHT = 1;
/** How many stage-1 candidates stage 2 looks at. */
const SHORTLIST = 8;

export type Match = { entry: ScanEntry; index: number; score: number; bits: number };

const sameCard = (a: ScanEntry, b: ScanEntry) => a.setKey === b.setKey && a.base === b.base;

/**
 * The best `limit` matches, best first (lower score is better), in two stages.
 *
 * Stage 1 ranks everything by the whole-card hash and colour, which reliably finds the
 * card. Stage 2 re-ranks the winning card's printings by the side rails and edge strips,
 * which is where Normal and Hyperspace differ. Stage 2 never lets the side features pull a
 * different card ahead: they only decide between printings of the card stage 1 found.
 */
export function rankMatches(index: ScanIndex, query: Descriptor, limit = 5): Match[] {
  const count = index.entries.length;
  const shortlist: Match[] = [];
  const size = Math.max(limit, SHORTLIST);
  for (let i = 0; i < count; i++) {
    const bits = hammingDistance(query.hash, index.hashes, i * HASH_WORDS);
    const score =
      bits + COLOR_WEIGHT * byteDistance(query.color, index.colors, i * COLOR_BYTES, COLOR_BYTES);
    if (shortlist.length < size || score < shortlist[shortlist.length - 1]!.score) {
      // Binary insertion keeps the shortlist sorted without re-sorting it every time.
      let lo = 0;
      let hi = shortlist.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (shortlist[mid]!.score <= score) lo = mid + 1;
        else hi = mid;
      }
      shortlist.splice(lo, 0, { entry: index.entries[i]!, index: i, score, bits });
      if (shortlist.length > size) shortlist.pop();
    }
  }
  if (!shortlist.length) return [];

  const card = shortlist[0]!.entry;
  const printings = shortlist
    .filter((m) => sameCard(m.entry, card))
    .map((m) => ({
      ...m,
      score:
        m.score +
        STRIP_WEIGHT * byteDistance(query.strip, index.strips, m.index * STRIP_BYTES, STRIP_BYTES) +
        RAIL_WEIGHT * byteDistance(query.rails, index.rails, m.index * RAIL_BYTES, RAIL_BYTES),
    }))
    .sort((a, b) => a.score - b.score);
  const others = shortlist.filter((m) => !sameCard(m.entry, card));
  return [...printings, ...others].slice(0, limit);
}
