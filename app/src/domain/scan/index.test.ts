import { describe as suite, expect, it } from 'vitest';

import { COLOR_BYTES, HASH_WORDS, RAIL_BYTES, STRIP_BYTES, type Descriptor } from './descriptor';
import { TWIN_SCORE, packIndex, parseIndex, rankMatches, twinsOf, type ScanEntry } from './index';

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

  it('still reads a soft Normal card as Normal: blur weakens its rails, never removes them', () => {
    // Rails at half strength sit nearer Hyperspace's 10 than Normal's 60 in plain distance.
    expect(rankMatches(index, fp(0x0f0f0f0f, 100, 30))[0]!.entry.num).toBe('059');
    // Fainter than blur explains is no rail at all.
    expect(rankMatches(index, fp(0x0f0f0f0f, 100, 16))[0]!.entry.num).toBe('324');
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

suite('twinsOf', () => {
  /** One hash word with `bits` of its 32 bits flipped: that many bits from the original. */
  const flip = (word: number, bits: number) => (word ^ ((1 << bits) - 1)) >>> 0;
  const twinEntries: ScanEntry[] = [
    { setKey: 'LOF', num: '224', base: 224, variant: 'normal' },
    // The same art in HMW: only the set icon and number differ — a few bits.
    { setKey: 'HMW', num: '239', base: 239, variant: 'normal' },
    { setKey: 'HMW', num: '511', base: 239, variant: 'hyperspace' },
    // In SOR too, a little further off but still the same art.
    { setKey: 'SOR', num: '100', base: 100, variant: 'normal' },
    // A different card in JTL.
    { setKey: 'JTL', num: '050', base: 50, variant: 'normal' },
    // LOF's own other printing is no twin: same set.
    { setKey: 'LOF', num: '488', base: 224, variant: 'hyperspace' },
    // The back of a leader is never compared with a front.
    { setKey: 'ASH', num: '001', base: 1, variant: 'normal', face: 'back' },
  ];
  const art = 0x0f0f0f0f;
  const index = (() => {
    const { bin, json } = packIndex(twinEntries, [
      fp(art, 100, 60),
      {
        ...fp(art, 100, 60),
        hash: new Uint32Array(HASH_WORDS).fill(art).fill(flip(art, 12), 0, 1),
      },
      { ...fp(art, 100, 10), hash: new Uint32Array(HASH_WORDS).fill(art).fill(flip(art, 9), 0, 1) },
      {
        ...fp(art, 100, 60),
        hash: new Uint32Array(HASH_WORDS).fill(art).fill(flip(art, 20), 0, 1),
      },
      fp(0xf0f0f0f0, 40, 60),
      fp(art, 100, 10),
      fp(art, 100, 60),
    ]);
    return parseIndex(bin.buffer.slice(0) as ArrayBuffer, JSON.parse(JSON.stringify(json)));
  })();

  it('finds the same art in other sets, one picture per set, closest first', () => {
    const twins = twinsOf(index, { entry: twinEntries[0]!, index: 0 });
    expect(twins.map((e) => `${e.setKey}:${e.num}`)).toEqual(['HMW:511', 'SOR:100']);
  });

  it('leaves out anything further than TWIN_SCORE', () => {
    const far = { ...fp(art, 100, 60) };
    far.hash = new Uint32Array(HASH_WORDS).fill(art);
    far.hash[0] = flip(art, 31);
    expect(31).toBeGreaterThan(TWIN_SCORE);
    const { bin, json } = packIndex(twinEntries.slice(0, 2), [fp(art, 100, 60), far]);
    const small = parseIndex(bin.buffer.slice(0) as ArrayBuffer, JSON.parse(JSON.stringify(json)));
    expect(twinsOf(small, { entry: twinEntries[0]!, index: 0 })).toEqual([]);
  });
});
