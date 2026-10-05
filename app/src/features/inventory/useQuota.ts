import { useCallback } from 'react';

import { useLeaderBaseCopies } from '~/data/binderSettings';
import type { CatalogCard } from '~/domain/catalog';
import { quotaForCard } from '~/domain/ownership';

/** A card's binder playset, with the Leader & Base setting applied. */
export type QuotaOfCard = (card: Pick<CatalogCard, 'type' | 'maxCopies'>) => number;

export function useQuota(): QuotaOfCard {
  const leaderBaseCopies = useLeaderBaseCopies();
  return useCallback(
    (card: Pick<CatalogCard, 'type' | 'maxCopies'>) => quotaForCard(card, leaderBaseCopies),
    [leaderBaseCopies],
  );
}
