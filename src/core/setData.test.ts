import { describe, expect, it, vi } from 'vitest';
import { fetchSetPayload, parseSetPayload } from './setData';

function response(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response;
}

describe('set data loading', () => {
  it('rejects a non-success response even when it contains JSON', async () => {
    const fetcher = vi.fn(async () => response([{ Name: 'Wrong' }], false));

    await expect(fetchSetPayload(fetcher, '/sets/missing.json')).rejects.toThrow(
      'Failed to fetch set data',
    );
  });

  it('rejects malformed primary payload objects', () => {
    expect(() => parseSetPayload({ cards: [] })).toThrow('Invalid set data');
  });

  it('accepts array payloads and data-array wrappers', () => {
    const cards = [{ Name: 'Alpha', Number: 1 }];

    expect(parseSetPayload(cards)).toBe(cards);
    expect(parseSetPayload({ data: cards })).toBe(cards);
  });
});
