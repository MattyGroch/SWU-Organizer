import type { BinderLayout } from '~/features/inventory/lastPlace';

import styles from './BinderLayoutToggle.module.css';

type Props = {
  layout: BinderLayout;
  onChange: (layout: BinderLayout) => void;
};

/** Desktop only: the two-page spread, or one page at a time as on a phone. */
export function BinderLayoutToggle({ layout, onChange }: Props) {
  return (
    <div className={styles.toggle} role="radiogroup" aria-label="Binder layout">
      <button
        type="button"
        role="radio"
        className={styles.item}
        aria-checked={layout === 'spread'}
        title="Two-page spread"
        onClick={() => onChange('spread')}
      >
        <SpreadIcon />
        Spread
      </button>
      <button
        type="button"
        role="radio"
        className={styles.item}
        aria-checked={layout === 'page'}
        title="One page at a time"
        onClick={() => onChange('page')}
      >
        <PageIcon />
        Page
      </button>
    </div>
  );
}

function SpreadIcon() {
  return (
    <svg viewBox="0 0 20 16" width="18" height="14" aria-hidden="true" focusable="false">
      <rect
        x="1"
        y="1"
        width="8"
        height="14"
        rx="1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect
        x="11"
        y="1"
        width="8"
        height="14"
        rx="1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function PageIcon() {
  return (
    <svg viewBox="0 0 20 16" width="18" height="14" aria-hidden="true" focusable="false">
      <rect
        x="6"
        y="1"
        width="8"
        height="14"
        rx="1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}
