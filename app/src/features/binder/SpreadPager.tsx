import { useMemo } from 'react';

import { spreadLabel } from '~/ui/format';

import styles from './SpreadPager.module.css';

type Props = {
  /** Spreads on a desktop; single pages on a phone. */
  unit: 'spread' | 'page';
  /** The spread index (from 0), or the page number (from 1). */
  value: number;
  /** How many spreads or pages the set has. */
  total: number;
  onGoTo: (value: number) => void;
  onStep: (delta: number) => void;
};

export function SpreadPager({ unit, value, total, onGoTo, onStep }: Props) {
  const first = unit === 'page' ? 1 : 0;
  const options = useMemo(
    () =>
      Array.from({ length: total }, (_, i) => ({
        value: i + first,
        label: unit === 'page' ? `Page ${i + 1}` : spreadLabel(i),
      })),
    [total, unit, first],
  );

  return (
    <div className={styles.pager}>
      <button
        type="button"
        className={styles.step}
        onClick={() => onStep(-1)}
        disabled={value <= first}
        aria-label={`Previous ${unit}`}
        title={`Previous ${unit} — keyboard ,`}
      >
        ‹<kbd>,</kbd>
      </button>

      <label className={styles.jump}>
        <span className="visually-hidden">Jump to {unit}</span>
        <select value={value} onChange={(event) => onGoTo(Number(event.target.value))}>
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
        disabled={value >= total - 1 + first}
        aria-label={`Next ${unit}`}
        title={`Next ${unit} — keyboard .`}
      >
        <kbd>.</kbd>›
      </button>
    </div>
  );
}
