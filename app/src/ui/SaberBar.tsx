import type { AriaAttributes, AriaRole, CSSProperties } from 'react';
import styles from './SaberBar.module.css';

export type SaberSegment = {
  /** Share of the blade, 0–100. */
  percent: number;
  /** Blade colour; the HUD's when left out. */
  color?: string;
  /** Glows less: the part of the blade that isn't the point, e.g. what's missing. */
  dim?: boolean;
};

type Props = AriaAttributes & {
  segments: SaberSegment[];
  role?: AriaRole;
  title?: string;
  /** A thinner blade and shorter hilt, for phones. */
  compact?: boolean;
  className?: string;
};

/**
 * A progress bar drawn as a lightsaber: a hilt, then a blade with a white-hot core and a
 * glow in each segment's colour. It ignites from the hilt when it first appears; whatever
 * the segments don't cover is the unlit track.
 */
export function SaberBar({ segments, compact = false, className, ...rest }: Props) {
  const lit = segments.filter((s) => s.percent > 0);
  return (
    <div
      className={[styles.saber, className].filter(Boolean).join(' ')}
      data-compact={compact || undefined}
      {...rest}
    >
      <span className={styles.hilt} aria-hidden="true" />
      <span className={styles.track} aria-hidden="true">
        <span className={styles.blade}>
          {lit.map((s, i) => (
            <span
              key={i}
              className={styles.segment}
              data-dim={s.dim || undefined}
              style={
                {
                  width: `${s.percent}%`,
                  '--blade': s.color ?? 'var(--hud)',
                } as CSSProperties
              }
            />
          ))}
        </span>
      </span>
    </div>
  );
}
