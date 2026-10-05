import { Link, useNavigate } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo } from 'react';

import { useHiddenSets } from '~/data/binderSettings';
import { db, readMeta, writeMeta, type StackCardRow, type StackRow } from '~/data/db';
import { dismissStack, resetPutAway, setStep, stackCards, startPutAway } from '~/data/stacks';
import { artUrl, variantLabel, type LoadedSet } from '~/domain/catalog';
import {
  PILES_PER_SORTER,
  pileCell,
  pileName,
  planPutAway,
  SORTER_NAMES,
  type AsideReason,
  type PutAwayStep,
  type SpreadRef,
} from '~/domain/putAway';
import type { SetKey } from '~/domain/types';

import styles from './PutAwayPage.module.css';
import { speechSupported, useSpeech } from './speech';

const SORTERS_KEY = 'putAway:sorters';
const SPEECH_KEY = 'putAway:speech';

type Props = { sets: Map<SetKey, LoadedSet>; stackId: string };

/**
 * Puts a scanned stack away, one card at a time, without reading a card number: deal each
 * card onto the pile shown, scoop the piles up, then file each card where the binder is
 * already open. See `domain/putAway.ts` for how the steps are chosen.
 */
export function PutAwayPage({ sets, stackId }: Props) {
  const stack = useLiveQuery(async () => (await db.stacks.get(stackId)) ?? null, [stackId]);
  const cards = useLiveQuery(() => stackCards(stackId), [stackId]);
  const hidden = useHiddenSets();
  const speech = useLiveQuery(async () => (await readMeta(db, SPEECH_KEY)) !== 'off', []);

  if (stack === undefined || cards === undefined || hidden === undefined) return null;
  if (stack === null) {
    return (
      <div className={styles.page}>
        <p className={styles.lead}>
          This stack is gone — it was put away or dismissed.{' '}
          <Link to="/intake">Back to Intake</Link>
        </p>
      </div>
    );
  }
  return stack.sorters ? (
    <Walk
      stack={stack}
      sorters={stack.sorters}
      cards={cards}
      sets={sets}
      hidden={hidden}
      speech={speech ?? true}
    />
  ) : (
    <Setup stack={stack} cards={cards} speech={speech ?? true} />
  );
}

function Setup({
  stack,
  cards,
  speech,
}: {
  stack: StackRow;
  cards: StackCardRow[];
  speech: boolean;
}) {
  const saved = useLiveQuery(async () => Number((await readMeta(db, SORTERS_KEY)) ?? 1), []);
  const queued = useLiveQuery(async () => {
    if (stack.closedAt !== undefined) return null;
    let total = 0;
    const scanBatches = new Set(
      (await db.intakeBatches.toArray()).filter((b) => b.kind === 'scan').map((b) => b.id),
    );
    await db.intakeLines.each((line) => {
      if (scanBatches.has(line.batchId) && !line.swapOut) total += line.count;
    });
    return total;
  }, [stack.closedAt]);
  const sorters = saved ?? 1;
  const toAdd = cards.filter((c) => c.fate === 'binder' || c.fate === 'spare').length;
  const aside = cards.filter((c) => c.fate !== 'binder').length;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Put away {cards.length} cards</h1>
      <p className={styles.lead}>
        Keep the stack in the order you scanned it, top card first. The app tells you where each
        card goes: first onto a pile in your sorter, then into the binder.
        {aside > 0 && ` ${aside} of them don’t go in the binder; they get a pile of their own.`}
      </p>
      {queued != null && queued !== toAdd && (
        <p className={styles.warning} role="status">
          Intake has {queued} scanned {queued === 1 ? 'card' : 'cards'}, but this stack has {toAdd}{' '}
          to add. If you changed cards in Intake, the steps may not match your stack.
        </p>
      )}

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Sorters on the table (3×3 each)</legend>
        <div className={styles.choiceRow} role="radiogroup" aria-label="Sorters">
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={sorters === n}
              className={styles.choice}
              onClick={() => void writeMeta(db, SORTERS_KEY, String(n))}
            >
              {n}
              <span className={styles.choiceNote}>{n * PILES_PER_SORTER} piles</span>
            </button>
          ))}
        </div>
      </fieldset>

      {speechSupported() && (
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={speech}
            onChange={(e) => void writeMeta(db, SPEECH_KEY, e.target.checked ? 'on' : 'off')}
          />
          Read each step aloud
        </label>
      )}

      <button
        type="button"
        className={styles.next}
        disabled={cards.length === 0}
        onClick={() => void startPutAway(stack.id, sorters)}
      >
        Start
      </button>
    </div>
  );
}

