import { Checkbox } from '~/ui/Checkbox';

import type { CheckState } from './bulkSelection';
import styles from './SelectBox.module.css';

type Props = {
  state: CheckState | boolean;
  label: string;
  disabled?: boolean;
  onChange: () => void;
};

/** A row or check-all tick box with no visible text; 'some' shows the dash. */
export function SelectBox({ state, label, disabled, onChange }: Props) {
  return (
    <label className={styles.box} title={label}>
      <Checkbox
        checked={state === true || state === 'all'}
        indeterminate={state === 'some'}
        disabled={disabled}
        aria-label={label}
        onChange={onChange}
      />
    </label>
  );
}
