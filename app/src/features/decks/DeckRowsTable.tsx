import type { DeckRole, DeckRowWithNeed } from '~/domain/decklist';
import { formatUsd } from '~/ui/format';

import styles from './DeckRowsTable.module.css';

const ROLE_LABEL: Record<DeckRole, string> = {
  leader: 'Leader',
  base: 'Base',
  deck: 'Deck',
  sideboard: 'Side',
};

/** For built decks: how many of each row are in the box, with −/+ to move single copies. */
export type BoxColumn = {
  /** Aligned with `rows`. */
  counts: number[];
  /** Aligned with `rows`: false when the binder has no copy to put in. */
  canAdd: boolean[];
  onAdjust: (row: DeckRowWithNeed, delta: 1 | -1) => void;
};

type Props = {
  rows: DeckRowWithNeed[];
  /** Accessible name for the table. */
  label: string;
  box?: BoxColumn;
};

/** A deck's cards with what you have and what is still needed — used everywhere a deck is shown. */
export function DeckRowsTable({ rows, label, box }: Props) {
  return (
    <div className={styles.wrap}>
      <table className={styles.table} aria-label={label}>
        <thead>
          <tr>
            <th scope="col" className={styles.wideOnly}>
              Role
            </th>
            <th scope="col" className={styles.numeric}>
              Qty
            </th>
            <th scope="col">Card</th>
            <th scope="col" className={styles.wideOnly}>
              Set
            </th>
            <th scope="col" className={styles.numeric}>
              Have
            </th>
            <th scope="col" className={styles.numeric}>
              Need
            </th>
            <th scope="col" className={`${styles.numeric} ${styles.wideOnly}`}>
              Cost
            </th>
            {box && (
              <th scope="col" className={styles.boxCol}>
                In box
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={`${row.role}:${row.setKey}:${row.baseNumber}`}
              data-short={row.needed > 0}
              data-box-short={box ? (box.counts[index] ?? 0) < row.count : undefined}
            >
              <td className={`${styles.role} ${styles.wideOnly}`}>{ROLE_LABEL[row.role]}</td>
              <td className={styles.numeric}>{row.count}</td>
              <td>
                {row.name}
                {row.ambiguous && (
                  <span
                    className={styles.ambiguous}
                    title={
                      row.ambiguousOtherSets?.length
                        ? `Name also matches ${row.ambiguousOtherSets.join(', ')} — guessed ${row.setKey}`
                        : 'Guessed which printing you meant'
                    }
                  >
                    {' '}
                    ⚠
                  </span>
                )}
                {row.subtitle && <span className={styles.subtitle}>{row.subtitle}</span>}
                <span className={`${styles.role} ${styles.narrowOnly}`}>
                  {ROLE_LABEL[row.role]} · {row.setKey}
                </span>
              </td>
              <td className={styles.wideOnly}>{row.setKey}</td>
              <td className={styles.numeric}>{row.have}</td>
              <td className={styles.numeric}>{row.needed || ''}</td>
              <td className={`${styles.numeric} ${styles.wideOnly}`}>
                {row.rowCost ? formatUsd(row.rowCost) : ''}
              </td>
              {box && (
                <td className={styles.boxCol}>
                  <span className={styles.stepper}>
                    <button
                      type="button"
                      className={styles.step}
                      disabled={(box.counts[index] ?? 0) <= 0}
                      onClick={() => box.onAdjust(row, -1)}
                      aria-label={`Take one ${row.name} out of the box, back to the binder`}
                    >
                      −
                    </button>
                    <span className={styles.boxCount}>
                      {box.counts[index] ?? 0}/{row.count}
                    </span>
                    <button
                      type="button"
                      className={styles.step}
                      disabled={(box.counts[index] ?? 0) >= row.count || !box.canAdd[index]}
                      title={box.canAdd[index] ? undefined : 'No copy left in the binder'}
                      onClick={() => box.onAdjust(row, 1)}
                      aria-label={`Put one ${row.name} from the binder into the box`}
                    >
                      +
                    </button>
                  </span>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
