import { useEffect, useState } from 'react';

/** Phone width: where the binder grid gives way to the list, and controls compact. */
export const NARROW_QUERY = '(max-width: 760px)';

/**
 * Whether the screen is phone-width, kept current as it changes (rotation, resizing).
 * For layouts that differ in structure, not just style — a CSS media query can hide an
 * element but not move it, and rendering both copies would duplicate every control.
 */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(NARROW_QUERY)?.matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.(NARROW_QUERY);
    if (!query) return;
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return narrow;
}
