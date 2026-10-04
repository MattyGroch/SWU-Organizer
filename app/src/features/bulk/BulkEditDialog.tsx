import { useEffect, useRef, useState } from 'react';

import {
  bulkAdjust,
  resetCollection,
  restoreSnapshot,
  restoreSnapshots,
  type BulkAction,
  type BulkResult,
} from '~/data/bulk';
import { useQueryClient } from '@tanstack/react-query';

import { setQuery } from '~/data/catalog';
import type { LoadedSet, SetManifestEntry } from '~/domain/catalog';
import { STATUS_LABEL, type CardRow, type Filters } from '~/features/binder/cardRows';
import { useDeckLibrary } from '~/features/decks/useDeckLibrary';
import { downloadBackup } from '~/features/import/downloadBackup';
import { useToast } from '~/ui/toastContext';

import styles from './BulkEditDialog.module.css';
import { collectionRows, type SetRows } from './collectionRows';

type Props = {
  set: LoadedSet;
  /** The rows the card table is showing — the filters decide what a bulk edit touches. */
  rows: CardRow[];
  filters: Filters;
  /** Every set with a binder, for whole-collection edits. Loaded here if not yet. */
  binderSets: SetManifestEntry[];
  /** Sets hidden from the binder, which whole-collection edits leave alone. */
  hiddenSetKeys: string[];
  onClose: () => void;
};

const ACTIONS: Array<{ action: BulkAction; label: string; detail: string }> = [
  { action: 'add', label: '+1', detail: 'One more copy, only for cards short of a playset' },
  { action: 'fillPlayset', label: 'Fill to playset', detail: 'Top every card up to a playset' },
  { action: 'remove', label: '−1', detail: 'One copy fewer — plainest printing first' },
  { action: 'clear', label: 'Clear', detail: 'Remove every copy and printing' },
];

const RESET_PHRASE = 'RESET';

/** "Rare · Unit · Vigilance · name “vader”" — what the active filters narrow to. */
function describeFilters(filters: Filters): string {
  const parts = [
    ...filters.rarity,
    ...filters.type,
    ...filters.aspect.map((a) => (a === 'NEUTRAL' ? 'Neutral' : a)),
    ...filters.status.map((s) => STATUS_LABEL[s]),
  ];
  if (filters.text.trim()) parts.push(`name “${filters.text.trim()}”`);
  if (filters.hideInDecks) parts.push('hiding cards out in decks');
  return parts.join(' · ');
}

/**
 * Bulk edits for the cards the filters show, and resets for a set or everything.
 *
 * Replaces the legacy Bulk Actions modal. Instead of fixed rarity/type rows, the filters
 * pick the targets — so "fill every Rare Unit" is two filter clicks and one button. Every
 * change offers Undo rather than asking for confirmation first.
 */
