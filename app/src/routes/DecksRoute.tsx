import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';

import { db } from '~/data/db';
import type { LoadedSet } from '~/domain/catalog';
import { indexOwnership, type OwnedCounts } from '~/domain/ownership';
import type { PreconCatalogEntry } from '~/domain/precons';
import type { SetKey } from '~/domain/types';
import { DecksPage } from '~/features/decks/DecksPage';

type Props = {
  sets: Map<SetKey, LoadedSet>;
  precons: PreconCatalogEntry[];
};

export function DecksRoute({ sets, precons }: Props) {
  // Deck check spans the whole collection, not one set, so this reads every owned row.
  const rows = useLiveQuery(() => db.owned.toArray(), []);

  const binderOwnership = useMemo(() => {
    const bySet = new Map<SetKey, ReadonlyMap<number, OwnedCounts>>();
    if (!rows) return bySet;

    const grouped = new Map<SetKey, typeof rows>();
    for (const row of rows) {
      const list = grouped.get(row.setKey) ?? [];
      list.push(row);
      grouped.set(row.setKey, list);
    }
    for (const [setKey, setRows] of grouped) bySet.set(setKey, indexOwnership(setRows));
    return bySet;
  }, [rows]);

  return <DecksPage sets={sets} binderOwnership={binderOwnership} precons={precons} />;
}
