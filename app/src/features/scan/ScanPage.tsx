import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { db } from '~/data/db';
import { queuedPocket, queueScan, unqueueScan, type ScanReceipt } from '~/data/intake';
import { binderLayout } from '~/domain/binder';
import {
  artUrl,
  variantLabel,
  variantShortLabel,
  type LoadedSet,
  type VariantSlug,
} from '~/domain/catalog';
import { pocketRoom, quotaForCard, type PocketRoom } from '~/domain/ownership';
import type { Match } from '~/domain/scan/index';
import type { SetKey } from '~/domain/types';

import { guideRect, toScreen, type Rect, type View } from './capture';
import styles from './ScanPage.module.css';
import { useCamera } from './useCamera';
import { useScanIndex } from './useScanIndex';
import { useScanner, type ScanResult } from './useScanner';

type Mode = 'info' | 'add';

/**
 * How far ahead of every other card the winner must be (in score points) to be added
 * without asking. Below it, Add mode asks "Is this …?" instead of guessing. Set from the
 * index builder's robustness test.
 */
const CARD_MARGIN = 12;
/** Score gap under which the same card from two sets counts as indistinguishable. */
const REPRINT_GAP = 3;

export type Printing = { setKey: SetKey; base: number; num: string; variant: VariantSlug };

type Item = {
  id: number;
  result: ScanResult;
  /** What is recorded for this scan — the top match, or the user's correction. */
  chosen: Printing;
  /** Set while the scan is waiting for the user: unsure which card, or which set. */
  question: 'card' | 'set' | null;
  receipt: ScanReceipt | null;
  /**
   * Set when the card's binder pocket was already full, so nothing was queued: `full` (no
   * better than what is there — to bulk) or `upgrade` (better than the weakest copy:
   * waiting for the user to swap it in, add it as a spare, or not).
   */
  room: PocketRoom | null;
};

const cardKey = (p: { setKey: string; base: number }) => `${p.setKey}:${p.base}`;
const asPrinting = (m: Match): Printing => ({
  setKey: m.entry.setKey,
  base: m.entry.base,
  num: m.entry.num,
  variant: m.entry.variant as VariantSlug,
});

