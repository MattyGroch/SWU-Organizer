import type { CheckState } from './bulkSelection';
import styles from './SelectBox.module.css';

type Props = {
  state: CheckState | boolean;
  label: string;
  disabled?: boolean;
  onChange: () => void;
};

/** A row or check-all tick box with a finger-sized hit area; 'some' shows the dash. */
export function SelectBox({ state, label, disabled, onChange }: Props) {
  const checked = state === true || state === 'all';
  const indeterminate = state === 'some';
  return (
    <label className={styles.box} title={label}>
      <input
        type="checkbox"
        ref={(el) => {
          if (el) el.indeterminate = indeterminate;
        }}
        checked={checked}
        disabled={disabled}
        aria-label={label}
        aria-checked={indeterminate ? 'mixed' : checked}
        onChange={onChange}
      />
    </label>
  );
}
