import type { SetKey } from './types';

export type CanonicalCardRef = {
  setKey: SetKey;
  printingNumber: number;
  baseNumber: number;
  type?: string;
  /** Overrides the default type-based playset quota, e.g. Swarming Vulture Droid (15). */
  maxCopies?: number;
};

export type CanonicalCatalog = Map<string, CanonicalCardRef>;
export function quotaForType(type?: string): number {
  const normalized = (type ?? '').trim().toLowerCase();
  return normalized === 'leader' || normalized === 'base' ? 1 : 3;
}

/** Playset quota for a card: an explicit per-card override (e.g. Swarming Vulture Droid's 15) if present, else the type-based default. */
export function resolveQuota(type?: string, maxCopies?: number): number {
  return maxCopies ?? quotaForType(type);
}
