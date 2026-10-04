import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';

import { db, type IntakeBatch, type IntakeLine } from '~/data/db';

export type BatchWithLines = IntakeBatch & { lines: IntakeLine[]; copies: number };

/** The queue, live: batches oldest first, each with its lines in order. */
export function useIntake(): { batches: BatchWithLines[]; loading: boolean } {
  const batches = useLiveQuery(() => db.intakeBatches.orderBy('createdAt').toArray(), []);
  const lines = useLiveQuery(() => db.intakeLines.toArray(), []);

  return useMemo(() => {
    if (!batches || !lines) return { batches: [], loading: true };
    const byBatch = new Map<string, IntakeLine[]>();
    for (const line of lines) {
      const list = byBatch.get(line.batchId) ?? [];
      list.push(line);
      byBatch.set(line.batchId, list);
    }
    return {
      loading: false,
      batches: batches.map((batch) => {
        const own = (byBatch.get(batch.id) ?? []).sort((a, b) => a.order - b.order);
        return { ...batch, lines: own, copies: own.reduce((sum, l) => sum + l.count, 0) };
      }),
    };
  }, [batches, lines]);
}

/** Copies waiting in the queue — the badge on the nav link. */
export function useIntakeCount(): number {
  return (
    useLiveQuery(async () => {
      let total = 0;
      await db.intakeLines.each((line) => {
        total += line.count;
      });
      return total;
    }, []) ?? 0
  );
}
