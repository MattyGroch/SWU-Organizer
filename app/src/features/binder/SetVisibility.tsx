import { useQueryClient } from '@tanstack/react-query';

import {
  useLeaderBaseCopies,
  writeHiddenSets,
  writeLeaderBaseCopies,
  type LeaderBaseCopies,
} from '~/data/binderSettings';
import { setQuery } from '~/data/catalog';
import { db } from '~/data/db';
import { settleCards } from '~/data/spill';
import type { SetManifestEntry } from '~/domain/catalog';
import { quotaForCard } from '~/domain/ownership';
import type { SetKey } from '~/domain/types';
import { useToast } from '~/ui/toastContext';

import styles from './SetVisibility.module.css';

type Props = {
  entries: SetManifestEntry[];
  hidden: ReadonlySet<SetKey>;
};

const isLeaderOrBase = (type?: string) => /^(leader|base)$/i.test((type ?? '').trim());

/**
 * Binder settings.
 *
 * Which sets get a binder: a set with no physical binder — TS26 and IBH live only in
 * precon decks — can be dropped from the picker, `[`/`]` and search without losing its
 * cards. And how many copies of each Leader and Base the binder keeps: two leaves one in
 * the pocket while the other is out in a deck.
 */
export function SetVisibility({ entries, hidden }: Props) {
  const shownCount = entries.filter((e) => !hidden.has(e.key)).length;
  const leaderBaseCopies = useLeaderBaseCopies();
  const queryClient = useQueryClient();
  const showToast = useToast();

  function toggle(key: SetKey) {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    void writeHiddenSets(next);
  }

  /**
   * Fewer copies moves each pocket's extras to the bulk box. More moves nothing: the bulk
   * box never refills the binder, so the pocket just shows it is short.
   */
  async function setLeaderBaseCopies(copies: LeaderBaseCopies) {
    await writeLeaderBaseCopies(copies);
    if (copies >= leaderBaseCopies) return;
    const sets = await Promise.all(
      entries.map((entry) => queryClient.ensureQueryData(setQuery(entry))),
    );
    const catalog = new Map(sets.map((set) => [set.setKey, set]));
    const cardOf = (setKey: SetKey, base: number) => catalog.get(setKey)?.cardsByBase.get(base);
    const cards = new Map<string, { setKey: SetKey; base: number }>();
    for (const row of await db.owned.toArray()) {
      if (isLeaderOrBase(cardOf(row.setKey, row.base)?.type)) {
        cards.set(`${row.setKey}:${row.base}`, { setKey: row.setKey, base: row.base });
      }
    }
    const moved = await settleCards([...cards.values()], (setKey, base) => {
      const card = cardOf(setKey, base);
      return card ? quotaForCard(card, copies) : Infinity;
    });
    if (moved) {
      showToast({
        tone: 'info',
        message: `${moved} Leader and Base ${moved === 1 ? 'copy goes' : 'copies go'} to the bulk box.`,
      });
    }
  }

  return (
    <details className={styles.menu}>
      <summary className={styles.summary}>
        Settings
        {hidden.size > 0 && <span className={styles.badge}>{hidden.size} sets hidden</span>}
      </summary>
      <div className={styles.panel}>
        <fieldset className={styles.group}>
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

        <fieldset className={styles.group}>
          <legend className={styles.legend}>Leaders &amp; Bases in the binder</legend>
          {([1, 2] as const).map((copies) => (
            <label key={copies} className={styles.option}>
              <input
                type="radio"
                name="leader-base-copies"
                checked={leaderBaseCopies === copies}
                onChange={() => void setLeaderBaseCopies(copies)}
              />
              <span>{copies === 1 ? '1 copy' : '2 copies'}</span>
            </label>
          ))}
          <p className={styles.note}>
            Two keeps one in the pocket while the other is out in a deck. Extra copies live in the
            bulk box.
          </p>
        </fieldset>
      </div>
    </details>
  );
}
