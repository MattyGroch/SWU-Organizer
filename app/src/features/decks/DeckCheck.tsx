import { useEffect, useMemo, useRef, useState } from 'react';

import { toCanonicalCatalog, type LoadedSet } from '~/domain/catalog';
import {
  computeDeckRows,
  parseDeckList,
  resolveDeckList,
  summarizeDeck,
  type DeckLookupSet,
} from '~/domain/decklist';
import {
  buildCardPool,
  checkDeckLegality,
  FORMAT_RULES,
  PLAY_FORMATS,
  type FormatChoice,
} from '~/domain/deckLegality';
import {
  deckContentsFailureMessage,
  type CreateSavedDeckResult,
  type NewSavedDeckInput,
} from '~/domain/decks';
import type { ResolvedDeckRow } from '~/domain/decklist';
import type { SetKey } from '~/domain/types';
import { Checkbox } from '~/ui/Checkbox';
import { formatUsd } from '~/ui/format';
import { useToast } from '~/ui/toastContext';

import styles from './DeckCheck.module.css';
import { DeckRowsTable } from './DeckRowsTable';
import type { OwnedLookup } from './deckRows';

type Props = {
  sets: Map<SetKey, LoadedSet>;
  lookup: Map<SetKey, DeckLookupSet>;
  /** Copies owned across the collection, spares and cards in built decks included. */
  owned: OwnedLookup;
  onSave: (rows: ResolvedDeckRow[], input: NewSavedDeckInput) => Promise<CreateSavedDeckResult>;
  onClose: () => void;
};

/**
 * The Import popup: pastes a decklist, reports what it would cost to build from the
 * collection and whether it is legal, and saves it to My decks, which closes it.
 *
 * All four decklist formats (swudb JSON, Melee, picklist, plain text) are handled by the
 * ported `decklist.ts`, unchanged from the legacy app and still covered by its original
 * tests.
 */
