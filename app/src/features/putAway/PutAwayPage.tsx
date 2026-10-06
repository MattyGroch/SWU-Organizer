import { Link, useNavigate } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useHiddenSets } from '~/data/binderSettings';
import { db, readMeta, writeMeta, type StackCardRow, type StackRow } from '~/data/db';
import { unqueuePrinting } from '~/data/intake';
import {
  addMissedCopy,
  dismissStack,
  pullCard,
  resetPutAway,
  setStep,
  stackCards,
  startPutAway,
} from '~/data/stacks';
import { pageSide } from '~/domain/binder';
import { artUrl, variantLabel, type LoadedSet } from '~/domain/catalog';
import {
  PILES_PER_SORTER,
  pileCell,
  pileName,
  planPutAway,
  SORTER_NAMES,
  type AsideReason,
  type LeftoverCard,
  type PutAwayStep,
  type SpreadRef,
  type StackCardInput,
} from '~/domain/putAway';
import type { SetKey } from '~/domain/types';
import { stackEntry, usePlaceScan, type Printing } from '~/features/scan/usePlaceScan';
import { useToast } from '~/ui/toastContext';

import { FixCardSheet } from './FixCardSheet';
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
  const steps = useMemo(() => {
    // The plan comes from the stack as it was at the start; cards changed since then are
    // to one side, filed at the end.
    const planned = stack.plan ?? cards;
    const pulls = stack.pulls ?? [];
    const pulled = new Set(pulls.map((p) => p.id));
    const inPlan = new Set(planned.map((c) => c.id));
    // The last card scanned is on top of the stack, so it is the first one handled.
    return planPutAway([...planned].reverse(), {
      setOrder: [...sets.keys()],
      hiddenSets: hidden,
      sorters,
      pulls,
      toOneSide: cards.filter((c) => pulled.has(c.id) || !inPlan.has(c.id)),
    });
  }, [stack.plan, stack.pulls, cards, sets, hidden, sorters]);
  const index = Math.min(stack.step, steps.length);
  const step = steps[index];
  const text = step ? spoken(step, sorters, sets) : 'All put away.';
  const say = useSpeech(speech);
  const [playing, setPlaying] = useState(true);
  /** The step whose instruction has been read out: the pause before the next starts then. */
  const [readIndex, setReadIndex] = useState<number | null>(null);
  const [fixing, setFixing] = useState<StackCardInput | null>(null);
  useWakeLock(playing && Boolean(step));
  const place = usePlaceScan(sets);
  const showToast = useToast();

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

  // Then, while playing, give time to do it and move on — except from the leftover list,
  // which waits while you check it.
  useEffect(() => {
    if (!playing || !step || step.kind === 'bulk' || readIndex !== index) return;
    const timer = window.setTimeout(() => go(index + 1), stepPause(step, pace) * 1000);
    return () => window.clearTimeout(timer);
  }, [playing, step, readIndex, index, pace, go]);

  useEffect(() => {
    if (fixing) return;
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
  }, [go, index, fixing]);

  const setPace = (seconds: number) =>
    void writeMeta(db, PACE_KEY, String(Math.max(PACE_STEP, Math.min(MAX_PACE, seconds))));

  async function finish() {
    await dismissStack(stack.id);
    void navigate({ to: '/intake' });
  }

  const openFix = (card: StackCardInput) => {
    setPlaying(false);
    setFixing(card);
  };

  /** Each fix changes Intake first, then takes the card out of the plan at this step. */
  const fixed = (fix: () => Promise<string>) =>
    void fix()
      .then((message) => showToast({ tone: 'info', message }))
      .catch((error: unknown) =>
        showToast({
          tone: 'danger',
          message: `Couldn’t fix that card: ${error instanceof Error ? error.message : String(error)}`,
        }),
      );
  const entryFor = async (printing: Printing) => {
    const { room } = await place(printing);
    return stackEntry({ chosen: printing, question: null, room }, sets.get(printing.setKey));
  };
  const fixes = (card: StackCardInput) => ({
    onCorrect: (printing: Printing) =>
      fixed(async () => {
        if (card.fate !== 'unsure') await unqueuePrinting(card);
        const entry = await entryFor(printing);
        await pullCard(stack.id, card.id, index, entry);
        return entry.fate === 'binder'
          ? 'Put it to one side: it’s filed at the end.'
          : 'Put it to one side: it goes to bulk at the end.';
      }),
    onMissedCopy: () =>
      fixed(async () => {
        const { setKey, base, num, variant } = card;
        await addMissedCopy(stack.id, await entryFor({ setKey, base, num, variant }));
        return 'Added to Intake. Put the extra copy to one side: it’s handled at the end.';
      }),
    onRemove: () =>
      fixed(async () => {
        if (card.fate !== 'unsure') await unqueuePrinting(card);
        await pullCard(stack.id, card.id, index, null);
        return 'Removed from the stack and from Intake.';
      }),
  });

  return (
    <div className={styles.page}>
      <div className={styles.progressRow}>
        <span className={styles.progressText}>
          {step ? `Step ${index + 1} of ${steps.length}` : 'Done'}
          {step && !playing && step.kind !== 'bulk' && (
            <span className={styles.paused}> · Paused</span>
          )}
        </span>
        <span className={styles.progressLinks}>
          {speechSupported() && (
            <button
              type="button"
              className={styles.link}
              aria-pressed={speech}
              onClick={() => void writeMeta(db, SPEECH_KEY, speech ? 'off' : 'on')}
            >
              Read aloud: {speech ? 'on' : 'off'}
            </button>
          )}
          <button type="button" className={styles.link} onClick={() => void resetPutAway(stack.id)}>
            Start over
          </button>
        </span>
      </div>
      <progress className={styles.progress} max={steps.length} value={index} />

      {step ? (
        <StepView
          step={step}
          sorters={sorters}
          sets={sets}
          playing={playing}
          onToggle={() => setPlaying((p) => !p)}
          onFix={openFix}
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

      {step?.kind === 'bulk' ? (
        <div className={styles.navDone}>
          <button type="button" className={styles.back} onClick={() => goByHand(index - 1)}>
            Back
          </button>
          <button type="button" className={styles.next} onClick={() => goByHand(index + 1)}>
            Done
          </button>
        </div>
      ) : step ? (
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

      {fixing && (
        <FixCardSheet
          card={fixing}
          sets={sets}
          onClose={() => setFixing(null)}
          {...fixes(fixing)}
        />
      )}

      {step && step.kind !== 'bulk' && (
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
  onFix,
}: {
  step: PutAwayStep;
  sorters: number;
  sets: Map<SetKey, LoadedSet>;
  playing: boolean;
  onToggle: () => void;
  onFix: (card: StackCardInput) => void;
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

  if (step.kind === 'bulk') return <Leftovers cards={step.cards} sets={sets} onFix={onFix} />;

  const { card } = step;
  const name = cardName(card, sets);
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
    <>
      <p className={styles.cardName}>
        {name}
        <span className={styles.cardMeta}>
          {card.setKey} · {variantLabel(card.variant)}
        </span>
      </p>
      <button type="button" className={styles.fixButton} onClick={() => onFix(card)}>
        Wrong card?
      </button>
    </>
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

  const { spot, turnTo } = step;
  return (
    <section className={styles.step} aria-labelledby="step-title">
      {step.fromSide && <p className={styles.sideNote}>From the cards you put to one side</p>}
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

/** What the leftover list says about a card that isn't plain bulk. */
const LEFTOVER_TAG: Partial<Record<AsideReason, string>> = {
  unsure: 'Check this card: the scanner wasn’t sure, so it was never added',
  hidden: 'No binder: its set is hidden',
  replaced: 'A better printing took its pocket',
};

/**
 * The last step: everything still in hand, for the bulk box, in order from the top so it
 * can be checked card by card. Then anything put to one side that goes there too.
 */
function Leftovers({
  cards,
  sets,
  onFix,
}: {
  cards: LeftoverCard[];
  sets: Map<SetKey, LoadedSet>;
  onFix: (card: StackCardInput) => void;
}) {
  const inHand = cards.filter((l) => !l.fromSide);
  const fromSide = cards.filter((l) => l.fromSide);
  const list = (items: LeftoverCard[]) => (
    <ol className={styles.leftovers}>
      {items.map(({ card, reason }) => (
        <li key={card.id} className={styles.leftover}>
          <img className={styles.leftoverArt} src={artUrl(card.setKey, card.num)} alt="" />
          <span className={styles.leftoverText}>
            <span className={styles.leftoverName}>{cardName(card, sets)}</span>
            <span className={styles.cardMeta}>
              {card.setKey} · {variantLabel(card.variant)}
            </span>
            {LEFTOVER_TAG[reason] && (
              <span className={styles.leftoverTag}>{LEFTOVER_TAG[reason]}</span>
            )}
          </span>
          <button type="button" className={styles.fixButton} onClick={() => onFix(card)}>
            Wrong card?
          </button>
        </li>
      ))}
    </ol>
  );
  return (
    <section className={styles.done} aria-labelledby="step-title">
      <h1 id="step-title" className={styles.leftoverTitle}>
        {leftoverText(cards)}
      </h1>
      {inHand.length > 0 && (
        <>
          <p className={styles.lead}>Check them against this list, top of the stack first.</p>
          {list(inHand)}
        </>
      )}
      {fromSide.length > 0 && (
        <>
          <h2 className={styles.legend}>From the cards you put to one side</h2>
          {list(fromSide)}
        </>
      )}
    </section>
  );
}

function leftoverText(cards: readonly LeftoverCard[]): string {
  return cards.length === 1
    ? 'The last card is to be deposited into bulk.'
    : `The remaining ${cards.length} cards are to be deposited into bulk.`;
}

function cardName(card: StackCardInput, sets: Map<SetKey, LoadedSet>): string {
  return sets.get(card.setKey)?.byNumber.get(card.base)?.Name ?? `${card.setKey} #${card.base}`;
}

/**
 * Seconds to do a step before the next is read: dealing is quick, filing means finding the
 * pocket, and scooping up the piles takes longest.
 */
function stepPause(step: PutAwayStep, pace: number): number {
  if (step.kind === 'scoop') return pace * 4;
  if (step.kind === 'bulk') return 0;
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
  if (step.kind === 'bulk') {
    const unsure = step.cards.filter((l) => l.reason === 'unsure').length;
    const check = unsure
      ? ` ${unsure === 1 ? 'One needs' : `${unsure} need`} checking first: see the list.`
      : '';
    return `${leftoverText(step.cards)}${check}`;
  }
  const name = sets.get(step.card.setKey)?.byNumber.get(step.card.base)?.Name ?? '';
  if (step.kind === 'deal') return `${pileName(step.pile, sorters)}. ${name}`;
  const { spot, turnTo } = step;
  const side = step.fromSide ? 'From the cards to one side. ' : '';
  const open = turnTo
    ? `Open ${spokenName(turnTo.setKey, sets)} to ${pagesText(turnTo).replace('–', ' and ')}. `
    : '';
  const swap = step.card.swapOut
    ? ` Take out the ${variantLabel(step.card.swapOut.variant)} copy.`
    : '';
  // Once the binder is open, the side of the spread is easier to find than the page number.
  return `${side}${open}${SIDE[pageSide(spot.page)]} page, row ${spot.row}, column ${spot.column}. ${name}.${swap}`;
}
