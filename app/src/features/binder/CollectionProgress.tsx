import type { CollectionTotals } from './cardRows';
import styles from './CollectionProgress.module.css';

type Props = {
  totals: CollectionTotals;
};

/**
 * Complete / partial / missing as one stacked bar, over whatever the filters currently
 * show — filter to Rares and it is the Rare playset progress.
 *
 * Restored from the legacy app, where it was the at-a-glance read on a set. Segment
 * widths are shares of the filtered card count, so the bar always fills exactly.
 */
export function CollectionProgress({ totals }: Props) {
  const { cards, complete, partial, missing } = totals;
  const share = (n: number) => (cards ? (n / cards) * 100 : 0);
  const percentComplete = Math.round(share(complete));

  const summary = `${complete} complete, ${partial} in progress, ${missing} not collected, of ${cards} cards`;

  return (
    <div className={styles.progress}>
      <div className={styles.heading}>
        <span>
          Collection status <span className={styles.cards}>· {cards} cards</span>
        </span>
        <span className={styles.percent}>{percentComplete}% complete</span>
      </div>

      <div className={styles.bar} role="img" aria-label={summary} title={summary}>
        <span
          className={styles.segment}
          data-status="complete"
          style={{ width: `${share(complete)}%` }}
        />
        <span
          className={styles.segment}
          data-status="partial"
          style={{ width: `${share(partial)}%` }}
        />
        <span
          className={styles.segment}
          data-status="none"
          style={{ width: `${share(missing)}%` }}
        />
      </div>

      <div className={styles.legend} aria-hidden="true">
        <span data-status="complete">✓ {complete}</span>
        <span data-status="partial">! {partial}</span>
        <span data-status="none">✕ {missing}</span>
      </div>
    </div>
  );
}
