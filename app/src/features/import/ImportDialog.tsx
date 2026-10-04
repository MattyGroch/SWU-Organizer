import { useEffect, useRef, useState } from 'react';

import { applyImport, buildExport, type ImportMode } from '~/data/applyImport';
import { variantLabel, type VariantSlug } from '~/domain/catalog';
import type { CatalogLookup, ImportResult, SkipReason } from '~/domain/import';
import type { SetKey } from '~/domain/types';

import styles from './ImportDialog.module.css';
import { readImportFile } from './readFile';

type Props = {
  catalog: CatalogLookup;
  onClose: () => void;
};

const MODES: Array<{ mode: ImportMode; title: string; detail: string }> = [
  {
    mode: 'add',
    title: 'Add to collection',
    detail: 'Add these counts on top of what you already have — e.g. a box you just opened.',
  },
  {
    mode: 'missing',
    title: 'Only add what I am missing',
    detail: 'Write only printings you have none of. Anything you already own keeps its count.',
  },
  {
    mode: 'higher',
    title: 'Keep the higher count',
    detail: 'For each printing, keep whichever is larger — the file or your collection.',
  },
  {
    mode: 'replaceSets',
    title: 'Replace these sets',
    detail: 'Clear only the sets in this file, then write exactly what it contains.',
  },
  {
    mode: 'replaceAll',
    title: 'Replace entire collection',
    detail: 'Clear every set, then write exactly what the file contains. Use to restore a backup.',
  },
];

const SKIP_LABEL: Record<SkipReason, string> = {
  'unknown-set': 'Set not in the catalog',
  'unknown-card': 'Card not found',
  'unknown-variant': 'That card has no such printing',
  malformed: 'Could not be read',
  'reserved-key': 'Not a real set',
};

type Summary = {
  bySet: Array<{ setKey: SetKey; copies: number; printings: number }>;
  byVariant: Array<{ variant: VariantSlug; copies: number }>;
  skipsByReason: Array<{ reason: SkipReason; count: number; examples: string[] }>;
};

function summarize(result: ImportResult): Summary {
  const setTotals = new Map<SetKey, { copies: number; printings: number }>();
  const variantTotals = new Map<VariantSlug, number>();

  for (const printing of result.printings) {
    const set = setTotals.get(printing.setKey) ?? { copies: 0, printings: 0 };
    set.copies += printing.count;
    set.printings += 1;
    setTotals.set(printing.setKey, set);
    variantTotals.set(
      printing.variant,
      (variantTotals.get(printing.variant) ?? 0) + printing.count,
    );
  }

  const skipGroups = new Map<SkipReason, { count: number; examples: string[] }>();
  for (const skip of result.skipped) {
    const group = skipGroups.get(skip.reason) ?? { count: 0, examples: [] };
    group.count += 1;
    if (group.examples.length < 3) group.examples.push(skip.detail);
    skipGroups.set(skip.reason, group);
  }

  return {
    bySet: [...setTotals.entries()]
      .map(([setKey, totals]) => ({ setKey, ...totals }))
      .sort((a, b) => b.copies - a.copies),
    byVariant: [...variantTotals.entries()]
      .map(([variant, copies]) => ({ variant, copies }))
      .sort((a, b) => b.copies - a.copies),
    skipsByReason: [...skipGroups.entries()]
      .map(([reason, group]) => ({ reason, ...group }))
      .sort((a, b) => b.count - a.count),
  };
}

