import { useCallback } from 'react';

import { queuedPocket, queueScan, type ScanReceipt } from '~/data/intake';
import type { ScanEntry } from '~/data/stacks';
import type { LoadedSet, VariantSlug } from '~/domain/catalog';
import { pocketRoom, type PocketRoom } from '~/domain/ownership';
import type { SetKey } from '~/domain/types';
import { useQuota } from '~/features/inventory/useQuota';

export type Printing = { setKey: SetKey; base: number; num: string; variant: VariantSlug };

/**
 * Set when the card's binder pocket was already full: `full` (no better than what is
 * there — it goes to the bulk box) or `upgrade` (better than the weakest copy, which goes
 * to the bulk box instead). Either way the copy is queued; committing the batch moves the
 * extra copy to bulk.
 */
export type Placed = { receipt: ScanReceipt | null; room: PocketRoom | null };

/**
 * Queues a scanned printing and notes what it does to its binder pocket: room, full of
 * copies at least as good (it goes to bulk), or better than the weakest copy (that one
 * goes to bulk). Every copy is queued; committing settles which copies go to bulk.
 */
export function usePlaceScan(
  sets: Map<SetKey, LoadedSet>,
): (printing: Printing) => Promise<Placed> {
  const quotaOf = useQuota();
  return useCallback(
    async (printing: Printing): Promise<Placed> => {
      const set = sets.get(printing.setKey);
      const card = set?.byNumber.get(printing.base);
      if (!card) return { receipt: await queueScan(printing), room: null };
      const quota = quotaOf({ type: card.Type, maxCopies: card.MaxCopies });
      const room = pocketRoom(
        await queuedPocket(printing.setKey, printing.base),
        quota,
        printing.variant,
      );
      return { receipt: await queueScan(printing), room: room.kind === 'room' ? null : room };
    },
    [sets, quotaOf],
  );
}

/** Where a scan's card goes when the stack is put away. */
export function stackEntry(
  item: { chosen: Printing; question: unknown; room: PocketRoom | null },
  set?: LoadedSet,
): ScanEntry {
  const { setKey, base, num, variant } = item.chosen;
  const card = { setKey, base, num, variant };
  if (item.question) return { ...card, fate: 'unsure' };
  if (item.room?.kind === 'full') return { ...card, fate: 'bulk' };
  if (item.room?.kind === 'upgrade') {
    const replaces = item.room.replaces;
    const weaker = set?.printingsByBase.get(base)?.find((p) => p.variant === replaces);
    if (weaker) {
      return { ...card, fate: 'binder', swapOut: { num: weaker.num, variant: weaker.variant } };
    }
  }
  return { ...card, fate: 'binder' };
}
