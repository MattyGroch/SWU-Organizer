import styles from './Loader.module.css';

/**
 * The HUD's wait screen: a targeting reticle locking on, centred in the page. The router
 * shows it while a route's sets load, and pages show it while their first query answers.
 * `label` is what's being fetched, read out to screen readers and shown under the reticle.
 */
export function Loader({ label = 'Loading' }: { label?: string }) {
  return (
    <div className={styles.loader} role="status" aria-live="polite">
      <div className={styles.reticle} aria-hidden="true">
        <span className={styles.sweep} />
        <svg viewBox="0 0 120 120" className={styles.svg}>
          {/* Outer tick ring: one long tick every 45°, short ones between. */}
          <g className={styles.ticks}>
            <circle cx="60" cy="60" r="56" pathLength="120" />
          </g>
          <g className={styles.majorTicks}>
            <circle cx="60" cy="60" r="56" pathLength="8" />
          </g>
          {/* Two counter-rotating arcs, closing in. */}
          <circle className={styles.arcOuter} cx="60" cy="60" r="46" pathLength="100" />
          <circle className={styles.arcInner} cx="60" cy="60" r="36" pathLength="100" />
          {/* Crosshair, broken at the centre. */}
          <g className={styles.crosshair}>
            <line x1="60" y1="18" x2="60" y2="46" />
            <line x1="60" y1="74" x2="60" y2="102" />
            <line x1="18" y1="60" x2="46" y2="60" />
            <line x1="74" y1="60" x2="102" y2="60" />
          </g>
          <rect className={styles.core} x="55" y="55" width="10" height="10" />
        </svg>
        <span className={`${styles.bracket} ${styles.tl}`} />
        <span className={`${styles.bracket} ${styles.tr}`} />
        <span className={`${styles.bracket} ${styles.bl}`} />
        <span className={`${styles.bracket} ${styles.br}`} />
      </div>
      <p className={styles.label}>
        {label}
        <span className={styles.dots} aria-hidden="true">
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </span>
      </p>
    </div>
  );
}
