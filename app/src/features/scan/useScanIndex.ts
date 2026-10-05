import { useQuery } from '@tanstack/react-query';

import { parseIndex, type IndexJson, type ScanIndex } from '~/domain/scan/index';

/** The reference fingerprints, fetched once per session (about 1.5 MB, compressible). */
export function useScanIndex() {
  return useQuery<ScanIndex>({
    queryKey: ['scan-index'],
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async ({ signal }) => {
      const [bin, json] = await Promise.all([
        fetch('/scan-data/index.bin', { signal }).then((r) => {
          if (!r.ok) throw new Error(`scan index: HTTP ${r.status}`);
          return r.arrayBuffer();
        }),
        fetch('/scan-data/index.json', { signal }).then((r) => {
          if (!r.ok) throw new Error(`scan index: HTTP ${r.status}`);
          return r.json() as Promise<IndexJson>;
        }),
      ]);
      return parseIndex(bin, json);
    },
  });
}
