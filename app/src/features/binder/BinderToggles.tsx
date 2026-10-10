import type { ReactNode } from 'react';

import type { BinderLayout, BinderZoom } from '~/features/inventory/lastPlace';

import styles from './BinderToggles.module.css';

type Option<T> = { value: T; label: string; title: string; icon: ReactNode };

type SegmentedProps<T> = {
  label: string;
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
};

function Segmented<T extends string>({ label, options, value, onChange }: SegmentedProps<T>) {
  return (
    <div className={styles.toggle} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          className={styles.item}
          aria-checked={value === option.value}
          title={option.title}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

const LAYOUTS: readonly Option<BinderLayout>[] = [
  { value: 'spread', label: 'Spread', title: 'Two-page spread', icon: <SpreadIcon /> },
  { value: 'page', label: 'Page', title: 'One page at a time', icon: <PageIcon /> },
];

const ZOOMS: readonly Option<BinderZoom>[] = [
  {
    value: 'standard',
    label: 'Standard',
    title: 'Cards the size they are in the spread',
    icon: <StandardIcon />,
  },
  { value: 'full', label: 'Full Size', title: 'The page fills the window', icon: <FullIcon /> },
];

/** Desktop only: the two-page spread, or one page at a time as on a phone. */
export function BinderLayoutToggle(props: {
  layout: BinderLayout;
  onChange: (layout: BinderLayout) => void;
}) {
  return (
    <Segmented
      label="Binder layout"
      options={LAYOUTS}
      value={props.layout}
      onChange={props.onChange}
    />
  );
}

/** Desktop, one page: cards at spread size, or the page as wide as the window. */
export function BinderZoomToggle(props: {
  zoom: BinderZoom;
  onChange: (zoom: BinderZoom) => void;
}) {
  return (
    <Segmented label="Page size" options={ZOOMS} value={props.zoom} onChange={props.onChange} />
  );
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 20 16"
      width="18"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

function SpreadIcon() {
  return (
    <Icon>
      <rect x="1" y="1" width="8" height="14" rx="1" />
      <rect x="11" y="1" width="8" height="14" rx="1" />
    </Icon>
  );
}

function PageIcon() {
  return (
    <Icon>
      <rect x="6" y="1" width="8" height="14" rx="1" />
    </Icon>
  );
}

/** A small card in a wide frame. */
function StandardIcon() {
  return (
    <Icon>
      <rect x="1" y="1" width="18" height="14" rx="1" strokeDasharray="2 2" />
      <rect x="7" y="4" width="6" height="8" rx="0.5" />
    </Icon>
  );
}

/** Arrows out to the frame's edges. */
function FullIcon() {
  return (
    <Icon>
      <path d="M1 5V1h4M15 1h4v4M19 11v4h-4M5 15H1v-4M7 6 3 3M13 6l4-3M13 10l4 3M7 10l-4 3" />
    </Icon>
  );
}
