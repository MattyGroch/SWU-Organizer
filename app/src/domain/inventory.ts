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
/**
 * Copies of a card the binder holds: three, or `leaderBaseCopies` for a Leader or Base —
 * one is all a deck needs, but a second keeps the pocket from going empty while the first
 * is out in a deck. That number is a setting (see `binderSettings`).
 */
export function quotaForType(type?: string, leaderBaseCopies = 1): number {
  const normalized = (type ?? '').trim().toLowerCase();
  return normalized === 'leader' || normalized === 'base' ? leaderBaseCopies : 3;
}

/** Playset quota for a card: an explicit per-card override (e.g. Swarming Vulture Droid's 15) if present, else the type-based default. */
export function resolveQuota(type?: string, maxCopies?: number, leaderBaseCopies = 1): number {
  return maxCopies ?? quotaForType(type, leaderBaseCopies);
}
