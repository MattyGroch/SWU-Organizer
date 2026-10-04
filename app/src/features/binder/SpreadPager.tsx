import { useMemo } from 'react';

import { spreadLabel } from '~/ui/format';

import styles from './SpreadPager.module.css';

type Props = {
  viewSpread: number;
  totalSpreads: number;
  onGoTo: (spread: number) => void;
  onStep: (delta: number) => void;
};

export function SpreadPager({ viewSpread, totalSpreads, onGoTo, onStep }: Props) {
  const options = useMemo(
    () => Array.from({ length: totalSpreads }, (_, i) => ({ value: i, label: spreadLabel(i) })),
    [totalSpreads],
  );

  return (
    <div className={styles.pager}>
      <button
        type="button"
        className={styles.step}
        onClick={() => onStep(-1)}
        disabled={viewSpread <= 0}
        aria-label="Previous spread"
        title="Previous spread — keyboard ,"
      >
        ‹<kbd>,</kbd>
      </button>

      <label className={styles.jump}>
        <span className="visually-hidden">Jump to spread</span>
        <select value={viewSpread} onChange={(event) => onGoTo(Number(event.target.value))}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        className={styles.step}
        onClick={() => onStep(1)}
        disabled={viewSpread >= totalSpreads - 1}
        aria-label="Next spread"
        title="Next spread — keyboard ."
      >
        <kbd>.</kbd>›
      </button>
    </div>
  );
}
