import { useEffect, useState } from 'react';

import { getCardImage, objectUrlFor } from '~/data/images';

export type CardImageState = 'loading' | 'ready' | 'unavailable';

/**
 * Resolves a card image to a displayable URL, fetching and caching on first use.
 *
 * Returns `unavailable` rather than throwing when the image cannot be had, so the cell
 * falls back to its text layout instead of leaving a hole in the binder.
 */
export function useCardImage(url: string | undefined): {
  src: string | undefined;
  state: CardImageState;
} {
  const [src, setSrc] = useState<string>();
  const [state, setState] = useState<CardImageState>(url ? 'loading' : 'unavailable');

  useEffect(() => {
    if (!url) {
      setSrc(undefined);
      setState('unavailable');
      return;
    }

    let cancelled = false;
    setState('loading');

    void getCardImage(url).then((blob) => {
      if (cancelled) return;
      if (!blob) {
        setSrc(undefined);
        setState('unavailable');
        return;
      }
      setSrc(objectUrlFor(url, blob));
      setState('ready');
    });

    return () => {
      cancelled = true;
    };
  }, [url]);

  return { src, state };
}
