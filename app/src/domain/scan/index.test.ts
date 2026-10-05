import { describe as suite, expect, it } from 'vitest';

import { COLOR_BYTES, HASH_WORDS, RAIL_BYTES, STRIP_BYTES, type Descriptor } from './descriptor';
import { packIndex, parseIndex, rankMatches, type ScanEntry } from './index';

/** A descriptor with chosen hash words, colour, and rail strength. */
function fp(word: number, color: number, rail: number): Descriptor {
  return {
    hash: new Uint32Array(HASH_WORDS).fill(word),
    color: new Uint8Array(COLOR_BYTES).fill(color),
    strip: new Uint8Array(STRIP_BYTES).fill(rail),
    rails: new Uint8Array(RAIL_BYTES).fill(rail),
  };
}

const entries: ScanEntry[] = [
  { setKey: 'SOR', num: '059', base: 59, variant: 'normal' },
  { setKey: 'SOR', num: '324', base: 59, variant: 'hyperspace' },
  { setKey: 'SOR', num: '080', base: 80, variant: 'normal' },
  // A Leader: its front turned into the guide, and its back.
  { setKey: 'SOR', num: '010', base: 10, variant: 'normal', turned: true },
  { setKey: 'SOR', num: '010', base: 10, variant: 'normal', face: 'back' },
];
// Normal and Hyperspace of card 59 share their art (same hash); only the rails differ.
const descriptors = [
  fp(0x0f0f0f0f, 100, 60),
  fp(0x0f0f0f0f, 100, 10),
  fp(0xf0f0f0f0, 40, 60),
  fp(0x00ff00ff, 200, 30),
  fp(0x33333333, 20, 30),
];

function roundTrip() {
  const { bin, json } = packIndex(entries, descriptors);
  return parseIndex(bin.buffer.slice(0) as ArrayBuffer, JSON.parse(JSON.stringify(json)));
}

suite('scan index files', () => {
  it('round-trips every part of every fingerprint', () => {
    const index = roundTrip();
    expect(index.entries).toEqual(entries);
    expect(index.hashes[HASH_WORDS]).toBe(0x0f0f0f0f);
    expect(index.colors[2 * COLOR_BYTES]).toBe(40);
    expect(index.rails[RAIL_BYTES]).toBe(10);
  });

  it('refuses an index built with different fingerprint settings', () => {
    const { bin, json } = packIndex(entries, descriptors);
    new DataView(bin.buffer).setUint16(6, 64, true);
    expect(() => parseIndex(bin.buffer as ArrayBuffer, json)).toThrow(
      /different fingerprint settings/,
    );
  });

  it('refuses files that disagree about how many entries there are', () => {
    const { bin, json } = packIndex(entries, descriptors);
    expect(() =>
      parseIndex(bin.buffer as ArrayBuffer, { ...json, entries: json.entries.slice(1) }),
    ).toThrow(/disagree/);
  });
});

suite('rankMatches', () => {
  const index = roundTrip();

  it('finds the card, then lets the rails pick the printing', () => {
    expect(rankMatches(index, fp(0x0f0f0f0f, 100, 58))[0]!.entry.num).toBe('059');
    expect(rankMatches(index, fp(0x0f0f0f0f, 100, 12))[0]!.entry.num).toBe('324');
  });

  it('reports a printing once, whichever of its pictures matched', () => {
    const top = rankMatches(index, fp(0x00ff00ff, 200, 30), 5);
    expect(top.filter((m) => m.entry.num === '010')).toHaveLength(1);
    expect(rankMatches(index, fp(0x33333333, 20, 30))[0]!.entry).toMatchObject({
      num: '010',
      face: 'back',
    });
  });

  it('never lets side features pull a different card ahead', () => {
    // Rails match card 80 exactly, but the artwork is card 59's.
    const top = rankMatches(index, fp(0x0f0f0f0f, 100, 60), 3);
    expect(top.slice(0, 2).map((m) => m.entry.base)).toEqual([59, 59]);
    expect(top[2]!.entry.base).not.toBe(59);
  });
});