export function ImportDialog({ catalog, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<ImportMode>('add');
  const [restoreDecks, setRestoreDecks] = useState(true);
  /** Sets in the file to leave out of this import, e.g. one already accurate here. */
  const [skippedSets, setSkippedSets] = useState<Set<SetKey>>(() => new Set());
  const [applied, setApplied] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError('');
    setResult(null);
    setApplied('');
    setFileName(file.name);
    try {
      const read = await readImportFile(file, catalog);
      setResult(read);
      // This app's own backup is almost always being restored; anything else is usually
      // new cards being added.
      setMode(read.format === 'app-json' ? 'replaceAll' : 'add');
      setRestoreDecks(true);
      setSkippedSets(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.');
    } finally {
      setBusy(false);
    }
  }

  async function onApply() {
    if (!result) return;
    setBusy(true);
    try {
      const report = await applyImport(chosen, mode, {
        deckLibrary: restoreDecks ? result.deckLibrary : undefined,
      });
      const delta = report.copiesDelta;
      const parts = [
        `${delta >= 0 ? 'Added' : 'Removed'} ${Math.abs(delta)} ${Math.abs(delta) === 1 ? 'copy' : 'copies'} across ${report.printingsWritten} printings.`,
      ];
      if (report.printingsUnchanged) {
        parts.push(`${report.printingsUnchanged} printings already matched and were left alone.`);
      }
      if (report.decksRestored) parts.push('Decks restored.');
      setApplied(parts.join(' '));
      setResult(null);
    } catch {
      setError('The import could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  async function onExport() {
    const payload = await buildExport();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `SWU-Backup-${payload.exportedAt.slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const summary = result ? summarize(result) : null;
  const chosen = result ? result.printings.filter((p) => !skippedSets.has(p.setKey)) : [];
  const chosenCopies = chosen.reduce((sum, p) => sum + p.count, 0);
  const includedSets = summary ? summary.bySet.filter((e) => !skippedSets.has(e.setKey)) : [];

  function toggleSet(setKey: SetKey) {
    setSkippedSets((current) => {
      const next = new Set(current);
      if (next.has(setKey)) next.delete(setKey);
      else next.add(setKey);
      return next;
    });
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onClose={onClose}
      aria-labelledby="import-title"
    >
      <div className={styles.header}>
        <h2 id="import-title" className={styles.title}>
          Import &amp; export
        </h2>
        <button type="button" className={styles.close} onClick={() => dialogRef.current?.close()}>
          Close
        </button>
      </div>

      <div className={styles.body}>
        <p className={styles.lead}>
          Accepts a SW-Unlimited export (CSV or XLSX), a SWUDB CSV, a Hyperspace Vault export (CSV
          or JSON), or a backup downloaded from here. Variant columns are kept as separate printings
          rather than summed.
        </p>

        <label className={styles.filePicker}>
          <span>Choose a file</span>
          <input
            type="file"
            accept=".csv,.xlsx,.xls,.json,text/csv,application/json"
            onChange={(event) => void onFile(event.target.files?.[0])}
          />
        </label>

        {busy && <p role="status">Reading {fileName}…</p>}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        {applied && (
          <p role="status" className={styles.success}>
            {applied}
          </p>
        )}

        {result && summary && (
          <section className={styles.preview} aria-label="Import preview">
            <p className={styles.summaryLine}>
              <strong>{result.copies}</strong> copies · <strong>{result.recognized}</strong> entries
              recognized · <strong>{result.skipped.length}</strong> skipped
            </p>

            {summary.byVariant.length > 0 && (
              <div>
                <h3 className={styles.sectionTitle}>By printing</h3>
                <ul className={styles.chips}>
                  {summary.byVariant.map((entry) => (
                    <li key={entry.variant} className={styles.chip}>
                      {variantLabel(entry.variant)}
                      <strong>{entry.copies}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <h3 className={styles.sectionTitle}>By set — click a set to skip it</h3>
              <ul className={styles.chips}>
                {summary.bySet.map((entry) => (
                  <li key={entry.setKey}>
                    <button
                      type="button"
                      className={styles.setToggle}
                      aria-pressed={!skippedSets.has(entry.setKey)}
                      aria-label={`${entry.setKey}, ${entry.copies} copies — ${skippedSets.has(entry.setKey) ? 'skipped' : 'included'}`}
                      onClick={() => toggleSet(entry.setKey)}
                    >
                      {entry.setKey}
                      <strong>{entry.copies}</strong>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {summary.skipsByReason.length > 0 && (
              <div>
                <h3 className={styles.sectionTitle}>Skipped</h3>
                <ul className={styles.skips}>
                  {summary.skipsByReason.map((group) => (
                    <li key={group.reason}>
                      <strong>{group.count}</strong> — {SKIP_LABEL[group.reason]}
                      <span className={styles.examples}> ({group.examples.join('; ')})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <fieldset className={styles.modes}>
              <legend className={styles.sectionTitle}>How should this be applied?</legend>
              {MODES.map((option) => (
                <label key={option.mode}>
                  <input
                    type="radio"
                    name="import-mode"
                    checked={mode === option.mode}
                    onChange={() => setMode(option.mode)}
                  />
                  <span>
                    <strong>{option.title}</strong> — {option.detail}
                  </span>
                </label>
              ))}
            </fieldset>

            {result.deckLibrary && (
              <label className={styles.deckOption}>
                <input
                  type="checkbox"
                  checked={restoreDecks}
                  onChange={(event) => setRestoreDecks(event.target.checked)}
                />
                <span>
                  Also restore <strong>{result.deckLibrary.customDecks.length}</strong> saved decks
                  and precon ownership — replaces your current decks.
                </span>
              </label>
            )}

            {(mode === 'replaceAll' || mode === 'replaceSets') && (
              <p className={styles.danger}>
                {mode === 'replaceAll'
                  ? skippedSets.size
                    ? `Every card count you have now will be erased — including ${[...skippedSets].join(', ')}, which this import skips.`
                    : 'Every card count you have now will be erased.'
                  : `Current counts for ${includedSets.map((e) => e.setKey).join(', ') || 'no sets'} will be erased${skippedSets.size ? `; ${[...skippedSets].join(', ')} ${skippedSets.size === 1 ? 'stays as it is' : 'stay as they are'}` : ''}.`}{' '}
                <button type="button" className={styles.inlineLink} onClick={() => void onExport()}>
                  Download a backup first
                </button>
              </p>
            )}

            <button
              type="button"
              className={styles.apply}
              onClick={() => void onApply()}
              data-danger={mode === 'replaceAll' || mode === 'replaceSets'}
              disabled={busy || (chosen.length === 0 && !(result.deckLibrary && restoreDecks))}
            >
              {mode === 'replaceAll'
                ? `Replace collection with ${chosenCopies} copies`
                : `Import ${chosenCopies} copies`}
            </button>
          </section>
        )}

        <hr className={styles.divider} />

        <div className={styles.backup}>
          <button type="button" className={styles.secondary} onClick={() => void onExport()}>
            Download backup
          </button>
          <span className={styles.hint}>
            Every card and printing, plus saved decks and precons, as one JSON file. Re-import it
            here with any of the options above.
          </span>
        </div>
      </div>
    </dialog>
  );
}
