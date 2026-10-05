import { Link, useNavigate } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useHiddenSets } from '~/data/binderSettings';
import { db, readMeta, writeMeta, type StackCardRow, type StackRow } from '~/data/db';
import { dismissStack, resetPutAway, setStep, stackCards, startPutAway } from '~/data/stacks';
import { pageSide } from '~/domain/binder';
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
import { speechSupported, useSpeech, useWakeLock } from './speech';

const SORTERS_KEY = 'putAway:sorters';
const SPEECH_KEY = 'putAway:speech';
const PACE_KEY = 'putAway:pace';
/** Seconds between a dealt card's instruction and the next one; other steps scale from it. */
const DEFAULT_PACE = 2;
const PACE_STEP = 0.5;
const MAX_PACE = 10;

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
  const pace = useLiveQuery(async () => {
    const saved = Number(await readMeta(db, PACE_KEY));
    return Number.isFinite(saved) && saved >= 0 ? Math.min(saved, MAX_PACE) : DEFAULT_PACE;
  }, []);

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
      pace={pace ?? DEFAULT_PACE}
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
      if (scanBatches.has(line.batchId)) total += line.count;
    });
    return total;
  }, [stack.closedAt]);
  const sorters = saved ?? 1;
  const toAdd = cards.filter((c) => c.fate !== 'unsure').length;
  const aside = cards.filter((c) => c.fate !== 'binder').length;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Put away {cards.length} cards</h1>
      <p className={styles.lead}>
        Keep the stack just as it came off the scanner, with the last card you scanned on top. The
        app tells you where each card goes: first onto a pile in your sorter, then into the binder.
        It reads each step aloud and moves on by itself; pause it any time.
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
  pace,
}: {
  stack: StackRow;
  sorters: number;
  cards: StackCardRow[];
  sets: Map<SetKey, LoadedSet>;
  hidden: Set<SetKey>;
  speech: boolean;
  pace: number;
}) {
  const navigate = useNavigate();
  const steps = useMemo(
    () =>
      // The last card scanned is on top of the stack, so it is the first one handled.
      planPutAway([...cards].reverse(), {
        setOrder: [...sets.keys()],
        hiddenSets: hidden,
        sorters,
      }),
    [cards, sets, hidden, sorters],
  );
  const index = Math.min(stack.step, steps.length);
  const step = steps[index];
  const text = step ? spoken(step, sorters, sets) : 'All put away.';
  const say = useSpeech(speech);
  const [playing, setPlaying] = useState(true);
  /** The step whose instruction has been read out: the pause before the next starts then. */
  const [readIndex, setReadIndex] = useState<number | null>(null);
  useWakeLock(playing && Boolean(step));

  const go = useCallback(
    (to: number) => {
      const next = Math.max(0, Math.min(steps.length, to));
      if (next === index) return;
      if (next > index) navigator.vibrate?.(30);
      void setStep(stack.id, next);
    },
    [index, stack.id, steps.length],
  );
  /** Stepping by hand pauses: otherwise the next step would come straight after. */
  const goByHand = (to: number) => {
    setPlaying(false);
    go(to);
  };

  // Read each step once, as it arrives.
  useEffect(() => {
    setReadIndex(null);
    return say(text, () => setReadIndex(index));
  }, [say, text, index]);

  // Then, while playing, give time to do it and move on.
  useEffect(() => {
    if (!playing || !step || readIndex !== index) return;
    const timer = window.setTimeout(() => go(index + 1), stepPause(step, pace) * 1000);
    return () => window.clearTimeout(timer);
  }, [playing, step, readIndex, index, pace, go]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setPlaying(false);
        go(index + 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setPlaying(false);
        go(index - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, index]);

  const setPace = (seconds: number) =>
    void writeMeta(db, PACE_KEY, String(Math.max(PACE_STEP, Math.min(MAX_PACE, seconds))));

  async function finish() {
    await dismissStack(stack.id);
    void navigate({ to: '/intake' });
  }

  return (
    <div className={styles.page}>
      <div className={styles.progressRow}>
        <span className={styles.progressText}>
          {step ? `Step ${index + 1} of ${steps.length}` : 'Done'}
          {step && !playing && <span className={styles.paused}> · Paused</span>}
        </span>
        <button type="button" className={styles.link} onClick={() => void resetPutAway(stack.id)}>
          Start over
        </button>
      </div>
      <progress className={styles.progress} max={steps.length} value={index} />

      {step ? (
        <StepView
          step={step}
          sorters={sorters}
          sets={sets}
          playing={playing}
          onToggle={() => setPlaying((p) => !p)}
        />
      ) : (
        <section className={styles.done}>
          <h1 className={styles.instruction}>All put away</h1>
          <p className={styles.lead}>Every card in the stack is filed or set aside.</p>
        </section>
      )}
      {!speech && (
        <span className="visually-hidden" aria-live="polite">
          {text}
        </span>
      )}

      {step ? (
        <div className={styles.nav}>
          <button
            type="button"
            className={styles.back}
            disabled={index === 0}
            onClick={() => goByHand(index - 1)}
          >
            Back
          </button>
          <button
            type="button"
            className={styles.next}
            aria-pressed={!playing}
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? 'Pause' : 'Resume'}
          </button>
          <button type="button" className={styles.back} onClick={() => goByHand(index + 1)}>
            Next
          </button>
        </div>
      ) : (
        <div className={styles.navDone}>
          <button type="button" className={styles.back} onClick={() => goByHand(index - 1)}>
            Back
          </button>
          <button type="button" className={styles.next} onClick={() => void finish()}>
            Finish
          </button>
        </div>
      )}

      {step && (
        <div className={styles.pace} role="group" aria-label="Pace">
          <span>Time to do each step: {pace}s</span>
          <button
            type="button"
            className={styles.paceButton}
            disabled={pace <= PACE_STEP}
            onClick={() => setPace(pace - PACE_STEP)}
          >
            Faster
          </button>
          <button
            type="button"
            className={styles.paceButton}
            disabled={pace >= MAX_PACE}
            onClick={() => setPace(pace + PACE_STEP)}
          >
            Slower
          </button>
        </div>
      )}
    </div>
  );
}

