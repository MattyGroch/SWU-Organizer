import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { manifestQuery, setQuery } from '~/data/catalog';
import type { LoadedSet } from '~/domain/catalog';
import type { SetKey } from '~/domain/types';

import { ImportDialog } from './ImportDialog';

/**
 * Import / export from anywhere in the app (the sync menu), not tied to one page. A file can
 * hold any set, so the dialog opens once every set's catalog has loaded; the routes prefetch
 * them, so that is usually at once.
 */
export function CollectionImportDialog({ onClose }: { onClose: () => void }) {
  const entries = useQuery(manifestQuery()).data;
  const results = useQueries({ queries: (entries ?? []).map((entry) => setQuery(entry)) });
  const ready = entries !== undefined && results.every((result) => result.data);

  const catalog = useMemo(() => {
    const sets = new Map<SetKey, LoadedSet>();
    for (const result of results) if (result.data) sets.set(result.data.setKey, result.data);
    return sets;
    // `results` is a fresh array each render; rebuild only once everything has landed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  return ready ? <ImportDialog catalog={catalog} onClose={onClose} /> : null;
}
