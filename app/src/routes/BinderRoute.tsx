import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';

import { setQuery } from '~/data/catalog';
import type { LoadedSet, SetManifestEntry } from '~/domain/catalog';
import type { SetKey } from '~/domain/types';
import { BinderPage } from '~/features/binder/BinderPage';

type Props = {
  set: LoadedSet;
  entries: SetManifestEntry[];
  /** Card to select on arrival, from `?card=`. Lets a binder position be linked to. */
  selectCard?: number;
};

export function BinderRoute({ set, entries, selectCard }: Props) {
  /**
   * Subscribes to every set query rather than reading the cache once.
   *
   * The previous version called `queryClient.getQueryData()` during render, which is a
   * snapshot with no subscription: search covered only the active set until some
   * unrelated re-render happened to pick the others up, so its scope appeared to flicker
   * between one set and all of them. `useQueries` makes the set of loaded catalogs grow
   * deterministically as the background prefetch lands.
   *
   * This does not change when sets are fetched — the route already prefetches them — only
   * that the component now re-renders when they arrive.
   */
  const results = useQueries({ queries: entries.map((entry) => setQuery(entry)) });

  const loadedSets = useMemo(() => {
    const sets = new Map<SetKey, LoadedSet>();
    for (const result of results) {
      if (result.data) sets.set(result.data.setKey, result.data);
    }
    // The active set is loaded by the route loader, so it is always available even if its
    // query result has not settled in this render pass.
    sets.set(set.setKey, set);
    return sets;
    // Re-derive only when the set of resolved catalogs actually changes, not on every
    // render — `results` is a fresh array each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results.map((r) => (r.data ? r.data.setKey : '')).join('|'), set]);

  return <BinderPage set={set} entries={entries} loadedSets={loadedSets} selectCard={selectCard} />;
}