function StepView({
  step,
  sorters,
  sets,
  playing,
  onToggle,
}: {
  step: PutAwayStep;
  sorters: number;
  sets: Map<SetKey, LoadedSet>;
  playing: boolean;
  onToggle: () => void;
}) {
  if (step.kind === 'scoop') {
    return (
      <section className={styles.scoop} aria-labelledby="step-title">
        <h1 id="step-title" className={styles.instruction}>
          Scoop up the piles
        </h1>
        <p className={styles.lead}>{scoopText(step.piles, sorters)}</p>
        <Sorters sorters={sorters} used={step.piles} />
      </section>
    );
  }

  const { card } = step;
  const set = sets.get(card.setKey);
  const name = set?.byNumber.get(card.base)?.Name ?? `${card.setKey} #${card.base}`;
  const art = (
    <button
      type="button"
      className={styles.artButton}
      onClick={onToggle}
      // A big tap target for pausing; the Pause button below is the accessible one.
      tabIndex={-1}
      aria-hidden="true"
      title={playing ? 'Tap to pause' : 'Tap to resume'}
    >
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
          <span className={styles.spotSet}>
            {spot.setKey} · Page {spot.page}
          </span>
          {SIDE[pageSide(spot.page)]} page
          <span className={styles.spotRow}>
            Row {spot.row} · Column {spot.column}
          </span>
        </h1>
        <Pocket page={spot.page} row={spot.row} column={spot.column} />
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
  bulk: { title: 'Bulk', detail: 'Its pocket already holds enough copies at least this good.' },
  unsure: {
    title: 'Check this card',
    detail: 'The scanner wasn’t sure what this was, and it was never added. Scan it again.',
  },
  hidden: { title: 'No binder', detail: 'This set is hidden from the binder.' },
  replaced: {
    title: 'Bulk',
    detail: 'A better printing of this card, scanned later, takes its place in the pocket.',
  },
};

/**
 * Seconds to do a step before the next is read: dealing is quick, filing means finding the
 * pocket, and scooping up the piles takes longest.
 */
function stepPause(step: PutAwayStep, pace: number): number {
  if (step.kind === 'scoop') return pace * 4;
  if (step.kind === 'file') return pace * 2 + (step.turnTo ? pace * 2 : 0);
  return pace;
}

function scoopText(piles: number, sorters: number): string {
  if (piles < 2) return 'Pick up the pile. Don’t flip it over. Then keep going from the top.';
  const first = pileName(0, sorters);
  const second = pileName(1, sorters);
  const last = pileName(piles - 1, sorters);
  const middle =
    piles > 2
      ? `, pick both up and put them on ${pileName(2, sorters)}, and so on, ending on ${last}`
      : '';
  return `Pick up ${first} and put it on ${second}${middle}. Don’t flip the stack over. Then keep going from the top.`;
}

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

const SIDE = { left: 'Left', right: 'Right' } as const;

/**
 * The open spread's two pages of 3×4 pockets, with the card's page outlined and its pocket
 * lit. Page 1 has the inside cover, not a page, to its left.
 */
function Pocket({ page, row, column }: { page: number; row: number; column: number }) {
  const side = pageSide(page);
  return (
    <div className={styles.spread} aria-hidden="true">
      {(['left', 'right'] as const).map((s) =>
        s === 'left' && page === 1 ? (
          <div key={s} className={styles.cover} />
        ) : (
          <div key={s} className={styles.pocket} data-target={s === side || undefined}>
            {Array.from({ length: 12 }, (_, i) => (
              <span
                key={i}
                className={styles.pocketCell}
                data-target={
                  (s === side && Math.floor(i / 4) + 1 === row && (i % 4) + 1 === column) ||
                  undefined
                }
              />
            ))}
          </div>
        ),
      )}
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
  // Once the binder is open, the side of the spread is easier to find than the page number.
  return `${open}${SIDE[pageSide(spot.page)]} page, row ${spot.row}, column ${spot.column}. ${name}.${swap}`;
}
