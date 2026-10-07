import { aspectIcon } from './aspectIcons';
import styles from './AspectIcons.module.css';

type Props = {
  aspects: readonly string[] | undefined;
  className?: string;
};

/**
 * A card's aspect icons, in the order the card prints them (a doubled aspect shows twice,
 * as on the card). Decorative: the aspects are named elsewhere. Neutral cards show nothing.
 */
export function AspectIcons({ aspects, className }: Props) {
  const icons = (aspects ?? []).flatMap((aspect) => aspectIcon(aspect) ?? []);
  if (icons.length === 0) return null;
  return (
    <span className={[styles.icons, className].filter(Boolean).join(' ')} aria-hidden="true">
      {icons.map((src, i) => (
        <img key={i} className={styles.icon} src={src} alt="" draggable={false} />
      ))}
    </span>
  );
}