function Walk({
  stack,
  sorters,
  cards,
  sets,
  hidden,
  speech,
}: {
  stack: StackRow;
  sorters: number;
  cards: StackCardRow[];
  sets: Map<SetKey, LoadedSet>;
  hidden: Set<SetKey>;
  speech: boolean;
}) {
  const navigate = useNavigate();
  const steps = useMemo(
    () => planPutAway(cards, { setOrder: [...sets.keys()], hiddenSets: hidden, sorters }),
    [cards, sets, hidden, sorters],
  );
  const index = Math.min(stack.step, steps.length);
  const step = steps[index];
  const say = useSpeech(speech);

  const go = useCallback(
    (to: number) => {
      const next = Math.max(0, Math.min(steps.length, to));
      if (next === index) return;
      if (next > index) navigator.vibrate?.(30);
      void setStep(stack.id, next);
    },
    [index, stack.id, steps.length],
  );

  useEffect(() => {
    say(step ? spoken(step, sorters, sets) : 'All put away.');
  }, [say, step, sorters, sets]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) return;
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        go(index + 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        go(index - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, index]);

  async function finish() {
    await dismissStack(stack.id);
    void navigate({ to: '/intake' });
  }

  return (
    <div className={styles.page}>
      <div className={styles.progressRow}>
        <span className={styles.progressText}>
          {step ? `Step ${index + 1} of ${steps.length}` : 'Done'}
        </span>
        <button type="button" className={styles.link} onClick={() => void resetPutAway(stack.id)}>
          Start over
        </button>
      </div>
      <progress className={styles.progress} max={steps.length} value={index} />

      {step ? (
        <StepView step={step} sorters={sorters} sets={sets} onNext={() => go(index + 1)} />
      ) : (
        <section className={styles.done}>
          <h1 className={styles.instruction}>All put away</h1>
          <p className={styles.lead}>Every card in the stack is filed or set aside.</p>
        </section>
      )}
      <span className="visually-hidden" aria-live="polite">
        {step ? spoken(step, sorters, sets) : 'All put away.'}
      </span>

      <div className={styles.nav}>
        <button
          type="button"
          className={styles.back}
          disabled={index === 0}
          onClick={() => go(index - 1)}
        >
          Back
        </button>
        {step ? (
          <button type="button" className={styles.next} onClick={() => go(index + 1)}>
            Next
          </button>
        ) : (
          <button type="button" className={styles.next} onClick={() => void finish()}>
            Finish
          </button>
        )}
      </div>
    </div>
  );
}

function StepView({
  step,
  sorters,
  sets,
  onNext,
}: {
  step: PutAwayStep;
  sorters: number;
  sets: Map<SetKey, LoadedSet>;
  onNext: () => void;
}) {
  if (step.kind === 'scoop') {
    return (
      <section className={styles.scoop} aria-labelledby="step-title">
        <h1 id="step-title" className={styles.instruction}>
          Scoop up the piles
        </h1>
        <p className={styles.lead}>
          Pick up {pileName(0, sorters)} and put it on {pileName(1, sorters)}, pick both up and put
          them on {pileName(2, sorters)}, and so on, ending on {pileName(step.piles - 1, sorters)}.
          Don’t flip the stack over. Then keep going from the top.
        </p>
        <Sorters sorters={sorters} used={step.piles} />
      </section>
    );
  }

  const { card } = step;
  const set = sets.get(card.setKey);
  const name = set?.byNumber.get(card.base)?.Name ?? `${card.setKey} #${card.base}`;
  const art = (
    <button type="button" className={styles.artButton} onClick={onNext} aria-label="Next step">
      <img className={styles.art} src={artUrl(card.setKey, card.num)} alt="" />
    </button>
  );
  const cardLine = (
    <p className={styles.cardName}>
      {name}
      <span className={styles.cardMeta}>
        {card.setKey} · {variantLabel(card.variant)}
      </span>
    </p>
  );

  if (step.kind === 'deal') {
    const { sorter, cell } = pileCell(step.pile);
    return (
      <section className={styles.step} aria-labelledby="step-title">
        {art}
        <div className={styles.details}>
          {cardLine}
          <h1
            id="step-title"
            className={styles.pile}
            data-sorter={sorters > 1 ? sorter : undefined}
          >
            {sorters > 1 && <span className={styles.pileSorter}>{SORTER_NAMES[sorter]}</span>}
            <span className={styles.pileNumber}>{cell + 1}</span>
            <span className="visually-hidden">{pileName(step.pile, sorters)}</span>
          </h1>
          {step.aside && <p className={styles.note}>Set-aside pile — not for the binder</p>}
          <Sorters sorters={sorters} used={step.piles} target={step.pile} />
        </div>
      </section>
    );
  }

  if (step.kind === 'aside') {
    return (
      <section className={styles.step} aria-labelledby="step-title">
        {art}
        <div className={styles.details}>
          {cardLine}
          <h1 id="step-title" className={styles.instruction}>
            {ASIDE[step.reason].title}
          </h1>
          <p className={styles.lead}>{ASIDE[step.reason].detail}</p>
        </div>
      </section>
    );
  }

  const { spot, turnTo } = step;
  return (
    <section className={styles.step} aria-labelledby="step-title">
      {turnTo && (
        <p className={styles.turn} role="status">
          Open {setName(turnTo.setKey, sets)} to {pagesText(turnTo)}
        </p>
      )}
      {art}
      <div className={styles.details}>
        {cardLine}
        <h1 id="step-title" className={styles.instruction}>
          <span className={styles.spotSet}>{spot.setKey}</span> Page {spot.page}
          <span className={styles.spotRow}>
            Row {spot.row} · Column {spot.column}
          </span>
        </h1>
        <Pocket row={spot.row} column={spot.column} />
        {card.swapOut && (
          <p className={styles.swap}>
            Take out the {variantLabel(card.swapOut.variant)} copy first — it goes to bulk.
          </p>
        )}
      </div>
    </section>
  );
}

