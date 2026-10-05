import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { IntakeLine } from '~/data/db';
import {
  adjustCardCount,
  cancelSwap,
  commitBatch,
  discardBatch,
  moveCopy,
  removeCard,
  resetCard,
  sourcePrinting,
} from '~/data/intake';
import {
  artNumber,
  artUrl,
  variantLabel,
  variantShortLabel,
  type LoadedSet,
  type Printing,
} from '~/domain/catalog';
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
    .filter((l) => l.variant !== 'normal' && !l.swapOut)
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
                swaps={card.swaps}
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
            ? `Add ${batch.copies} ${batch.copies === 1 ? 'card' : 'cards'} & mark deck built`
            : `Add ${batch.copies} ${batch.copies === 1 ? 'card' : 'cards'} to collection`}
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

type CardGroup = { setKey: SetKey; base: number; lines: IntakeLine[]; swaps: IntakeLine[] };

/** One row per card, however many printings its copies are spread across. */
function groupByCard(lines: IntakeLine[]): CardGroup[] {
  const groups = new Map<string, CardGroup>();
  for (const line of lines) {
    const key = `${line.setKey}:${line.base}`;
    const group = groups.get(key) ?? {
      setKey: line.setKey,
      base: line.base,
      lines: [],
      swaps: [],
    };
    (line.swapOut ? group.swaps : group.lines).push(line);
    groups.set(key, group);
  }
  // A card whose copies were all removed has nothing left to add.
  return [...groups.values()].filter((group) => group.lines.length > 0);
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
  swaps,
  set,
}: {
  batchId: string;
  lines: IntakeLine[];
  swaps: IntakeLine[];
  set: LoadedSet | undefined;
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
        <SwapNotes swaps={swaps} name={name} />
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

/** "Swaps out 1 Normal": the weaker copies this card displaces from its pocket, to bulk. */
function SwapNotes({ swaps, name }: { swaps: IntakeLine[]; name: string }) {
  if (!swaps.length) return null;
  return (
    <span className={styles.swaps}>
      {swaps.map((swap) => (
        <span key={swap.id} className={styles.swap}>
          Swaps out {swap.count} {variantLabel(swap.variant)} — to bulk
          <button
            type="button"
            className={styles.keep}
            onClick={() => void cancelSwap(swap.id)}
            aria-label={`Keep the ${variantLabel(swap.variant)} ${name}; add the new copy as a spare`}
            title="Keep it: the new copy is added as a spare instead"
          >
            Keep
          </button>
        </span>
      ))}
    </span>
  );
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
