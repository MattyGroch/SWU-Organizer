import styles from './SetBadge.module.css';

/**
 * A set key in a small outlined box, e.g. "SOR". Card search leads each result with one,
 * and the inventory's set title ends with one. `current` brightens it, for the set on screen;
 * `size="large"` scales it to sit beside heading text.
 */
export function SetBadge({
  setKey,
  current,
  size = 'small',
  className,
}: {
  setKey: string;
  current?: boolean;
  size?: 'small' | 'large';
  className?: string;
}) {
  const classes = [styles.badge, size === 'large' && styles.large, className]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={classes} data-current={current}>
      {setKey}
    </span>
  );
}