export function BulkEditDialog({ set, rows, filters, binderSets, hiddenSetKeys, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const showToast = useToast();
  const [busy, setBusy] = useState(false);
  const [unbuildOnClear, setUnbuildOnClear] = useState(false);
  const [unbuildOnReset, setUnbuildOnReset] = useState(true);
  const [confirmSetReset, setConfirmSetReset] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [scope, setScope] = useState<'set' | 'collection'>('set');
  const [collection, setCollection] = useState<SetRows[] | null>(null);
  const { library } = useDeckLibrary();
  const queryClient = useQueryClient();

  // Whole-collection rows are worked out when that scope is chosen, under the same filters.
  useEffect(() => {
    if (scope !== 'collection') return;
    let cancelled = false;
    setCollection(null);
    // Every binder set, not just those the background prefetch has finished — opened
    // early, the dialog would otherwise quietly skip the sets still loading.
    void Promise.all(binderSets.map((entry) => queryClient.ensureQueryData(setQuery(entry))))
      .then((sets) => collectionRows(sets, filters, library))
      .then((result) => {
        if (!cancelled) setCollection(result);
      });
    return () => {
      cancelled = true;
    };
  }, [scope, binderSets, filters, library, queryClient]);

  const targets: SetRows[] = scope === 'set' ? [{ set, rows }] : (collection ?? []);
  const allRows = targets.flatMap((t) => t.rows);
  const loadingScope = scope === 'collection' && collection === null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const described = describeFilters(filters);
  const affected: Record<BulkAction, number> = {
    add: allRows.filter((r) => r.total < r.quota).length,
    fillPlayset: allRows.filter((r) => r.total < r.quota).length,
    remove: allRows.filter((r) => r.total > 0).length,
    clear: allRows.filter((r) => r.total > 0).length,
  };

  function close() {
    dialogRef.current?.close();
  }

  function done(result: BulkResult, message: string) {
    const decks = result.decksUnbuilt
      ? ` ${result.decksUnbuilt} ${result.decksUnbuilt === 1 ? 'deck' : 'decks'} returned to Not built.`
      : '';
    showToast({
      tone: 'success',
      message: message + decks,
      durationMs: 10000,
      action: { label: 'Undo', onAction: () => restoreSnapshot(result.undo) },
    });
    close();
  }

  async function run(action: BulkAction) {
    setBusy(true);
    try {
      const results: BulkResult[] = [];
      for (const target of targets) {
        const quotas = new Map(target.rows.map((r) => [r.base, r.quota]));
        results.push(
          await bulkAdjust(
            target.set,
            target.rows.map((r) => r.base),
            action,
            (base) => quotas.get(base) ?? 3,
            { unbuildDecks: action === 'clear' && unbuildOnClear },
          ),
        );
      }
      const changed = results.reduce((sum, r) => sum + r.changed, 0);
      const decksUnbuilt = results.reduce((sum, r) => sum + r.decksUnbuilt, 0);
      const setsChanged = results.filter((r) => r.changed > 0).length;
      const label = ACTIONS.find((a) => a.action === action)!.label;
      const where = scope === 'set' ? `in ${set.setKey}` : `across ${setsChanged} sets`;
      const decks = decksUnbuilt
        ? ` ${decksUnbuilt} ${decksUnbuilt === 1 ? 'deck' : 'decks'} returned to Not built.`
        : '';
      showToast({
        tone: 'success',
        message: `${label}: ${changed} ${changed === 1 ? 'card' : 'cards'} ${where} changed.${decks}`,
        durationMs: 10000,
        action: { label: 'Undo', onAction: () => restoreSnapshots(results.map((r) => r.undo)) },
      });
      close();
    } catch {
      showToast({ tone: 'danger', message: 'The bulk edit could not be saved.' });
      setBusy(false);
    }
  }

  async function reset(scope: 'set' | 'all') {
    setBusy(true);
    try {
      const result = await resetCollection(scope === 'set' ? set.setKey : undefined, {
        unbuildDecks: unbuildOnReset,
      });
      done(
        result,
        scope === 'set' ? `${set.setKey} has been reset.` : 'Your whole collection has been reset.',
      );
    } catch {
      showToast({ tone: 'danger', message: 'The reset could not be saved.' });
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onClose={onClose}
      aria-labelledby="bulk-title"
    >
      <div className={styles.header}>
        <h2 id="bulk-title" className={styles.title}>
          Bulk edit
        </h2>
        <button type="button" className={styles.secondary} onClick={close}>
          Close
        </button>
      </div>

      <div className={styles.body}>
        <section className={styles.section} aria-labelledby="bulk-scope">
          <h3 id="bulk-scope" className={styles.sectionTitle}>
            Applies to
          </h3>
          <div className={styles.scopeToggle} role="radiogroup" aria-label="Scope">
            <label>
              <input
                type="radio"
                name="bulk-scope"
                checked={scope === 'set'}
                onChange={() => setScope('set')}
              />
              <span>This set ({set.setKey})</span>
            </label>
            <label>
              <input
                type="radio"
                name="bulk-scope"
                checked={scope === 'collection'}
                onChange={() => setScope('collection')}
              />
              <span>Whole collection</span>
            </label>
          </div>

          {scope === 'collection' && (
            <p className={styles.collectionWarning} role="alert">
              <strong>Every set in your binder</strong> ({binderSets.length} sets) — the same
              filters applied to all of them at once.
              {hiddenSetKeys.length > 0 &&
                ` Hidden sets (${hiddenSetKeys.join(', ')}) are left out.`}{' '}
              Undo is offered after, but{' '}
              <button
                type="button"
                className={styles.inlineLink}
                onClick={() => void downloadBackup()}
              >
                a backup first
              </button>{' '}
              is wise.
            </p>
          )}

          <p className={styles.scope}>
            {loadingScope ? (
              'Working out which cards match…'
            ) : (
              <>
                <strong>
                  {allRows.length} {allRows.length === 1 ? 'card' : 'cards'}
                </strong>{' '}
                {scope === 'set' ? `in ${set.label}` : `across ${targets.length} sets`}
                {described ? (
                  <>
                    {' '}
                    — <span className={styles.filters}>{described}</span>
                  </>
                ) : scope === 'set' ? (
                  ' — every card in the set. Narrow it with the filters first.'
                ) : (
                  ' — every card in every set. Narrow it with the filters first.'
                )}
              </>
            )}
          </p>

          <div className={styles.actions}>
            {ACTIONS.map(({ action, label, detail }) => (
              <button
                key={action}
                type="button"
                className={action === 'clear' ? styles.dangerAction : styles.action}
                disabled={busy || loadingScope || affected[action] === 0}
                onClick={() => void run(action)}
                aria-label={`${label}: ${detail}. Changes ${affected[action]} cards.`}
              >
                <span className={styles.actionLabel}>{label}</span>
                <span className={styles.actionDetail}>{detail}</span>
                <span className={styles.actionCount}>
                  {affected[action]} {affected[action] === 1 ? 'card' : 'cards'}
                </span>
              </button>
            ))}
          </div>
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={unbuildOnClear}
              onChange={(event) => setUnbuildOnClear(event.target.checked)}
            />
            <span>Clear also returns built decks holding these cards to Not built</span>
          </label>
        </section>

        <details className={styles.danger}>
          <summary className={styles.dangerSummary}>Reset…</summary>
          <div className={styles.dangerBody}>
            <p className={styles.warning}>
              Resetting empties counts entirely, ignoring the filters.{' '}
              <button
                type="button"
                className={styles.inlineLink}
                onClick={() => void downloadBackup()}
              >
                Download a backup first
              </button>
              . Undo is offered right after, but a backup survives closing the page.
            </p>
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={unbuildOnReset}
                onChange={(event) => setUnbuildOnReset(event.target.checked)}
              />
              <span>Return built decks holding reset cards to Not built</span>
            </label>

            <div className={styles.resetRow}>
              {confirmSetReset ? (
                <>
                  <span>Empty every card in {set.setKey}?</span>
                  <button
                    type="button"
                    className={styles.dangerButton}
                    disabled={busy}
                    onClick={() => void reset('set')}
                  >
                    Reset {set.setKey}
                  </button>
                  <button
                    type="button"
                    className={styles.secondary}
                    onClick={() => setConfirmSetReset(false)}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => setConfirmSetReset(true)}
                >
                  Reset {set.setKey}…
                </button>
              )}
            </div>

            <div className={styles.resetRow}>
              <label className={styles.phrase}>
                <span>
                  Type <strong>{RESET_PHRASE}</strong> to empty the whole collection
                </span>
                <input
                  type="text"
                  value={phrase}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setPhrase(event.target.value)}
                />
              </label>
              <button
                type="button"
                className={styles.dangerButton}
                disabled={busy || phrase !== RESET_PHRASE}
                onClick={() => void reset('all')}
              >
                Reset entire collection
              </button>
            </div>
          </div>
        </details>
      </div>
    </dialog>
  );
}
