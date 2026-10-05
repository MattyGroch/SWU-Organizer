import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';

import { db, type StackRow } from '~/data/db';
import { dismissStack } from '~/data/stacks';

import styles from './StackList.module.css';

type StackSummary = StackRow & { cards: number };

/**
 * Scanned stacks still to be put away, on the Intake page: before their batch is added, or
 * after, until the stack is finished or dismissed.
 */
export function StackList() {
  const stacks = useLiveQuery(async (): Promise<StackSummary[]> => {
    const rows = await db.stacks.orderBy('createdAt').toArray();
    return Promise.all(
      rows.map(async (row) => ({
        ...row,
        cards: await db.stackCards.where('stackId').equals(row.id).count(),
      })),
    );
  }, []);
  if (!stacks?.length) return null;

  return (
    <section className={styles.list} aria-labelledby="stacks-title">
      <h2 id="stacks-title" className={styles.title}>
        Put away
      </h2>
      <p className={styles.lead}>
        Sort a scanned stack into the binder without reading card numbers: keep it in the order you
        scanned it, and the app tells you where each card goes.
      </p>
      {stacks.map((stack) => (
        <StackItem key={stack.id} stack={stack} />
      ))}
    </section>
  );
}

function StackItem({ stack }: { stack: StackSummary }) {
  const [confirm, setConfirm] = useState(false);
  const started = stack.sorters !== undefined;
  const status = started
    ? 'In progress'
    : stack.closedAt === undefined
      ? 'Still scanning'
      : 'Added to your collection';

  return (
    <div className={styles.item}>
      <div className={styles.summary}>
        <span className={styles.name}>
          {stack.label} · {stack.cards} {stack.cards === 1 ? 'card' : 'cards'}
        </span>
        <span className={styles.status}>{status}</span>
      </div>
      <div className={styles.actions}>
        <Link to="/put-away/$stackId" params={{ stackId: stack.id }} className={styles.primary}>
          {started ? 'Continue' : 'Put away'}
        </Link>
        {confirm ? (
          <>
            <button
              type="button"
              className={styles.danger}
              onClick={() => void dismissStack(stack.id)}
            >
              Dismiss
            </button>
            <button type="button" className={styles.action} onClick={() => setConfirm(false)}>
              Keep
            </button>
          </>
        ) : (
          <button type="button" className={styles.action} onClick={() => setConfirm(true)}>
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