/** The best match per different card, best first — the "not this card?" alternatives. */
function cardsIn(matches: Match[]): Match[] {
  const seen = new Set<string>();
  return matches.filter((m) => {
    const key = cardKey(m.entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function ScanPage({ sets }: { sets: Map<SetKey, LoadedSet> }) {
  const camera = useCamera();
  const index = useScanIndex();
  const [mode, setMode] = useState<Mode>('add');
  const [items, setItems] = useState<Item[]>([]);
  const [view, setView] = useState<View | null>(null);
  const nextId = useRef(1);

  const nameOf = useCallback(
    (p: { setKey: string; base: number }) =>
      sets.get(p.setKey)?.byNumber.get(p.base)?.Name ?? `#${p.base}`,
    [sets],
  );

  /**
   * Queues a scanned printing if its binder pocket has room. When the pocket is full it
   * queues nothing and says why: the copy goes to bulk, or could swap out a weaker one.
   */
  const place = useCallback(
    async (printing: Printing): Promise<Pick<Item, 'receipt' | 'room'>> => {
      const card = sets.get(printing.setKey)?.byNumber.get(printing.base);
      if (card) {
        const quota = quotaForCard({ type: card.Type, maxCopies: card.MaxCopies });
        const pocket = await queuedPocket(printing.setKey, printing.base);
        const room = pocketRoom(pocket, quota, printing.variant);
        if (room.kind !== 'room') return { receipt: null, room };
      }
      return { receipt: await queueScan(printing), room: null };
    },
    [sets],
  );

  const onResult = useCallback(
    async (result: ScanResult) => {
      const [top] = result.matches;
      if (!top) return;
      const cards = cardsIn(result.matches);
      const runnerUp = cards[1];
      const reprint = cards.find(
        (m, i) =>
          i > 0 &&
          m.entry.setKey !== top.entry.setKey &&
          nameOf(m.entry) === nameOf(top.entry) &&
          m.score - top.score <= REPRINT_GAP,
      );
      const question: Item['question'] = reprint
        ? 'set'
        : runnerUp && runnerUp.score - top.score < CARD_MARGIN
          ? 'card'
          : null;

      const chosen = asPrinting(top);
      let placed: Pick<Item, 'receipt' | 'room'> = { receipt: null, room: null };
      if (mode === 'add' && !question) {
        placed = await place(chosen);
        // A short buzz for "added"; a double one for "look at the screen".
        navigator.vibrate?.(placed.room ? [60, 80, 60] : 40);
      }
      setItems((current) =>
        [{ id: nextId.current++, result, chosen, question, ...placed }, ...current].slice(0, 8),
      );
    },
    [mode, nameOf, place],
  );

  const scanning = camera.state === 'live' && Boolean(index.data);
  const { phase, rearm } = useScanner({
    videoRef: camera.videoRef,
    index: index.data,
    view,
    active: scanning,
    onResult: (r) => void onResult(r),
  });

  useEffect(() => rearm(), [mode, rearm]);

  /** Replace what a scan records — a different printing, or a different card entirely. */
  const choose = useCallback(
    async (item: Item, printing: Printing) => {
      let placed: Pick<Item, 'receipt' | 'room'> = { receipt: item.receipt, room: null };
      if (mode === 'add') {
        if (item.receipt) await unqueueScan(item.receipt);
        placed = await place(printing);
      }
      setItems((current) =>
        current.map((i) =>
          i.id === item.id ? { ...i, chosen: printing, question: null, ...placed } : i,
        ),
      );
    },
    [mode, place],
  );

  /** The answer to a full pocket: swap the weaker copy out, keep both, or add nothing. */
  const settleRoom = useCallback(
    async (item: Item, answer: 'swap' | 'spare' | 'none') => {
      const { chosen, room } = item;
      let receipt: ScanReceipt | null = null;
      if (answer === 'swap' && room?.kind === 'upgrade') {
        const weaker = sets
          .get(chosen.setKey)
          ?.printingsByBase.get(chosen.base)
          ?.find((p) => p.variant === room.replaces);
        receipt = await queueScan(
          chosen,
          weaker ? { swapOut: { ...chosen, num: weaker.num, variant: weaker.variant } } : {},
        );
      } else if (answer !== 'none') {
        receipt = await queueScan(chosen);
      }
      setItems((current) =>
        current.map((i) =>
          i.id === item.id
            ? { ...i, receipt, room: answer === 'none' ? { kind: 'full' } : null }
            : i,
        ),
      );
    },
    [sets],
  );

  const remove = useCallback(
    async (item: Item, again: boolean) => {
      if (item.receipt) await unqueueScan(item.receipt);
      setItems((current) => current.filter((i) => i.id !== item.id));
      if (again) rearm();
    },
    [rearm],
  );

  const latest = items[0];

  return (
    <div className={styles.page}>
      <div className={styles.controls}>
        <div className={styles.segmented} role="radiogroup" aria-label="Scan mode">
          {(
            [
              ['add', 'Add to Intake'],
              ['info', 'Look up'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              className={styles.segment}
              onClick={() => setMode(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {camera.torchAvailable && (
          <button
            type="button"
            className={styles.button}
            aria-pressed={camera.torchOn}
            onClick={() => void camera.toggleTorch()}
          >
            Light
          </button>
        )}
      </div>

      <Viewfinder
        camera={camera}
        indexState={index.isError ? 'error' : index.data ? 'ready' : 'loading'}
        phase={phase}
        onView={setView}
      />

      {latest && (
        <LatestScan
          item={latest}
          mode={mode}
          sets={sets}
          nameOf={nameOf}
          onChoose={(p) => void choose(latest, p)}
          onRescan={() => void remove(latest, true)}
          onConfirm={() => void choose(latest, latest.chosen)}
          onSettle={(answer) => void settleRoom(latest, answer)}
        />
      )}

      {items.length > 1 && (
        <section className={styles.history} aria-labelledby="scan-history">
          <h2 id="scan-history" className={styles.historyTitle}>
            Earlier scans
          </h2>
          <ul className={styles.historyList}>
            {items.slice(1).map((item) => (
              <li key={item.id} className={styles.historyItem}>
                <span>
                  {nameOf(item.chosen)}{' '}
                  <span className={styles.muted}>
                    {item.chosen.setKey} · {variantLabel(item.chosen.variant)}
                    {item.question && ' · not added'}
                  </span>
                </span>
                {item.receipt && (
                  <button
                    type="button"
                    className={styles.link}
                    onClick={() => void remove(item, false)}
                  >
                    Undo
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {mode === 'add' && (
        <p className={styles.footnote}>
          Scans wait in <Link to="/intake">Intake</Link> until you review them — check foils there,
          since the camera can't tell foil from non-foil.
        </p>
      )}
      <span className="visually-hidden" aria-live="polite">
        {latest ? `Scanned ${nameOf(latest.chosen)}` : ''}
      </span>
    </div>
  );
}

function Viewfinder({
  camera,
  indexState,
  phase,
  onView,
}: {
  camera: ReturnType<typeof useCamera>;
  indexState: 'loading' | 'ready' | 'error';
  phase: string;
  onView: (view: View) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [guide, setGuide] = useState<Rect | null>(null);

  // Keep the on-screen guide over exactly the region that gets captured.
  useLayoutEffect(() => {
    const update = () => {
      const video = camera.videoRef.current;
      const box = frameRef.current?.getBoundingClientRect();
      if (!video?.videoWidth || !box) return setGuide(null);
      const size = { width: video.videoWidth, height: video.videoHeight };
      const view = { width: box.width, height: box.height };
      onView(view);
      setGuide(toScreen(guideRect(size.width, size.height, view), size, box));
    };
    update();
    const video = camera.videoRef.current;
    video?.addEventListener('loadedmetadata', update);
    window.addEventListener('resize', update);
    return () => {
      video?.removeEventListener('loadedmetadata', update);
      window.removeEventListener('resize', update);
    };
  }, [camera.videoRef, camera.state, onView]);

  const hint =
    indexState === 'error'
      ? 'Card data could not be loaded — check your connection.'
      : indexState === 'loading'
        ? 'Loading card data…'
        : phase === 'moving'
          ? 'Hold a card inside the frame'
          : phase === 'steady'
            ? 'Hold still…'
            : phase === 'holding'
              ? 'Got it — next card'
              : phase === 'unknown'
                ? 'Can’t make out a card — keep it inside the frame, out of glare'
                : 'Hold a card inside the frame';

  return (
    <div className={styles.viewfinder} ref={frameRef}>
      <video ref={camera.videoRef} className={styles.video} playsInline muted />
      {camera.state === 'live' && guide && (
        <div
          className={styles.guide}
          data-phase={phase}
          style={{ left: guide.x, top: guide.y, width: guide.width, height: guide.height }}
        />
      )}
      {camera.state === 'live' ? (
        <p className={styles.hint}>{hint}</p>
      ) : (
        <div className={styles.cameraPrompt}>
          {camera.state === 'denied' ? (
            <p>
              Camera access was blocked. Allow it for this site in your browser settings, then try
              again.
            </p>
          ) : camera.state === 'unavailable' ? (
            <p>No camera available. Scanning needs a camera and a secure (https) page.</p>
          ) : camera.state === 'error' ? (
            <p>The camera could not be started.</p>
          ) : null}
          <button
            type="button"
            className={styles.primary}
            disabled={camera.state === 'starting'}
            onClick={() => void camera.start()}
          >
            {camera.state === 'starting' ? 'Starting…' : 'Start camera'}
          </button>
        </div>
      )}
    </div>
  );
}

function LatestScan({
  item,
  mode,
  sets,
  nameOf,
  onChoose,
  onRescan,
  onConfirm,
  onSettle,
}: {
  item: Item;
  mode: Mode;
  sets: Map<SetKey, LoadedSet>;
  nameOf: (p: { setKey: string; base: number }) => string;
  onChoose: (p: Printing) => void;
  onRescan: () => void;
  onConfirm: () => void;
  onSettle: (answer: 'swap' | 'spare' | 'none') => void;
}) {
  const [correcting, setCorrecting] = useState(false);
  const { chosen } = item;
  const [top] = item.result.matches;
  const fromBack = top?.entry.face === 'back' && top.entry.num === chosen.num;
  const set = sets.get(chosen.setKey);
  const card = set?.byNumber.get(chosen.base);
  const printings = set?.printingsByBase.get(chosen.base) ?? [];
  const alternatives = cardsIn(item.result.matches).filter(
    (m) => cardKey(m.entry) !== cardKey(chosen),
  );
  const reprints = alternatives.filter((m) => nameOf(m.entry) === nameOf(chosen));
  const position = binderLayout(chosen.base);
  const owned = useLiveQuery(
    async () =>
      (await db.owned.where({ setKey: chosen.setKey, base: chosen.base }).toArray()).reduce(
        (sum, r) => sum + r.count,
        0,
      ),
    [chosen.setKey, chosen.base],
  );

  return (
    <section
      className={styles.result}
      aria-labelledby="latest-scan"
      data-question={item.question ?? (item.room ? item.room.kind : undefined)}
    >
      <img className={styles.art} src={artUrl(chosen.setKey, chosen.num)} alt="" />
      <div className={styles.details}>
        <h2 id="latest-scan" className={styles.name}>
          {card?.Name ?? nameOf(chosen)}
          {card?.Subtitle && <span className={styles.subtitle}>{card.Subtitle}</span>}
        </h2>
        <p className={styles.meta}>
          {chosen.setKey} #{chosen.num} · {variantLabel(chosen.variant)}
          {fromBack && ' · read from the back'}
        </p>

        {item.question === 'set' ? (
          <div className={styles.question}>
            <p>This card looks the same in more than one set. Which is it?</p>
            <div className={styles.choices}>
              {[{ entry: chosen }, ...reprints.map((m) => ({ entry: asPrinting(m) }))].map(
                ({ entry }) => (
                  <button
                    key={cardKey(entry)}
                    type="button"
                    className={styles.button}
                    onClick={() => onChoose(entry)}
                  >
                    {entry.setKey}
                  </button>
                ),
              )}
            </div>
          </div>
        ) : item.question === 'card' ? (
          <div className={styles.question}>
            <p>Not sure — is this the right card?</p>
            <div className={styles.choices}>
              <button type="button" className={styles.primary} onClick={onConfirm}>
                {mode === 'add' ? 'Yes, add it' : 'Yes'}
              </button>
              <button type="button" className={styles.button} onClick={() => setCorrecting(true)}>
                No, show others
              </button>
            </div>
          </div>
        ) : mode === 'add' && item.room?.kind === 'full' ? (
          <div className={styles.question}>
            <p>
              Maximum count reached for <strong>{nameOf(chosen)}</strong> — add to bulk.
            </p>
            {!item.receipt && (
              <div className={styles.choices}>
                <button type="button" className={styles.button} onClick={() => onSettle('spare')}>
                  Add anyway, as a spare
                </button>
              </div>
            )}
          </div>
        ) : mode === 'add' && item.room?.kind === 'upgrade' ? (
          <div className={styles.question}>
            <p>
              Your binder already has a full set of <strong>{nameOf(chosen)}</strong>. This{' '}
              {variantLabel(chosen.variant)} beats your {variantLabel(item.room.replaces)}.
            </p>
            <div className={styles.choices}>
              <button type="button" className={styles.primary} onClick={() => onSettle('swap')}>
                Swap it in — {variantLabel(item.room.replaces)} to bulk
              </button>
              <button type="button" className={styles.button} onClick={() => onSettle('spare')}>
                Add as a spare
              </button>
              <button type="button" className={styles.button} onClick={() => onSettle('none')}>
                Don’t add
              </button>
            </div>
          </div>
        ) : mode === 'add' ? (
          <p className={styles.added}>
            {item.receipt?.swapLineId
              ? 'Added to Intake — swaps out the weaker copy'
              : 'Added to Intake'}
          </p>
        ) : (
          <p className={styles.meta}>
            You own {owned ?? '…'} · binder page {position.page}, row {position.row}, column{' '}
            {position.column} ·{' '}
            <Link
              to="/binder/$setKey"
              params={{ setKey: chosen.setKey }}
              search={{ card: chosen.base }}
            >
              Open in binder
            </Link>
          </p>
        )}

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.button}
            aria-expanded={correcting}
            onClick={() => setCorrecting((v) => !v)}
          >
            Correct
          </button>
          <button type="button" className={styles.button} onClick={onRescan}>
            Rescan
          </button>
        </div>

        {correcting && (
          <div className={styles.correct}>
            <p className={styles.correctLabel}>Printing</p>
            <div className={styles.choices} role="group" aria-label="Printing">
              {printings.map((p) => (
                <button
                  key={p.num}
                  type="button"
                  className={styles.chip}
                  aria-pressed={p.num === chosen.num}
                  title={`${variantLabel(p.variant)} · ${p.num}`}
                  onClick={() => {
                    onChoose({ ...chosen, num: p.num, variant: p.variant });
                    setCorrecting(false);
                  }}
                >
                  {variantShortLabel(p.variant)}
                </button>
              ))}
            </div>
            {alternatives.length > 0 && (
              <>
                <p className={styles.correctLabel}>Or a different card</p>
                <ul className={styles.alternatives}>
                  {alternatives.slice(0, 4).map((m) => (
                    <li key={cardKey(m.entry)}>
                      <button
                        type="button"
                        className={styles.alternative}
                        onClick={() => {
                          onChoose(asPrinting(m));
                          setCorrecting(false);
                        }}
                      >
                        <img src={artUrl(m.entry.setKey, m.entry.num)} alt="" />
                        <span>
                          {nameOf(m.entry)}
                          <span className={styles.muted}>
                            {m.entry.setKey} · {variantLabel(m.entry.variant as VariantSlug)}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
