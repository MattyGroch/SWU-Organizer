import { pageSide } from '~/domain/binder';

import styles from './Pocket.module.css';

/**
 * The open spread's two pages of 3×4 pockets, with the card's page outlined and its pocket
 * lit. Page 1 has the inside cover, not a page, to its left.
 */
export function Pocket({ page, row, column }: { page: number; row: number; column: number }) {
  const side = pageSide(page);
  return (
    <div className={styles.spread} aria-hidden="true">
      {(['left', 'right'] as const).map((s) =>
        s === 'left' && page === 1 ? (
          <div key={s} className={styles.cover} />
        ) : (
          <div key={s} className={styles.pocket} data-target={s === side || undefined}>
            {Array.from({ length: 12 }, (_, i) => (
              <span
                key={i}
                className={styles.pocketCell}
                data-target={
                  (s === side && Math.floor(i / 4) + 1 === row && (i % 4) + 1 === column) ||
                  undefined
                }
              />
            ))}
          </div>
        ),
      )}
    </div>
  );
}
