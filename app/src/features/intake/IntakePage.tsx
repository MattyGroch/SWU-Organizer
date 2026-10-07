import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { IntakeLine } from '~/data/db';
import { quotaForCard } from '~/domain/ownership';
import {
  adjustCardCount,
  buildScannedDeck,
  bulkPreview,
  commitBatch,
  convertToDeckScan,
  discardBatch,
  moveCopy,
  removeCard,
  resetCard,
  scannedDeckRows,
  sourcePrinting,
} from '~/data/intake';
import {
  artNumber,
  artUrl,
  VARIANTS,
  variantLabel,
  variantShortLabel,
  type LoadedSet,
  type Printing,
} from '~/domain/catalog';
import { deckContentsFromRows, type DeckContentsFailureReason } from '~/domain/deckContents';
import type { SetKey } from '~/domain/types';
import { StackList } from '~/features/putAway/StackList';
import { useToast } from '~/ui/toastContext';

import styles from './IntakePage.module.css';
import { useIntake, type BatchWithLines } from './useIntake';

type Props = {
  sets: Map<SetKey, LoadedSet>;
};

/**
 * Cards on their way into the collection.
 *
 * Every line starts at a card's Normal printing; the review here is the chance to say
 * "that one is a Hyperspace" before anything counts as owned.
 */
export function IntakePage({ sets }: Props) {
  const { batches, loading } = useIntake();

  return (
    <div className={styles.page}>
      <header className={styles.intro}>
        <h1 className={styles.title}>Intake</h1>
        <p className={`${styles.lead} ${styles.wideOnly}`}>
          Cards waiting to be added to your collection. Every copy starts as Normal: click a
          printing to move one copy onto it. Click N to move one back (from the highest printing
          first), or ↺ to put them all back. Then add the batch.
        </p>
        <p className={`${styles.lead} ${styles.narrowOnly}`}>
          Cards waiting to be added to your collection. Tap Fix to change a card’s printing or
          count, then add the batch.
        </p>
      </header>

      <StackList />

      {!loading && batches.length === 0 && (
        <div className={styles.empty}>
          <p>
            Nothing queued. Scanned cards and scanned decks land here; so do a saved deck’s cards
            when you use <strong>Add to collection</strong> on it.
          </p>
          <Link to="/scan" className={styles.primary}>
            Start scanning
          </Link>
        </div>
      )}

      {batches.map((batch) => (
        <Batch key={batch.id} batch={batch} sets={sets} />
      ))}
    </div>
  );
}

