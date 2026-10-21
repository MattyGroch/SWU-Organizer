import { useId } from 'react';

/** Each badge needs its own gradient ids: two badges sharing one break if one unmounts. */
export function useBadgeIds() {
  const id = useId().replace(/:/g, '');
  return { fill: `${id}-fill`, clip: `${id}-clip` };
}
