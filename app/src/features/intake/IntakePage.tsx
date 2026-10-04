import { useState } from 'react';

import type { IntakeLine } from '~/data/db';
import {
  adjustCardCount,
  commitBatch,
  discardBatch,
  moveCopy,
  removeCard,
  resetCard,
  sourcePrinting,
} from '~/data/intake';
import { variantLabel, variantShortLabel, type LoadedSet, type Printing } from '~/domain/catalog';
import type { SetKey } from '~/domain/types';
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
        <p className={styles.lead}>
          Cards waiting to be added to your collection. Every copy starts as Normal: click a
          printing to move one copy onto it. Click N to move one back (from the highest printing
          first), or ↺ to put them all back. Then add the batch.
        </p>
      </header>

      {!loading && batches.length === 0 && (
        <p className={styles.empty}>
          Nothing queued. Use <strong>Add to collection</strong> on a saved deck to queue its cards
          here; scanned cards will land here too.
        </p>
      )}

      {batches.map((batch) => (
        <Batch key={batch.id} batch={batch} sets={sets} />
      ))}
    </div>
  );
}

function Batch({ batch, sets }: { batch: BatchWithLines; sets: Map<SetKey, LoadedSet> }) {
  const showToast = useToast();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [busy, setBusy] = useState(false);
  const cards = groupByCard(batch.lines);
  const changed = batch.lines
    .filter((l) => l.variant !== 'normal')
    .reduce((sum, l) => sum + l.count, 0);

  async function commit() {
    setBusy(true);
    try {
      const report = await commitBatch(batch.id);
      showToast({
        tone: 'success',
        message: report.deckBuilt
          ? `Added ${report.copies} cards and marked “${batch.label}” built.`
          : `Added ${report.copies} cards to your collection.`,
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
        <span className={styles.badge}>{batch.kind === 'deck' ? 'Deck' : 'Scanned'}</span>
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

      <div className={styles.tableWrap}>
        <table className={styles.table} aria-label={`${batch.label} cards`}>
          <thead>
            <tr>
              <th scope="col" className={styles.resetCol}>
                <span className="visually-hidden">Reset</span>
              </th>
              <th scope="col">Card</th>
              <th scope="col">Printings</th>
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
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.footer}>
        <button
          type="button"
          className={styles.primary}
          disabled={busy || batch.copies === 0}
          onClick={() => void commit()}
        >
          {batch.kind === 'deck'
            ? `Add ${batch.copies} cards & mark deck built`
            : `Add ${batch.copies} cards to collection`}
        </button>
        {confirmDiscard ? (
          <span className={styles.confirm}>
            Discard this batch?
            <button
              type="button"
              className={styles.danger}
              onClick={() => void discardBatch(batch.id)}
            >
              Discard
            </button>
            <button
              type="button"
              className={styles.action}
              onClick={() => setConfirmDiscard(false)}
            >
              Keep
            </button>
          </span>
        ) : (
          <button type="button" className={styles.action} onClick={() => setConfirmDiscard(true)}>
            Discard batch
          </button>
        )}
      </div>
    </section>
  );
}

type CardGroup = { setKey: SetKey; base: number; lines: IntakeLine[] };

/** One row per card, however many printings its copies are spread across. */
function groupByCard(lines: IntakeLine[]): CardGroup[] {
  const groups = new Map<string, CardGroup>();
  for (const line of lines) {
    const key = `${line.setKey}:${line.base}`;
    const group = groups.get(key) ?? { setKey: line.setKey, base: line.base, lines: [] };
    group.lines.push(line);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function CardRow({
  batchId,
  lines,
  set,
}: {
  batchId: string;
  lines: IntakeLine[];
  set: LoadedSet | undefined;
}) {
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

  const mixed = total !== sourceCount;

  return (
    <tr data-mixed={mixed}>
      <td className={styles.resetCol}>
        <button
          type="button"
          className={styles.reset}
          disabled={!mixed}
          aria-label={`Move every ${name} back to ${source ? variantLabel(source.variant) : 'its first printing'}`}
          title="Move them all back"
          onClick={() => source && void resetCard(ref, source)}
        >
          ↺
        </button>
      </td>
      <td>
        <span className={styles.cardName}>{name}</span>
        {card?.Subtitle && <span className={styles.subtitle}>{card.Subtitle}</span>}
        <span className={styles.where}>
          {setKey} #{base}
        </span>
      </td>
      <td>
        <span className={styles.alloc} role="group" aria-label={`Printings of ${name}`}>
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
      </td>
      <td className={styles.center}>
        <span className={styles.stepper}>
          <button
            type="button"
            className={styles.step}
            disabled={total <= 1}
            aria-label={`One fewer ${name}`}
            onClick={() => source && void adjustCardCount(ref, source, -1)}
          >
            −
          </button>
          <span className={styles.qty}>{total}</span>
          <button
            type="button"
            className={styles.step}
            aria-label={`One more ${name}`}
            onClick={() => source && void adjustCardCount(ref, source, 1)}
          >
            +
          </button>
        </span>
      </td>
      <td className={styles.rowActions}>
        <button
          type="button"
          className={styles.remove}
          aria-label={`Remove ${name} from the batch`}
          onClick={() => void removeCard(ref)}
        >
          ✕
        </button>
      </td>
    </tr>
  );
}
