import styles from './CostBadge.module.css';
import { StatNumber } from './StatBadge';
import { useBadgeIds } from './useBadgeIds';

/*
 * A card's cost, drawn in SVG to match the HP and Power badges: a mustard hexagon,
 * point up, paler through the middle, with sun rays behind the number. The viewBox is
 * a little narrower than it is tall, like the hexagon.
 */

const COST_PATH = 'M50 3 L93 14 L93 86 L50 97 L7 86 L7 14 Z';

export function CostBadge({ cost, className }: { cost: number | undefined; className?: string }) {
  const ids = useBadgeIds();
  const classes = [styles.badge, className].filter(Boolean).join(' ');
  if (cost === undefined) return <span className={classes} aria-hidden="true" />;
  return (
    <svg className={classes} viewBox="4 0 92 100" role="img" aria-label={`Cost ${cost}`}>
      <defs>
        <linearGradient id={ids.fill} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e2a83a" />
          <stop offset="50%" stopColor="#dccb4a" />
          <stop offset="100%" stopColor="#e0b23a" />
        </linearGradient>
        <clipPath id={ids.clip}>
          <path d={COST_PATH} />
        </clipPath>
      </defs>
      <path d={COST_PATH} fill={`url(#${ids.fill})`} />
      <g clipPath={`url(#${ids.clip})`}>
        {/* The sun rays fanning up from behind the number, and the diagonal sheen. */}
        <g fill="#fff3c4" opacity="0.3">
          <polygon points="50,62 22,0 32,0" />
          <polygon points="50,62 44,0 56,0" />
          <polygon points="50,62 68,0 78,0" />
          <polygon points="50,62 0,22 0,32" />
          <polygon points="50,62 100,22 100,32" />
        </g>
        <polygon points="0,30 100,8 100,22 0,44" fill="#ffffff" opacity="0.18" />
      </g>
      <path d={COST_PATH} fill="none" stroke="#353200" strokeWidth="3" strokeLinejoin="round" />
      <StatNumber value={String(cost)} fill="#fff6dc" stroke="#353200" />
    </svg>
  );
}
