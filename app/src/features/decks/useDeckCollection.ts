import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';

import { db } from '~/data/db';
import type { LoadedSet } from '~/domain/catalog';
import { available, type HomeLookup, type OwnedLookup } from '~/domain/deckBuild';
import type { DeckLookupSet } from '~/domain/decklist';
import type { DeckLibrary } from '~/domain/decks';
import {
  homesOf,
  indexOwnership,
  NO_HOMES,
  quotaForCard,
  type OwnedCounts,
} from '~/domain/ownership';
import type { SetKey } from '~/domain/types';

export type OwnershipBySet = Map<SetKey, ReadonlyMap<number, OwnedCounts>>;

/** Every owned row, indexed per set. Decks span the whole collection, not one set. */
export function useOwnershipBySet(): OwnershipBySet {
  const rows = useLiveQuery(() => db.owned.toArray(), []);
  return useMemo(() => {
    const bySet: OwnershipBySet = new Map();
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
}

/** The lookups every deck view needs, over the catalog, the collection and the decks. */
export function useDeckCollection(
  sets: Map<SetKey, LoadedSet>,
  binderOwnership: OwnershipBySet,
  library: DeckLibrary,
) {
  const lookup = useMemo<Map<SetKey, DeckLookupSet>>(() => {
    const map = new Map<SetKey, DeckLookupSet>();
    for (const [setKey, set] of sets) {
      map.set(setKey, { byNumber: set.byNumber, baseCards: set.baseCards });
    }
    return map;
  }, [sets]);
  const setOrder = useMemo(() => [...sets.keys()], [sets]);

  /**
   * Copies you can build with: the whole collection, bulk box and cards already in built
   * decks included. Precons are left out on purpose — they stay sealed, so their cards are
   * owned but never available to a deck.
   */
  const owned = useMemo<OwnedLookup>(
    () => (setKey, base) => binderOwnership.get(setKey)?.get(base)?.total ?? 0,
    [binderOwnership],
  );
  /** The same, per home and printing — where a deck takes copies from, and returns them. */
  const homes = useMemo<HomeLookup>(
    () => (setKey, base) => {
      const counts = binderOwnership.get(setKey)?.get(base);
      return counts ? homesOf(counts) : NO_HOMES;
    },
    [binderOwnership],
  );
  /** What a deck could still take: in the binder or the bulk box, not in a deck. */
  const pullable = useMemo<OwnedLookup>(() => {
    const free = available(homes, library);
    return (setKey, base) => {
      const { binder, bulk } = free(setKey, base);
      return binder + bulk;
    };
  }, [homes, library]);
  const quotaOf = useMemo(
    () => (setKey: SetKey, base: number) => {
      const card = sets.get(setKey)?.cardsByBase.get(base);
      return card ? quotaForCard(card) : Infinity;
    },
    [sets],
  );

  return { lookup, setOrder, owned, homes, pullable, quotaOf };
}
