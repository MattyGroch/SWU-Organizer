import type { DeckRole, DeckRowWithNeed } from '~/domain/decklist';
import { formatUsd } from '~/ui/format';

import { AspectIcons } from '../binder/AspectIcons';
import { RarityBadge } from '../binder/RarityBadge';
import { CostBadge } from './CostBadge';
import { CardStats, HpBadge, PowerBadge } from './StatBadge';
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
      <table className={styles.table} aria-label={label} data-box={box ? true : undefined}>
        <thead>
          <tr>
            <th scope="col" className={styles.wideOnly}>
              Role
            </th>
            <th scope="col" className={`${styles.aspects} ${styles.wideOnly}`}>
              Aspect
            </th>
            <th scope="col">Card</th>
            <th scope="col" className={`${styles.icon} ${styles.wideOnly}`}>
              Cost
            </th>
            <th scope="col" className={`${styles.icon} ${styles.wideOnly}`}>
              Power
            </th>
            <th scope="col" className={`${styles.icon} ${styles.wideOnly}`}>
              HP
            </th>
            <th scope="col" className={styles.wideOnly}>
              Set
            </th>
            <th scope="col" className={`${styles.icon} ${styles.wideOnly}`}>
              Rarity
            </th>
            <th scope="col" className={styles.numeric}>
              Qty
            </th>
            <th scope="col" className={`${styles.numeric} ${styles.wideWithBox}`}>
              Have
            </th>
            <th scope="col" className={`${styles.numeric} ${styles.wideWithBox}`}>
              Need
            </th>
            <th
              scope="col"
              className={`${styles.numeric} ${styles.wideOnly}`}
              title="What the copies you still need would cost"
            >
              To buy
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
              <td className={`${styles.aspects} ${styles.wideOnly}`}>
                <AspectIcons aspects={row.aspects} />
              </td>
              <td>
                {/* Phones: the aspect, cost, power and HP columns fold into a line of badges. */}
                <span className={`${styles.badges} ${styles.narrowOnly}`}>
                  <AspectIcons aspects={row.aspects} className={styles.badgeAspects} />
                  {row.cost !== undefined && <CostBadge cost={row.cost} />}
                  <CardStats type={row.type} power={row.power} hp={row.hp} />
                </span>
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
              <td className={`${styles.icon} ${styles.wideOnly}`}>
                <CostBadge cost={row.cost} />
              </td>
              <td className={`${styles.icon} ${styles.wideOnly}`}>
                {row.power !== undefined && row.type !== 'Base' && (
                  <PowerBadge value={row.power} signed={row.type === 'Upgrade'} />
                )}
              </td>
              <td className={`${styles.icon} ${styles.wideOnly}`}>
                {row.hp !== undefined && <HpBadge value={row.hp} signed={row.type === 'Upgrade'} />}
              </td>
              <td className={styles.wideOnly}>{row.setKey}</td>
              <td className={`${styles.icon} ${styles.wideOnly}`}>
                <RarityBadge rarity={row.rarity} title={row.rarity} />
              </td>
              <td className={styles.numeric}>{row.count}</td>
              <td className={`${styles.numeric} ${styles.wideWithBox}`}>{row.have}</td>
              <td className={`${styles.numeric} ${styles.wideWithBox}`}>{row.needed || ''}</td>
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
