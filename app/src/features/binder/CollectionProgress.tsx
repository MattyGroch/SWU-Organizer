import { SaberBar } from '~/ui/SaberBar';

import type { CollectionTotals } from './cardRows';
import styles from './CollectionProgress.module.css';

type Props = {
  totals: CollectionTotals;
  /** One line — percent, counts and a thin bar — for phones, where height is scarce. */
  compact?: boolean;
  /** The heading's words; "Collection status" unless given. */
  title?: string;
};

/**
 * Complete / partial / missing as one stacked saber blade, over whatever the filters currently
 * show — filter to Rares and it is the Rare playset progress.
 *
 * Restored from the legacy app, where it was the at-a-glance read on a set. Segment
 * widths are shares of the filtered card count, so the bar always fills exactly.
 */
export function CollectionProgress({
  totals,
  compact = false,
  title = 'Collection status',
}: Props) {
  const { cards, complete, partial, missing } = totals;
  const share = (n: number) => (cards ? (n / cards) * 100 : 0);
  const percentComplete = Math.round(share(complete));

  const summary = `${complete} complete, ${partial} in progress, ${missing} not collected, of ${cards} cards`;

  const bar = (
    <SaberBar
      role="img"
      aria-label={summary}
      title={summary}
      compact={compact}
      segments={[
        { percent: share(complete), color: 'var(--color-success)' },
        { percent: share(partial), color: 'var(--color-warning)' },
        { percent: share(missing), color: 'var(--color-danger)' },
      ]}
    />
  );

  if (compact) {
    return (
      <div className={styles.progress} data-compact>
        <div className={styles.heading}>
          <span className={styles.percent}>
            {percentComplete}% <span className={styles.cards}>of {cards}</span>
          </span>
          <span className={styles.legend} aria-hidden="true">
            <span data-status="complete">✓ {complete}</span>
            <span data-status="partial">! {partial}</span>
            <span data-status="none">✕ {missing}</span>
          </span>
        </div>
        {bar}
      </div>
    );
  }

  return (
    <div className={styles.progress}>
      <div className={styles.heading}>
        <span>
          {title} <span className={styles.cards}>· {cards} cards</span>
        </span>
        <span className={styles.percent}>{percentComplete}% complete</span>
      </div>

      {bar}

      <div className={styles.legend} aria-hidden="true">
        <span data-status="complete">✓ {complete}</span>
        <span data-status="partial">! {partial}</span>
        <span data-status="none">✕ {missing}</span>
      </div>
    </div>
  );
}
