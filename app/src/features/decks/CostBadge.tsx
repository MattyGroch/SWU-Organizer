import styles from './CostBadge.module.css';
import { StatNumber } from './StatBadge';
import { useBadgeIds } from './useBadgeIds';

/*
 * A card's cost, drawn in SVG to sit with the HP and Power badges. Traced from
 * CommCody103's fan-made cost icon (see src/assets/aspects/CREDITS.md): a hexagon,
 * point up, whose fill runs from white at the top (the pale rim) through lime to orange,
 * with an orange sky cut by lime sun rays above a curved horizon. The viewBox is a
 * little narrower than it is tall, like the hexagon.
 */

const HEX_PATH = 'M50 3 L93 13.7 L93 86.3 L50 97 L7 86.3 L7 13.7 Z';
const SKY_PATH = 'M14.7 58 L14.7 19.6 L50 10.7 L85.3 19.6 L85.3 58 Q50 33.7 14.7 58 Z';

/** Thin wedges from the sun, behind the number, out past the sky's edge. */
const RAYS = [
  '50,49.6 -20.2,46.2 -19.9,42.8',
  '50,49.6 -12.6,17.6 -10.9,14.6',
  '50,49.6 6.9,-5.9 9.7,-7.9',
  '50,49.6 33.8,-18.8 37.2,-19.5',
  '50,49.6 62.8,-19.5 66.2,-18.8',
  '50,49.6 90.3,-7.9 93.1,-5.9',
  '50,49.6 110.9,14.6 112.6,17.6',
  '50,49.6 119.9,42.8 120.2,46.2',
];

export function CostBadge({ cost, className }: { cost: number | undefined; className?: string }) {
  const ids = useBadgeIds();
  const classes = [styles.badge, className].filter(Boolean).join(' ');
  if (cost === undefined) return <span className={classes} aria-hidden="true" />;
  return (
    <svg className={classes} viewBox="4 0 92 100" role="img" aria-label={`Cost ${cost}`}>
      <defs>
        <linearGradient id={ids.fill} x1="0" y1="0" x2="0" y2="1">
          <stop offset="2%" stopColor="#ffffff" />
          <stop offset="14%" stopColor="#e8eec2" />
          <stop offset="30%" stopColor="#c6d136" />
          <stop offset="55%" stopColor="#cec835" />
          <stop offset="72%" stopColor="#d4b131" />
          <stop offset="96%" stopColor="#e19828" />
        </linearGradient>
        <clipPath id={ids.clip}>
          <path d={SKY_PATH} />
        </clipPath>
      </defs>
      <path d={HEX_PATH} fill={`url(#${ids.fill})`} />
      <path d={SKY_PATH} fill="#d99526" />
      <g
        clipPath={`url(#${ids.clip})`}
        fill="#c8d23a"
        stroke="#c4821a"
        strokeWidth="0.6"
        strokeLinejoin="round"
      >
        {RAYS.map((points) => (
          <polygon key={points} points={points} />
        ))}
      </g>
      <path d={SKY_PATH} fill="none" stroke="#c4821a" strokeWidth="0.7" />
      <path d={HEX_PATH} fill="none" stroke="#393600" strokeWidth="3" strokeLinejoin="round" />
      <StatNumber value={String(cost)} fill="#f2f4c6" stroke="#5c4c1e" />
    </svg>
  );
}
