import type { PreconCatalogEntry } from '~/domain/precons';

import styles from './PreconList.module.css';

type Props = {
  precons: PreconCatalogEntry[];
  ownership: Record<string, number>;
  onToggle: (key: string) => void;
  onSetOwned: (keys: string[], owned: boolean) => void;
};

/**
 * Preconstructed decks you own.
 *
 * Precons stay sealed: their cards are part of your collection (for exports to other
 * tools) but never part of deck building, since they are never broken up to pull from.
 */
export function PreconList({ precons, ownership, onToggle, onSetOwned }: Props) {
  if (precons.length === 0) return null;

  const bySet = new Map<string, PreconCatalogEntry[]>();
  for (const precon of precons) {
    const list = bySet.get(precon.setKey) ?? [];
    list.push(precon);
    bySet.set(precon.setKey, list);
  }

  const isOwned = (key: string) => (ownership[key] ?? 0) > 0;
  const ownedCount = precons.filter((p) => isOwned(p.key)).length;
  const allKeys = precons.map((p) => p.key);

  return (
    <details className={styles.panel}>
      <summary className={styles.summary}>
        <h2 className={styles.title}>Precon decks</h2>
        <span className={styles.count}>
          {ownedCount} of {precons.length} owned
        </span>
      </summary>

      <div className={styles.header}>
        <span className={styles.bulk}>
          <button
            type="button"
            className={styles.link}
            disabled={ownedCount === precons.length}
            onClick={() => onSetOwned(allKeys, true)}
          >
            Own all
          </button>
          <button
            type="button"
            className={styles.link}
            disabled={ownedCount === 0}
            onClick={() => onSetOwned(allKeys, false)}
          >
            Clear all
          </button>
        </span>
      </div>
      <p className={styles.lead}>
        Owned precons count toward your collection but stay sealed — their cards are never pulled
        for decks.
      </p>

      <div className={styles.groups}>
        {[...bySet.entries()].map(([setKey, entries]) => {
          const keys = entries.map((e) => e.key);
          const ownedHere = keys.filter(isOwned).length;
          return (
            <section key={setKey} className={styles.group} aria-label={`${setKey} precons`}>
              <div className={styles.groupHeader}>
                <h3 className={styles.groupTitle}>{setKey}</h3>
                <span className={styles.groupCount}>
                  {ownedHere}/{entries.length}
                </span>
                <span className={styles.bulk}>
                  <button
                    type="button"
                    className={styles.link}
                    disabled={ownedHere === entries.length}
                    onClick={() => onSetOwned(keys, true)}
                    aria-label={`Own all ${setKey} precons`}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    className={styles.link}
                    disabled={ownedHere === 0}
                    onClick={() => onSetOwned(keys, false)}
                    aria-label={`Clear ${setKey} precons`}
                  >
                    None
                  </button>
                </span>
              </div>
              <ul className={styles.tiles}>
                {entries.map((precon) => {
                  const owned = isOwned(precon.key);
                  return (
                    <li key={precon.key}>
                      <button
                        type="button"
                        className={styles.tile}
                        aria-pressed={owned}
                        onClick={() => onToggle(precon.key)}
                      >
                        <span className={styles.check} aria-hidden="true">
                          {owned ? '✓' : ''}
                        </span>
                        <span className={styles.label}>{precon.label}</span>
                        <span className={styles.aspect}>{precon.aspect}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </details>
  );
}
