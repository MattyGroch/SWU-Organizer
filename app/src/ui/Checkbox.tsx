import type { ChangeEvent } from 'react';
import styles from './Checkbox.module.css';

type Props = {
  checked: boolean;
  /** The "some ticked" dash, e.g. a check-all over a part-selected list. */
  indeterminate?: boolean;
  disabled?: boolean;
  /** Only when nothing visible names it; inside a <label> the label's text does. */
  'aria-label'?: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
};

/**
 * The app's tick box: a real <input type="checkbox"> (keyboard, screen readers and the
 * surrounding <label> all keep working) laid invisibly over a HUD-drawn box, inside a
 * finger-sized hit area that doesn't grow the row. Put it inside a <label> with its text.
 */
export function Checkbox({ checked, indeterminate = false, disabled, onChange, ...rest }: Props) {
  return (
    <span className={styles.hit}>
      <input
        type="checkbox"
        className={styles.input}
        ref={(el) => {
          if (el) el.indeterminate = indeterminate;
        }}
        checked={checked}
        disabled={disabled}
        aria-label={rest['aria-label']}
        onChange={onChange}
      />
      <span className={styles.box} aria-hidden="true" />
    </span>
  );
}
