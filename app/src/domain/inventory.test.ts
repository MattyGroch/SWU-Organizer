import { describe, expect, it } from 'vitest';

import { quotaForType, resolveQuota } from './inventory';

describe('resolveQuota', () => {
  it('falls back to the type-based quota when no override is given', () => {
    expect(resolveQuota('Unit', undefined)).toBe(quotaForType('Unit'));
    expect(resolveQuota('Leader', undefined)).toBe(1);
  });

  it('uses the maxCopies override regardless of type when given', () => {
    expect(resolveQuota('Unit', 15)).toBe(15);
    expect(resolveQuota('Leader', 15)).toBe(15);
  });
});