export function DeckCheck({ sets, lookup, owned, onSave, onClose }: Props) {
  const showToast = useToast();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  const [text, setText] = useState('');
  const [format, setFormat] = useState<FormatChoice>('auto');
  const [includeSideboard, setIncludeSideboard] = useState(true);
  // `null` until edited, so the name follows whatever the pasted list calls itself.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [saveError, setSaveError] = useState('');

  const setOrder = useMemo(() => [...sets.keys()], [sets]);
  const canonical = useMemo(() => toCanonicalCatalog(sets.values()), [sets]);
  const pool = useMemo(() => buildCardPool(sets.values()), [sets]);

  const analysis = useMemo(() => {
    if (!text.trim()) return null;

    const parsed = parseDeckList(text);
    const resolution = resolveDeckList(parsed, canonical, lookup, setOrder, owned);
    const rows = computeDeckRows(resolution.rows, owned);
    const summary = summarizeDeck(rows, includeSideboard);
    const legality = checkDeckLegality(resolution.rows, format, pool);

    return { parsed, resolution, rows, summary, legality };
  }, [text, canonical, lookup, setOrder, owned, includeSideboard, format, pool]);

  const name = nameDraft ?? analysis?.resolution.deckName ?? '';

  async function save() {
    if (!analysis) return;
    let result: CreateSavedDeckResult;
    try {
      result = await onSave(analysis.resolution.rows, {
        name,
        // The physical-copy option is retired: a deck bought built goes through Intake.
        physical: false,
        copies: 1,
        sourceText: text,
        format: analysis.legality.format,
      });
    } catch (error) {
      // Say so rather than leave a button that seems to do nothing.
      setSaveError(
        `The deck could not be saved: ${error instanceof Error ? error.message : error}`,
      );
      return;
    }
    if (!result.ok) {
      setSaveError(`${deckContentsFailureMessage(result.reason)} It can't be saved yet.`);
      return;
    }
    showToast({ tone: 'success', message: `Saved “${result.deck.name}” to My decks.` });
    dialogRef.current?.close();
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onClose={onClose}
      aria-labelledby="deck-check-title"
    >
      <div className={styles.header}>
        <h2 id="deck-check-title" className={styles.title}>
          Import a decklist
        </h2>
        <button
          type="button"
          className={styles.secondary}
          onClick={() => dialogRef.current?.close()}
        >
          Close
        </button>
      </div>
      <div className={styles.panel}>
        <p className={styles.lead}>
          Paste a decklist — swudb JSON, a Melee export, a picklist, or one card per line — to see
          what you have, what it would cost to finish, and whether it is legal. Save it to keep it
          in My decks.
        </p>

        <label className={styles.field}>
          <span className="visually-hidden">Decklist</span>
          <textarea
            className={styles.textarea}
            rows={8}
            value={text}
            placeholder={'3 Vanquish (SOR)\n2 Daring Raid (SOR)\n…'}
            onChange={(event) => {
              setText(event.target.value);
              setSaveError('');
            }}
          />
        </label>

        <div className={styles.controls}>
          <label className={styles.control}>
            <span>Format</span>
            <select
              value={format}
              onChange={(event) => setFormat(event.target.value as FormatChoice)}
            >
              <option value="auto">Detect automatically</option>
              {PLAY_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {FORMAT_RULES[f].label}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.checkbox}>
            <Checkbox
              checked={includeSideboard}
              onChange={(event) => setIncludeSideboard(event.target.checked)}
            />
            <span>Include sideboard</span>
          </label>
        </div>

        {analysis && (
          <div className={styles.results}>
            <dl className={styles.summary}>
              <div>
                <dt>Format read as</dt>
                <dd>{analysis.parsed.format}</dd>
              </div>
              <div>
                <dt>Cards needed</dt>
                <dd>{analysis.summary.totalNeededCards}</dd>
              </div>
              <div>
                <dt>Cost to finish</dt>
                <dd>{formatUsd(analysis.summary.totalCost)}</dd>
              </div>
              <div>
                <dt>Leader</dt>
                <dd>{ownedLabel(analysis.summary.leaderOwned)}</dd>
              </div>
              <div>
                <dt>Base</dt>
                <dd>{ownedLabel(analysis.summary.baseOwned)}</dd>
              </div>
            </dl>

            <p className={analysis.legality.legal ? styles.legal : styles.illegal}>
              {analysis.legality.legal ? 'Legal' : 'Not legal'} for {analysis.legality.rules.label}.
            </p>

            {analysis.legality.issues.length > 0 && (
              <ul className={styles.issues}>
                {analysis.legality.issues.map((issue, index) => (
                  <li key={`${issue.code}-${index}`}>{issue.message}</li>
                ))}
              </ul>
            )}

            {analysis.resolution.unresolved.length > 0 && (
              <details className={styles.unresolved}>
                <summary>{analysis.resolution.unresolved.length} line(s) not matched</summary>
                <ul>
                  {analysis.resolution.unresolved.map((entry, index) => (
                    <li key={index}>
                      {entry.count}× {entry.name}
                      {entry.subtitle ? ` — ${entry.subtitle}` : ''} ({entry.reason})
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <DeckRowsTable rows={analysis.rows} label="Decklist cards" />

            <div className={styles.save}>
              <label className={styles.control}>
                <span>Name</span>
                <input
                  type="text"
                  className={styles.input}
                  value={name}
                  placeholder="Untitled deck"
                  onChange={(event) => setNameDraft(event.target.value)}
                />
              </label>
              <button type="button" className={styles.primary} onClick={() => void save()}>
                Save to My decks
              </button>
            </div>
            {saveError && (
              <p role="alert" className={styles.illegal}>
                {saveError}
              </p>
            )}
          </div>
        )}
      </div>
    </dialog>
  );
}

function ownedLabel(owned: boolean | null): string {
  if (owned === null) return 'not in list';
  return owned ? 'owned' : 'missing';
}
