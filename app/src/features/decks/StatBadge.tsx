import { useId } from 'react';

import styles from './StatBadge.module.css';

/*
 * HP and Power badges, drawn in SVG after the Star Wars: Unlimited community's stat art:
 * a glossy blue "peanut" for HP — a rounded square pinched at the waist — and a red
 * rupee-like shield for Power, whose top and bottom edges curve in to their points. The
 * number is live text, so any value works. Sized in em, like `CostBadge`.
 */

type Props = { value: number | undefined };

/** Each badge needs its own gradient ids: two badges sharing one break if one unmounts. */
function useIds() {
  const id = useId().replace(/:/g, '');
  return { fill: `${id}-fill`, clip: `${id}-clip` };
}

function StatNumber({ value, fill, stroke }: { value: string; fill: string; stroke: string }) {
  return (
    <text
      x="50"
      y="50"
      dy="0.36em"
      textAnchor="middle"
      className={styles.number}
      fontSize={value.length > 1 ? 44 : 52}
      fill={fill}
      stroke={stroke}
      strokeWidth="8"
      strokeLinejoin="round"
      paintOrder="stroke"
    >
      {value}
    </text>
  );
}

const HP_PATH =
  'M50 4 C69.8 4 84.1 9 88.5 21 C91.8 30 91.8 38 88.5 46 C91.8 55 92.9 66 89.6 76 C85.2 89 69.8 96 50 96 ' +
  'C30.2 96 14.8 89 10.4 76 C7.1 66 8.2 55 11.5 46 C8.2 38 8.2 30 11.5 21 C15.9 9 30.2 4 50 4 Z';

export function HpBadge({ value }: Props) {
  const ids = useIds();
  const text = value === undefined ? '–' : String(value);
  return (
    <svg className={styles.badge} viewBox="0 0 100 100" role="img" aria-label={`${text} HP`}>
      <defs>
        <linearGradient id={ids.fill} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0%" stopColor="#6fd0f7" />
          <stop offset="45%" stopColor="#1f9ad8" />
          <stop offset="100%" stopColor="#0b5f9e" />
        </linearGradient>
        <clipPath id={ids.clip}>
          <path d={HP_PATH} />
        </clipPath>
      </defs>
      <path d={HP_PATH} fill={`url(#${ids.fill})`} />
      <g clipPath={`url(#${ids.clip})`}>
        {/* The vertical light band and the diagonal sheen across the top. */}
        <rect x="56" y="0" width="12" height="100" fill="#ffffff" opacity="0.18" />
        <polygon points="0,30 100,8 100,26 0,50" fill="#ffffff" opacity="0.2" />
      </g>
      <path d={HP_PATH} fill="none" stroke="#06223a" strokeWidth="3" strokeLinejoin="round" />
      <StatNumber value={text} fill="#ffffff" stroke="#06223a" />
    </svg>
  );
}

const POWER_PATH = 'M50 3 Q65 15 87 18 L87 82 Q65 85 50 97 Q35 85 13 82 L13 18 Q35 15 50 3 Z';

export function PowerBadge({ value }: Props) {
  const ids = useIds();
  const text = value === undefined ? '–' : String(value);
  return (
    <svg className={styles.badge} viewBox="0 0 100 100" role="img" aria-label={`Power ${text}`}>
      <defs>
        <linearGradient id={ids.fill} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7e1a1a" />
          <stop offset="50%" stopColor="#d3282b" />
          <stop offset="100%" stopColor="#9a1416" />
        </linearGradient>
        <clipPath id={ids.clip}>
          <path d={POWER_PATH} />
        </clipPath>
      </defs>
      <path d={POWER_PATH} fill={`url(#${ids.fill})`} />
      <g clipPath={`url(#${ids.clip})`}>
        {/* The centre crease and the bright diagonal band. */}
        <rect x="47" y="0" width="9" height="100" fill="#ffffff" opacity="0.16" />
        <polygon points="0,50 100,24 100,36 0,62" fill="#ff5a4a" opacity="0.45" />
      </g>
      <path d={POWER_PATH} fill="none" stroke="#2a0506" strokeWidth="3" strokeLinejoin="round" />
      <StatNumber value={text} fill="#fff1ea" stroke="#2a0506" />
    </svg>
  );
}