function Batch({ batch, sets }: { batch: BatchWithLines; sets: Map<SetKey, LoadedSet> }) {
  const showToast = useToast();
  const [confirming, setConfirming] = useState<'discard' | 'deck' | null>(null);
  const [busy, setBusy] = useState(false);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const deckScan = batch.kind === 'deckScan';
  const scannedDeck = useMemo(
    () => (deckScan ? scannedDeckOf(batch.lines, sets) : null),
    [deckScan, batch.lines, sets],
  );
  const deckName = nameDraft ?? scannedDeck?.suggestedName ?? '';
  const cards = groupByCard(batch.lines);
  const changed = batch.lines
    .filter((l) => l.variant !== 'normal')
    .reduce((sum, l) => sum + l.count, 0);
  const quotaOf = (setKey: SetKey, base: number) => {
    const card = sets.get(setKey)?.cardsByBase.get(base);
    return card ? quotaForCard(card) : Infinity;
  };

  async function build() {
    setBusy(true);
    try {
      const result = await buildScannedDeck(batch.id, deckName, sets, { quotaOf });
      if (!result.ok) {
        showToast({ tone: 'danger', message: SCANNED_DECK_PROBLEM[result.reason] });
        setBusy(false);
        return;
      }
      showToast({
        tone: 'success',
        message: `Saved “${result.deck.name}” and marked it built with ${result.report.copies} cards.`,
      });
    } catch {
      showToast({ tone: 'danger', message: 'Could not build the deck.' });
      setBusy(false);
    }
  }

  async function commit() {
    setBusy(true);
    try {
      const report = await commitBatch(batch.id, { quotaOf });
      const toBulk = report.toBulk
        ? ` ${report.toBulk} ${report.toBulk === 1 ? 'copy goes' : 'copies go'} to the bulk box.`
        : '';
      showToast({
        tone: 'success',
        message:
          (report.deckBuilt
            ? `Added ${report.copies} cards and marked “${batch.label}” built.`
            : `Added ${report.copies} cards to your collection.`) + toBulk,
      });
    } catch {
      showToast({ tone: 'danger', message: 'Could not add the batch.' });
      setBusy(false);
    }
  }

  return (
    <section className={styles.batch} aria-labelledby={`batch-${batch.id}`}>
      <div className={styles.batchHeader}>
        <h2 id={`batch-${batch.id}`} className={styles.batchTitle}>
          {batch.label}
        </h2>
        <span className={styles.badge}>{BADGE[batch.kind]}</span>
        <span className={styles.meta}>
          {batch.copies} {batch.copies === 1 ? 'card' : 'cards'}
          {changed > 0 && ` · ${changed} non-Normal`}
        </span>
      </div>
      {batch.kind === 'deck' && (
        <p className={styles.note}>
          These go straight into the deck’s box: the deck is marked built, and your binder counts do
          not change.
        </p>
      )}
      {deckScan && (
        <p className={styles.note}>
          One built deck, scanned. Check the printings, name it and build it: the cards go straight
          into the deck’s box, and your binder counts do not change.
        </p>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table} aria-label={`${batch.label} cards`}>
          <thead>
            <tr>
              <th scope="col" className={`${styles.resetCol} ${styles.wideOnly}`}>
                <span className="visually-hidden">Reset</span>
              </th>
              <th scope="col">Card</th>
              <th scope="col" className={styles.wideOnly}>
                Printings
              </th>
              <th scope="col" className={styles.center}>
                Qty
              </th>
              <th scope="col">
                <span className="visually-hidden">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {cards.map((card) => (
              <CardRow
                key={`${card.setKey}:${card.base}`}
                batchId={batch.id}
                lines={card.lines}
                set={sets.get(card.setKey)}
                previewBulk={batch.kind === 'scan'}
              />
            ))}
          </tbody>
        </table>
      </div>

      {scannedDeck && (
        <div className={styles.deckForm}>
          <p className={styles.deckSummary}>{scannedDeck.summary}</p>
          {scannedDeck.problem && (
            <p className={styles.problem} role="status">
              {SCANNED_DECK_PROBLEM[scannedDeck.problem]}
            </p>
          )}
          <label className={styles.nameField}>
            <span>Deck name</span>
            <input
              className={styles.input}
              value={deckName}
              placeholder="Untitled deck"
              onChange={(event) => setNameDraft(event.target.value)}
            />
          </label>
        </div>
      )}

      <div className={styles.footer}>
        {deckScan ? (
          <button
            type="button"
            className={styles.primary}
            disabled={busy || batch.copies === 0 || Boolean(scannedDeck?.problem)}
            onClick={() => void build()}
          >
            {`Build deck with ${batch.copies} ${batch.copies === 1 ? 'card' : 'cards'}`}
          </button>
        ) : (
          <button
            type="button"
            className={styles.primary}
            disabled={busy || batch.copies === 0}
            onClick={() => void commit()}
          >
            {batch.kind === 'deck'
              ? `Add ${batch.copies} ${batch.copies === 1 ? 'card' : 'cards'} & mark deck built`
              : `Add ${batch.copies} ${batch.copies === 1 ? 'card' : 'cards'} to collection`}
          </button>
        )}
        {confirming === 'deck' ? (
          <span className={styles.confirm}>
            Build these into a deck instead?
            <button
              type="button"
              className={styles.primary}
              onClick={() => {
                setConfirming(null);
                void convertToDeckScan(batch.id);
              }}
            >
              Make it a deck
            </button>
            <button type="button" className={styles.action} onClick={() => setConfirming(null)}>
              Cancel
            </button>
          </span>
        ) : confirming === null && batch.kind === 'scan' ? (
          <button
            type="button"
            className={styles.action}
            title="These cards are one built deck: build it instead of filing them"
            onClick={() => setConfirming('deck')}
          >
            It’s a deck
          </button>
        ) : null}
        {confirming === 'discard' ? (
          <span className={styles.confirm}>
            Discard this batch?
            <button
              type="button"
              className={styles.danger}
              onClick={() => void discardBatch(batch.id)}
            >
              Discard
            </button>
            <button type="button" className={styles.action} onClick={() => setConfirming(null)}>
              Keep
            </button>
          </span>
        ) : confirming === null ? (
          <button type="button" className={styles.action} onClick={() => setConfirming('discard')}>
            Discard batch
          </button>
        ) : null}
      </div>
    </section>
  );
}

const BADGE: Record<BatchWithLines['kind'], string> = {
  deck: 'Deck',
  scan: 'Scanned',
  deckScan: 'Scanned deck',
};

const SCANNED_DECK_PROBLEM: Record<DeckContentsFailureReason, string> = {
  'missing-leader': 'No leader scanned yet: scan it to build the deck.',
  'missing-base': 'No base scanned yet: scan it to build the deck.',
  'too-many-leaders':
    'Too many leaders: a deck takes one, or two different ones for Twin Suns. Remove the extra.',
  'too-many-bases': 'More than one base: a deck takes one. Remove the extra.',
};

/** What a scanned deck adds up to so far, and why it cannot be built yet, if it cannot. */
function scannedDeckOf(lines: IntakeLine[], sets: Map<SetKey, LoadedSet>) {
  const rows = scannedDeckRows(lines, sets);
  const result = deckContentsFromRows(rows);
  const titled = (role: 'leader' | 'base') =>
    rows
      .filter((r) => r.role === role)
      .map((r) => (r.subtitle ? `${r.name}, ${r.subtitle}` : r.name));
  const leaders = titled('leader');
  const bases = titled('base');
  const main = rows.filter((r) => r.role === 'deck').reduce((sum, r) => sum + r.count, 0);
  const summary = [
    `${leaders.length > 1 ? 'Leaders' : 'Leader'}: ${leaders.join(' & ') || 'none yet'}`,
    `Base: ${bases.join(', ') || 'none yet'}`,
    `${main} in the main deck`,
  ].join(' · ');
  const leader = rows.find((r) => r.role === 'leader');
  const base = rows.find((r) => r.role === 'base');
  return {
    summary,
    problem: result.ok ? null : result.reason,
    suggestedName: leader ? (base ? `${leader.name} – ${base.name}` : leader.name) : '',
  };
}

type CardGroup = { setKey: SetKey; base: number; lines: IntakeLine[] };

/** One row per card, however many printings its copies are spread across. */
function groupByCard(lines: IntakeLine[]): CardGroup[] {
  const groups = new Map<string, CardGroup>();
  for (const line of lines) {
    const key = `${line.setKey}:${line.base}`;
    const group = groups.get(key) ?? {
      setKey: line.setKey,
      base: line.base,
      lines: [],
    };
    group.lines.push(line);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Everything a card's row and its Fix sheet need: counts per printing, and the moves. */
function useCardModel(batchId: string, lines: IntakeLine[], set: LoadedSet | undefined) {
  const { setKey, base } = lines[0]!;
  const ref = { batchId, setKey, base };
  const card = set?.byNumber.get(base);
  const name = card?.Name ?? `#${base}`;
  const printings: Printing[] = set?.printingsByBase.get(base) ?? [];
  const source = sourcePrinting(printings);
  const countOf = (num: string) => lines.find((l) => l.num === num)?.count ?? 0;
  const total = lines.reduce((sum, l) => sum + l.count, 0);
  const sourceCount = source ? countOf(source.num) : 0;

  // Printings come in hotkey order (N, F, H, HF, P, …), so the last one holding a copy is
  // the "highest" — the first to give one back.
  const highest = [...printings].reverse().find((p) => p.num !== source?.num && countOf(p.num) > 0);

  function allocate(printing: Printing, back: boolean) {
    if (!source) return;
    if (printing.num === source.num) {
      if (highest) void moveCopy(ref, highest, source);
      return;
    }
    void (back ? moveCopy(ref, printing, source) : moveCopy(ref, source, printing));
  }

  return {
    ref,
    setKey,
    base,
    card,
    name,
    printings,
    source,
    countOf,
    total,
    sourceCount,
    highest,
    allocate,
    mixed: total !== sourceCount,
  };
}

type CardModel = ReturnType<typeof useCardModel>;

function CardRow({
  batchId,
  lines,
  set,
  previewBulk,
}: {
  batchId: string;
  lines: IntakeLine[];
  set: LoadedSet | undefined;
  /** Scanned cards only: a deck's cards go into its box, never to bulk. */
  previewBulk: boolean;
}) {
  const model = useCardModel(batchId, lines, set);
  const { ref, setKey, base, card, name, printings, source, countOf, total, mixed } = model;
  const [fixing, setFixing] = useState(false);

  return (
    <tr data-mixed={mixed}>
      <td className={`${styles.resetCol} ${styles.wideOnly}`}>
        <ResetButton model={model} />
      </td>
      <td>
        <span className={styles.cardName}>{name}</span>
        {card?.Subtitle && <span className={styles.subtitle}>{card.Subtitle}</span>}
        <span className={styles.where}>
          {setKey} #{base}
          <span className={styles.narrowOnly}>
            {' · '}
            {printings
              .filter((p) => countOf(p.num) > 0)
              .map((p) => `${countOf(p.num)} ${variantShortLabel(p.variant)}`)
              .join(' · ')}
          </span>
        </span>
        {previewBulk && card && (
          <BulkNote
            lines={lines}
            quota={quotaForCard({ type: card.Type, maxCopies: card.MaxCopies })}
          />
        )}
      </td>
      <td className={styles.wideOnly}>
        <PrintingButtons model={model} />
      </td>
      <td className={styles.center}>
        <span className={styles.stepper}>
          <span className={styles.wideOnly}>
            <StepButton model={model} delta={-1} />
          </span>
          <span className={styles.qty}>{total}</span>
          <span className={styles.wideOnly}>
            <StepButton model={model} delta={1} />
          </span>
        </span>
      </td>
      <td className={styles.rowActions}>
        <button
          type="button"
          className={`${styles.fix} ${styles.narrowOnly}`}
          aria-label={`Fix ${name}`}
          onClick={() => setFixing(true)}
        >
          Fix
        </button>
        <button
          type="button"
          className={`${styles.remove} ${styles.wideOnly}`}
          aria-label={`Remove ${name} from the batch`}
          onClick={() => void removeCard(ref)}
        >
          ✕
        </button>
        {fixing && source && <FixCardDialog model={model} onClose={() => setFixing(false)} />}
      </td>
    </tr>
  );
}

/**
 * "To bulk: 1 Normal": the copies this card's pocket has no room for once the batch is
 * added. They are the weakest of what the pocket would hold, so they can be copies already
 * in the binder, bumped by a better printing.
 */
function BulkNote({ lines, quota }: { lines: IntakeLine[]; quota: number }) {
  const moved = useLiveQuery(() => bulkPreview(lines, quota), [lines]);
  const parts = VARIANTS.filter((v) => (moved?.[v] ?? 0) > 0).map(
    (v) => `${moved![v]} ${variantLabel(v)}`,
  );
  if (!parts.length) return null;
  return <span className={styles.toBulk}>To bulk: {parts.join(', ')}</span>;
}

function ResetButton({ model, wide = false }: { model: CardModel; wide?: boolean }) {
  const { ref, name, source, mixed } = model;
  return (
    <button
      type="button"
      className={wide ? styles.action : styles.reset}
      disabled={!mixed}
      aria-label={`Move every ${name} back to ${source ? variantLabel(source.variant) : 'its first printing'}`}
      title="Move them all back"
      onClick={() => source && void resetCard(ref, source)}
    >
      {wide ? `↺ All back to ${source ? variantLabel(source.variant) : 'Normal'}` : '↺'}
    </button>
  );
}

function StepButton({ model, delta }: { model: CardModel; delta: 1 | -1 }) {
  const { ref, name, source, total } = model;
  return (
    <button
      type="button"
      className={styles.step}
      disabled={delta < 0 && total <= 1}
      aria-label={delta < 0 ? `One fewer ${name}` : `One more ${name}`}
      onClick={() => source && void adjustCardCount(ref, source, delta)}
    >
      {delta < 0 ? '−' : '+'}
    </button>
  );
}

/** The allocation buttons: [count / printing], one per printing the card has. */
function PrintingButtons({ model, large = false }: { model: CardModel; large?: boolean }) {
  const { name, printings, source, countOf, sourceCount, highest, allocate } = model;
  return (
    <span
      className={large ? `${styles.alloc} ${styles.allocLarge}` : styles.alloc}
      role="group"
      aria-label={`Printings of ${name}`}
    >
      {printings.map((printing) => {
        const count = countOf(printing.num);
        const isSource = printing.num === source?.num;
        const label = variantLabel(printing.variant);
        return (
          <button
            key={printing.num}
            type="button"
            className={styles.allocButton}
            data-count={count}
            data-source={isSource}
            aria-label={
              isSource
                ? `${label}: ${count}. Move one back`
                : `${label}: ${count}. Move one from ${variantLabel(source!.variant)}`
            }
            title={
              isSource
                ? `${label} · ${printing.num} — click: move one back, highest printing first`
                : `${label} · ${printing.num} — click: one from ${variantLabel(source!.variant)}; Shift-click or right-click: one back`
            }
            disabled={isSource ? !highest : sourceCount === 0 && count === 0}
            onClick={(event) => allocate(printing, event.shiftKey)}
            onContextMenu={(event) => {
              event.preventDefault();
              allocate(printing, true);
            }}
          >
            <span className={styles.allocCount}>{count || ''}</span>
            <span className={styles.allocLabel}>{variantShortLabel(printing.variant)}</span>
          </button>
        );
      })}
    </span>
  );
}

/**
 * Phones: one card's printings and count, in a sheet big enough to tap. A single copy —
 * the usual scan — just moves to whichever printing is tapped.
 */
function FixCardDialog({ model, onClose }: { model: CardModel; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { ref, card, name, setKey, base, printings, countOf, total } = model;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const shown = [...printings].reverse().find((p) => countOf(p.num) > 0) ?? printings[0];
  const single = printings.find((p) => countOf(p.num) > 0);

  // Rendered at the page root, not inside its table row, so the row's layout can't leak in.
  return createPortal(
    <dialog
      ref={dialogRef}
      className={styles.sheet}
      onClose={onClose}
      aria-labelledby={`fix-${setKey}-${base}`}
    >
      <div className={styles.sheetHeader}>
        {shown && (
          <img
            className={styles.sheetArt}
            src={artUrl(setKey, artNumber(printings, shown))}
            alt=""
          />
        )}
        <div>
          <h2 id={`fix-${setKey}-${base}`} className={styles.sheetTitle}>
            {name}
          </h2>
          {card?.Subtitle && <span className={styles.subtitle}>{card.Subtitle}</span>}
          <span className={styles.where}>
            {setKey} #{shown?.num ?? base} · {shown ? variantLabel(shown.variant) : ''}
          </span>
        </div>
      </div>

      {total === 1 && single ? (
        <div className={styles.choiceGrid} role="radiogroup" aria-label={`Printing of ${name}`}>
          {printings.map((printing) => (
            <button
              key={printing.num}
              type="button"
              role="radio"
              aria-checked={printing.num === single.num}
              className={styles.choice}
              onClick={() => printing.num !== single.num && void moveCopy(ref, single, printing)}
            >
              {variantLabel(printing.variant)}
            </button>
          ))}
        </div>
      ) : (
        <>
          <p className={styles.note}>
            Tap a printing to move one copy onto it; tap {variantShortLabel(model.source!.variant)}{' '}
            to move one back.
          </p>
          <PrintingButtons model={model} large />
          <ResetButton model={model} wide />
        </>
      )}

      <div className={styles.sheetRow}>
        <span>Copies</span>
        <span className={styles.stepper}>
          <StepButton model={model} delta={-1} />
          <span className={styles.qty}>{total}</span>
          <StepButton model={model} delta={1} />
        </span>
      </div>

      <div className={styles.footer}>
        <button type="button" className={styles.primary} onClick={() => dialogRef.current?.close()}>
          Done
        </button>
        <button
          type="button"
          className={styles.danger}
          onClick={() => {
            dialogRef.current?.close();
            void removeCard(ref);
          }}
        >
          Remove from batch
        </button>
      </div>
    </dialog>,
    document.body,
  );
}
