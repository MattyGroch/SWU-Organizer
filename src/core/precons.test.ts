import { describe, expect, it, vi } from 'vitest';
import {
  fetchPreconCatalog,
  fetchPreconEntry,
  fetchPreconManifest,
  parsePreconContents,
  parsePreconManifest,
  type PreconManifestEntry,
} from './precons';

function response(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response;
}

const manifestEntry: PreconManifestEntry = {
  key: 'SOR-heroism',
  label: 'Spark of Rebellion — Heroism',
  setKey: 'SOR',
  aspect: 'Heroism',
  file: 'SOR-heroism.json',
};

const validContents = {
  leader: { setKey: 'SOR', baseNumber: 1, count: 1 },
  base: { setKey: 'SOR', baseNumber: 2, count: 1 },
  mainDeck: [{ setKey: 'SOR', baseNumber: 3, count: 3 }],
  sideboard: [],
};

describe('parsePreconManifest', () => {
  it('rejects a payload without a precons array', () => {
    expect(() => parsePreconManifest({})).toThrow('Invalid precon manifest');
  });

  it('filters out malformed entries and keeps valid ones', () => {
    const result = parsePreconManifest({
      precons: [manifestEntry, { key: 'bad' }, { ...manifestEntry, aspect: '' }, { ...manifestEntry, aspect: 42 }],
    });
    expect(result).toEqual([manifestEntry]);
  });

  it('accepts a free-text aspect beyond Heroism/Villainy (e.g. Twin Suns dual-leader decks)', () => {
    const result = parsePreconManifest({
      precons: [{ ...manifestEntry, key: 'TS26-blood-brothers', aspect: 'Twin Suns' }],
    });
    expect(result).toEqual([{ ...manifestEntry, key: 'TS26-blood-brothers', aspect: 'Twin Suns' }]);
  });
});

describe('parsePreconContents', () => {
  it('rejects a payload missing leader/base', () => {
    expect(() => parsePreconContents({ mainDeck: [], sideboard: [] })).toThrow(
      'Invalid precon deck',
    );
  });

  it('accepts a valid single-leader deck', () => {
    expect(parsePreconContents(validContents)).toEqual({
      ...validContents,
      secondLeader: undefined,
    });
  });

  it('accepts a valid second leader for Twin Suns decks', () => {
    const withSecond = { ...validContents, secondLeader: { setKey: 'TS26', baseNumber: 9, count: 1 } };
    expect(parsePreconContents(withSecond)).toEqual(withSecond);
  });

  it('rejects a malformed second leader', () => {
    expect(() => parsePreconContents({ ...validContents, secondLeader: {} })).toThrow(
      'Invalid precon deck',
    );
  });
});

describe('fetchPreconManifest / fetchPreconEntry / fetchPreconCatalog', () => {
  it('throws when the manifest fetch fails', async () => {
    const fetcher = vi.fn(async () => response({}, false));
    await expect(fetchPreconManifest(fetcher, '/precons/manifest.json')).rejects.toThrow(
      'Failed to fetch precon manifest',
    );
  });

  it('fetches a single precon entry and merges manifest metadata with contents', async () => {
    const fetcher = vi.fn(async () => response(validContents));
    const entry = await fetchPreconEntry(fetcher, manifestEntry);
    expect(entry).toEqual({ ...manifestEntry, contents: { ...validContents, secondLeader: undefined } });
    expect(fetcher).toHaveBeenCalledWith('/precons/SOR-heroism.json');
  });

  it('skips entries that fail to fetch when building the full catalog', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      if (url === '/precons/manifest.json') {
        return response({ precons: [manifestEntry, { ...manifestEntry, key: 'broken', file: 'missing.json' }] });
      }
      if (url === '/precons/missing.json') return response({}, false);
      return response(validContents);
    });
    const catalog = await fetchPreconCatalog(fetcher);
    expect(catalog).toHaveLength(1);
    expect(catalog[0]!.key).toBe('SOR-heroism');
  });
});
