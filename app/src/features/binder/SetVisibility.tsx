import { writeHiddenSets } from '~/data/binderSettings';
import type { SetManifestEntry } from '~/domain/catalog';
import type { SetKey } from '~/domain/types';

import styles from './SetVisibility.module.css';

type Props = {
  entries: SetManifestEntry[];
  hidden: ReadonlySet<SetKey>;
};

/**
 * Which sets get a binder. A set with no physical binder — TS26 lives only in precon
 * decks — can be dropped from the picker, `[`/`]` and search without losing its cards.
 */
export function SetVisibility({ entries, hidden }: Props) {
  const shownCount = entries.filter((e) => !hidden.has(e.key)).length;

  function toggle(key: SetKey) {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    void writeHiddenSets(next);
  }

  return (
    <details className={styles.menu}>
      <summary className={styles.summary}>
        Sets
        {hidden.size > 0 && <span className={styles.badge}>{hidden.size} hidden</span>}
      </summary>
      <fieldset className={styles.panel}>
        <legend className={styles.legend}>Show in the binder</legend>
        {entries.map((entry) => {
          const shown = !hidden.has(entry.key);
          return (
            <label key={entry.key} className={styles.option}>
              <input
                type="checkbox"
                checked={shown}
                // Keep at least one binder.
                disabled={shown && shownCount === 1}
                onChange={() => toggle(entry.key)}
              />
              <span>{entry.label}</span>
            </label>
          );
        })}
        <p className={styles.note}>
          Hidden sets keep their cards — they still count in decks, imports and backups.
        </p>
      </fieldset>
    </details>
  );
}