const ASIDE: Record<AsideReason, { title: string; detail: string }> = {
  bulk: { title: 'Bulk', detail: 'The binder already holds enough copies at least this good.' },
  spare: { title: 'Spare', detail: 'Kept as a spare: its pocket is full.' },
  unsure: {
    title: 'Check this card',
    detail: 'The scanner wasn’t sure what this was, and it was never added. Scan it again.',
  },
  hidden: { title: 'No binder', detail: 'This set is hidden from the binder.' },
};

/** A 3×3 grid per sorter in use, with the target pile lit. */
function Sorters({ sorters, used, target }: { sorters: number; used: number; target?: number }) {
  return (
    <div className={styles.sorters} aria-hidden="true">
      {Array.from({ length: sorters }, (_, s) => (
        <div key={s} className={styles.sorter} data-sorter={sorters > 1 ? s : undefined}>
          {Array.from({ length: PILES_PER_SORTER }, (_, c) => {
            const pile = s * PILES_PER_SORTER + c;
            return (
              <span
                key={c}
                className={styles.sorterCell}
                data-used={pile < used || undefined}
                data-target={pile === target || undefined}
              >
                {c + 1}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** A binder page's 3×4 pockets, with the card's pocket lit. */
function Pocket({ row, column }: { row: number; column: number }) {
  return (
    <div className={styles.pocket} aria-hidden="true">
      {Array.from({ length: 12 }, (_, i) => (
        <span
          key={i}
          className={styles.pocketCell}
          data-target={(Math.floor(i / 4) + 1 === row && (i % 4) + 1 === column) || undefined}
        />
      ))}
    </div>
  );
}

/** "Spark of Rebellion (SOR)"; `spokenName` drops the code, which is no use read aloud. */
function setName(setKey: SetKey, sets: Map<SetKey, LoadedSet>): string {
  const label = sets.get(setKey)?.label;
  if (!label || label === setKey) return setKey;
  return label.includes(`(${setKey})`) ? label : `${label} (${setKey})`;
}

function spokenName(setKey: SetKey, sets: Map<SetKey, LoadedSet>): string {
  return setName(setKey, sets).replace(` (${setKey})`, '');
}

function pagesText(ref: SpreadRef): string {
  return ref.pages.length === 1 ? `page ${ref.pages[0]}` : `pages ${ref.pages[0]}–${ref.pages[1]}`;
}

/** What is read aloud: the instruction first, then the card to check it against. */
function spoken(step: PutAwayStep, sorters: number, sets: Map<SetKey, LoadedSet>): string {
  if (step.kind === 'scoop') {
    return `Scoop up the piles, ${pileName(0, sorters)} through ${pileName(step.piles - 1, sorters)}.`;
  }
  const name = sets.get(step.card.setKey)?.byNumber.get(step.card.base)?.Name ?? '';
  if (step.kind === 'deal') return `${pileName(step.pile, sorters)}. ${name}`;
  if (step.kind === 'aside') return `${ASIDE[step.reason].title}. ${name}`;
  const { spot, turnTo } = step;
  const open = turnTo
    ? `Open ${spokenName(turnTo.setKey, sets)} to ${pagesText(turnTo).replace('–', ' and ')}. `
    : '';
  const swap = step.card.swapOut
    ? ` Take out the ${variantLabel(step.card.swapOut.variant)} copy.`
    : '';
  return `${open}Page ${spot.page}, row ${spot.row}, column ${spot.column}. ${name}.${swap}`;
}
