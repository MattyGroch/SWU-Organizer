import { useQueryClient } from '@tanstack/react-query';

import { useState } from 'react';

import { writeHiddenSets } from '~/data/binderSettings';
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
 * cards. And a one-off tidy for pockets still holding a second Leader or Base from when
 * the binder kept two.
 */
export function SetVisibility({ entries, hidden }: Props) {
  const shownCount = entries.filter((e) => !hidden.has(e.key)).length;
  const [settling, setSettling] = useState(false);
  const queryClient = useQueryClient();
  const showToast = useToast();

  function toggle(key: SetKey) {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    void writeHiddenSets(next);
  }

  /**
   * Moves each Leader and Base pocket's extras to the bulk box. A button rather than a
   * migration on load: sync merges bulk counts as changes, so two devices both moving the
   * same spare would count it twice. Run on one device, the move syncs to the rest, and a
   * second run finds nothing to move.
   */
  async function settleLeadersAndBases() {
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
      return card ? quotaForCard(card) : Infinity;
    });
    showToast({
      tone: 'info',
      message: moved
        ? `${moved} Leader and Base ${moved === 1 ? 'copy goes' : 'copies go'} to the bulk box.`
        : 'Every Leader and Base pocket already holds one copy.',
    });
  }

  function onSettle() {
    setSettling(true);
    void settleLeadersAndBases().finally(() => setSettling(false));
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
          <p className={styles.note}>
            The binder keeps one copy of each. Spares live in the bulk box.
          </p>
          <button type="button" className={styles.action} disabled={settling} onClick={onSettle}>
            {settling ? 'Moving…' : 'Move spare copies to bulk'}
          </button>
        </fieldset>
      </div>
    </details>
  );
}
