import styles from './CostBadge.module.css';

/*
 * Fan-made cost badges, 0–20: see src/assets/costs/CREDITS.md. `?no-inline` keeps each
 * one a separate cached file rather than base64 in the bundle.
 */
const BADGES = import.meta.glob<string>('../../assets/costs/cost*.webp', {
  eager: true,
  query: '?no-inline',
  import: 'default',
});

function badgeFor(cost: number): string | undefined {
  return BADGES[`../../assets/costs/cost${cost}.webp`];
}

/** A card's cost as its badge. A cost without one (none above 20) shows as plain text. */
export function CostBadge({ cost, className }: { cost: number | undefined; className?: string }) {
  const classes = (base: string | undefined) => [base, className].filter(Boolean).join(' ');
  if (cost === undefined) return <span className={classes(styles.none)} aria-hidden="true" />;
  const src = badgeFor(cost);
  if (!src) return <span className={classes(styles.text)}>{cost}</span>;
  return <img className={classes(styles.badge)} src={src} alt={`Cost ${cost}`} draggable={false} />;
}
