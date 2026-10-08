import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { DEFAULT_HIDDEN_SETS, useHiddenSets } from '~/data/binderSettings';
import { db } from '~/data/db';
import { queueScan, sourcePrinting, unqueueScan, type ScanReceipt } from '~/data/intake';
import { quickAdd, undoQuickAdd, type QuickAdded } from '~/data/quickAdd';
import { dropScan, logScan, updateScan } from '~/data/stacks';
import { binderLayout, pageSide } from '~/domain/binder';
import {
  artNumber,
  artUrl,
  toSearchCatalog,
  finishCounterpart,
  variantAxes,
  variantLabel,
  variantShortLabel,
  type LoadedSet,
  type VariantSlug,
} from '~/domain/catalog';
import { quotaForCard, type PocketRoom } from '~/domain/ownership';
import { cardLead, type Match, type ScanEntry as IndexEntry } from '~/domain/scan/index';
import type { SearchSuggestion } from '~/domain/search';
import type { SetKey } from '~/domain/types';
import { Pocket } from '~/features/putAway/Pocket';
import { CardSearch } from '~/features/search/CardSearch';
import { useToast } from '~/ui/toastContext';

import { guideRect, toScreen, type Rect, type View } from './capture';
import styles from './ScanPage.module.css';
import { useCamera } from './useCamera';
import { stackEntry, usePlaceScan, type Printing } from './usePlaceScan';
import { useScanIndex } from './useScanIndex';
import { useScanner, type ScanResult } from './useScanner';

/**
 * `add` (Bulk Scan) queues loose cards for the binder; `deck` (Deck Scan) queues a built
 * deck, kept apart in its own batch with no stack to put away; `info` (Quick Scan) looks
 * cards up, and adds one straight to the collection with no Intake, saying where it goes —
 * for a single booster.
 */
type Mode = 'info' | 'add' | 'deck';

const MODES: readonly Mode[] = ['info', 'add', 'deck'];

const MODE_LABEL: Record<Mode, string> = {
  info: 'Quick Scan',
  add: 'Bulk Scan',
  deck: 'Deck Scan',
};

/**
 * How far ahead of every other card the winner must be (in score points) to be added
 * without asking. Below it, Add mode asks "Is this …?" instead of guessing. Set from the
 * index builder's robustness test.
 */
const CARD_MARGIN = 12;
/**
 * Score gap under which the same card from two sets counts as indistinguishable, when the
 * index doesn't already say they are (`ScanResult.twins`).
 */
const REPRINT_GAP = 3;

type Item = {
  id: number;
  result: ScanResult;
  /** What is recorded for this scan — the top match, or the user's correction. */
  chosen: Printing;
  /** Set while the scan is waiting for the user: unsure which card, or which set. */
  question: 'card' | 'set' | null;
  receipt: ScanReceipt | null;
  /**
   * Set when the card's binder pocket was already full: `full` (no better than what is
   * there — it goes to the bulk box) or `upgrade` (better than the weakest copy, which
   * goes to the bulk box instead). Either way the copy is queued; committing the batch
   * moves the extra copy to bulk.
   */
  room: PocketRoom | null;
  /** This scan's card in the scanned stack (Add mode), so putting away knows its place. */
  stackCardId: string | null;
  /** Look up mode: added straight to the collection, and where it goes. */
  added: QuickAdded | null;
};

const cardKey = (p: { setKey: string; base: number }) => `${p.setKey}:${p.base}`;
const asPrinting = ({ entry }: { entry: IndexEntry }): Printing => ({
  setKey: entry.setKey,
  base: entry.base,
  num: entry.num,
  variant: entry.variant as VariantSlug,
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
  /** Remembered on the device, like Foils: a booster opener goes back to Look up. */
  const [mode, setMode] = useState<Mode>(() => {
    try {
      const saved = localStorage.getItem('scan.mode');
      return MODES.find((m) => m === saved) ?? 'add';
    } catch {
      return 'add';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('scan.mode', mode);
    } catch {
      // private mode: the setting lasts for this visit
    }
  }, [mode]);
  /**
   * Foils mode: every scan is recorded on foil stock, for running a stack of foils
   * through. The camera can't tell foil, so this is the user's say — remembered on the
   * device.
   */
  const [foils, setFoils] = useState(() => {
    try {
      return localStorage.getItem('scan.foils') === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('scan.foils', foils ? '1' : '0');
    } catch {
      // private mode: the setting lasts for this visit
    }
  }, [foils]);
  const foilsRef = useRef(foils);
  // Only Bulk Scan has the switch; elsewhere each card's printing is set on its own.
  foilsRef.current = foils && mode === 'add';
  const [items, setItems] = useState<Item[]>([]);
  /** The latest items, for the scanner's callback (which outlives a render). */
  const itemsRef = useRef(items);
  itemsRef.current = items;
  /**
   * Set by Rescan: the newest scan was taken back, so nothing shows as the latest until the
   * next read — the scan before it stays in the history rather than taking its place.
   */
  const [cleared, setCleared] = useState(false);
  const clearedRef = useRef(cleared);
  clearedRef.current = cleared;
  const showToast = useToast();
  /** Never fail silently: a scan that cannot be saved says so. */
  const failed = useCallback(
    (error: unknown) => {
      console.error('Scan action failed', error);
      showToast({
        tone: 'danger',
        message: `Couldn’t save that scan: ${error instanceof Error ? error.message : String(error)}`,
      });
    },
    [showToast],
  );
  const [view, setView] = useState<View | null>(null);
  const nextId = useRef(1);
  /**
   * The read being saved right now. The scanner doesn't wait for one read to be saved
   * before sending the next, and `items` only shows a read once it is saved and rendered:
   * until then, this is the latest card.
   */
  const pendingRef = useRef<Pick<Item, 'id' | 'result' | 'chosen' | 'question'> | null>(null);

  const nameOf = useCallback(
    (p: { setKey: string; base: number }) =>
      sets.get(p.setKey)?.byNumber.get(p.base)?.Name ?? `#${p.base}`,
    [sets],
  );
  /** The same card in another set: same name and subtitle. */
  const sameCard = useCallback(
    (a: { setKey: string; base: number }, b: { setKey: string; base: number }) => {
      const x = sets.get(a.setKey)?.byNumber.get(a.base);
      const y = sets.get(b.setKey)?.byNumber.get(b.base);
      return Boolean(x && y && x.Name === y.Name && (x.Subtitle ?? '') === (y.Subtitle ?? ''));
    },
    [sets],
  );

  /** How many copies of the card the binder holds: a playset, or one leader or base. */
  const quotaOf = useCallback(
    (p: { setKey: string; base: number }) => {
      const card = sets.get(p.setKey)?.byNumber.get(p.base);
      return card ? quotaForCard({ type: card.Type, maxCopies: card.MaxCopies }) : Infinity;
    },
    [sets],
  );

  const placeLoose = usePlaceScan(sets);
  /** Queues a scan for the mode it was made in. A deck's copies have no pocket to mind. */
  const place = useCallback(
    async (printing: Printing): Promise<Pick<Item, 'receipt' | 'room'>> =>
      mode === 'deck'
        ? { receipt: await queueScan(printing, { kind: 'deckScan' }), room: null }
        : placeLoose(printing),
    [mode, placeLoose],
  );
  const queuing = mode !== 'info';

  /** The printing as recorded: its foil counterpart in Foils mode, where one exists. */
  const asFound = useCallback(
    (printing: Printing): Printing => {
      if (!foilsRef.current || variantAxes(printing.variant).finish !== 'plain') return printing;
      const printings = sets.get(printing.setKey)?.printingsByBase.get(printing.base) ?? [];
      const foil = finishCounterpart(printings, printing.variant);
      return foil ? { ...printing, num: foil.num, variant: foil.variant } : printing;
    },
    [sets],
  );

  const onResult = useCallback(
    async (result: ScanResult) => {
      const [top] = result.matches;
      if (!top) return;
      const pending = pendingRef.current;
      const latest =
        pending && !itemsRef.current.some((i) => i.id === pending.id)
          ? pending
          : clearedRef.current
            ? undefined
            : itemsRef.current[0];
      // A question waits for its answer: the scanner is paused for it, and a read already
      // under way when it opened must not replace it either.
      if (latest?.question) return;
      // The same card again with no gap since — it was never lifted — is that card re-read
      // (refocusing, re-exposing), not a second copy: leave its result as it is.
      const latestTop = latest?.result.matches[0];
      if (
        !result.afterGap &&
        latest &&
        (cardKey(latest.chosen) === cardKey(top.entry) ||
          (latestTop && cardKey(latestTop.entry) === cardKey(top.entry)))
      ) {
        return;
      }
      const cards = cardsIn(result.matches);
      const runnerUp = cards[1];
      // Card-level confidence on stage-1 scores only (see cardLead).
      const topCardScore = Math.min(
        ...result.matches
          .filter((m) => cardKey(m.entry) === cardKey(top.entry))
          .map((m) => m.cardScore),
      );
      // The same art in another set: the index knows its twins, whatever this read was like.
      const reprint =
        (result.twins ?? []).some((t) => sameCard(t, top.entry)) ||
        cards.some(
          (m, i) =>
            i > 0 &&
            m.entry.setKey !== top.entry.setKey &&
            nameOf(m.entry) === nameOf(top.entry) &&
            m.cardScore - topCardScore <= REPRINT_GAP,
        );
      const question: Item['question'] = reprint
        ? 'set'
        : runnerUp && cardLead(result.matches) < CARD_MARGIN
          ? 'card'
          : null;

      const chosen = asFound(asPrinting(top));
      const id = nextId.current++;
      pendingRef.current = { id, result, chosen, question };
      let placed: Pick<Item, 'receipt' | 'room'> = { receipt: null, room: null };
      let stackCardId: string | null = null;
      try {
        if (queuing && !question) {
          placed = await place(chosen);
          // Added, wherever it ends up: binder or bulk is put-away's business, not the scan's.
          navigator.vibrate?.(40);
        }
        if (mode === 'add') {
          // Logged even while unsure: the card is in the stack either way.
          stackCardId = await logScan(
            stackEntry({ chosen, question, ...placed }, sets.get(chosen.setKey)),
          );
        }
      } catch (error) {
        // Never shown, so it must not stand in for the latest card either.
        if (pendingRef.current?.id === id) pendingRef.current = null;
        throw error;
      }
      setCleared(false);
      setItems((current) =>
        [{ id, result, chosen, question, ...placed, stackCardId, added: null }, ...current].slice(
          0,
          8,
        ),
      );
    },
    [asFound, mode, nameOf, place, queuing, sameCard, sets],
  );

  const latest = cleared ? undefined : items[0];
  /** An open question pauses scanning, and freezes the picture, until it is answered. */
  const asking = Boolean(latest?.question);
  const scanning = camera.state === 'live' && Boolean(index.data);
  const { phase, rearm, resume, retry } = useScanner({
    videoRef: camera.videoRef,
    index: index.data,
    view,
    active: scanning && !asking,
    onResult: (r) => void onResult(r).catch(failed),
  });

  /**
   * A card the scanner gave up on, found by title or number instead: recorded like a
   * scan of its plainest printing (Correct changes it), minding the binder pocket the same
   * way. Then scanning carries on with the next card.
   */
  const lookUp = useCallback(
    async (suggestion: SearchSuggestion) => {
      const printings = sets.get(suggestion.setKey)?.printingsByBase.get(suggestion.baseNumber);
      const printing = sourcePrinting(printings ?? []);
      if (!printing) return;
      const chosen = asFound({
        setKey: suggestion.setKey,
        base: suggestion.baseNumber,
        num: printing.num,
        variant: printing.variant,
      });
      const placed: Pick<Item, 'receipt' | 'room'> = queuing
        ? await place(chosen)
        : { receipt: null, room: null };
      // Found by search, but still a card in the stack: it keeps its place like any scan.
      const stackCardId =
        mode === 'add'
          ? await logScan(
              stackEntry({ chosen, question: null, ...placed }, sets.get(chosen.setKey)),
            )
          : null;
      setCleared(false);
      setItems((current) =>
        [
          {
            id: nextId.current++,
            result: { matches: [], at: Date.now(), afterGap: true, tooClose: false },
            chosen,
            question: null,
            ...placed,
            stackCardId,
            added: null,
          },
          ...current,
        ].slice(0, 8),
      );
      resume();
    },
    [asFound, mode, place, queuing, resume, sets],
  );

  useEffect(() => rearm(), [mode, rearm]);

  useEffect(() => {
    const video = camera.videoRef.current;
    if (!video || camera.state !== 'live') return;
    if (asking) video.pause();
    else if (video.paused) void Promise.resolve(video.play()).catch(() => {});
  }, [asking, camera.state, camera.videoRef]);

  /** Replace what a scan records — a different printing, or a different card entirely. */
  const choose = useCallback(
    async (item: Item, picked: Printing) => {
      // Answering a question picks the card; Foils mode still decides the stock.
      const printing = item.question ? asFound(picked) : picked;
      let placed: Pick<Item, 'receipt' | 'room'> = { receipt: item.receipt, room: null };
      if (queuing) {
        if (item.receipt) await unqueueScan(item.receipt);
        placed = await place(printing);
      }
      // Already in the collection: the corrected printing takes its place there.
      let added = item.added;
      if (added) {
        await undoQuickAdd(added);
        added = await quickAdd(printing, quotaOf(printing));
      }
      // The screen first, as soon as Intake has it; the stack is brought into line after.
      setItems((current) =>
        current.map((i) =>
          i.id === item.id ? { ...i, chosen: printing, question: null, ...placed, added } : i,
        ),
      );
      if (mode !== 'add') return;
      const entry = stackEntry(
        { chosen: printing, question: null, ...placed },
        sets.get(printing.setKey),
      );
      if (item.stackCardId) {
        await updateScan(item.stackCardId, entry);
      } else {
        const stackCardId = await logScan(entry);
        setItems((current) => current.map((i) => (i.id === item.id ? { ...i, stackCardId } : i)));
      }
    },
    [asFound, mode, place, queuing, quotaOf, sets],
  );

  /** Look up mode: the scan, as it stands, straight into the collection. */
  const addNow = useCallback(
    async (item: Item) => {
      if (item.added || item.question) return;
      const added = await quickAdd(item.chosen, quotaOf(item.chosen));
      navigator.vibrate?.(40);
      setItems((current) => current.map((i) => (i.id === item.id ? { ...i, added } : i)));
    },
    [quotaOf],
  );

  /** The latest scan on the other stock — one tap instead of the Correct menu. */
  const foilToggle = (item: Item) => {
    const printings = sets.get(item.chosen.setKey)?.printingsByBase.get(item.chosen.base) ?? [];
    const other = finishCounterpart(printings, item.chosen.variant);
    if (!other || item.question) return undefined;
    return () =>
      void choose(item, { ...item.chosen, num: other.num, variant: other.variant }).catch(failed);
  };

  const remove = useCallback(
    async (item: Item, again: boolean) => {
      // The stack first: the screen updates as soon as Intake does, as before the stack.
      if (item.stackCardId) await dropScan(item.stackCardId);
      if (item.receipt) await unqueueScan(item.receipt);
      if (item.added) await undoQuickAdd(item.added);
      setItems((current) => current.filter((i) => i.id !== item.id));
      if (again) {
        setCleared(true);
        rearm();
      }
    },
    [rearm],
  );

  const earlier = latest ? items.slice(1) : items;
  const hiddenSets = useHiddenSets();
  const hidden = hiddenSets ?? new Set<SetKey>(DEFAULT_HIDDEN_SETS);

  return (
    <div className={styles.page}>
      <div className={styles.controls}>
        <label className={styles.modeLabel}>
          <span className="visually-hidden">Scan mode</span>
          <select
            className={styles.mode}
            value={mode}
            onChange={(event) => setMode(event.target.value as Mode)}
          >
            {MODES.map((value) => (
              <option key={value} value={value}>
                {MODE_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
        {/* Only a bulk run has stacks of foils to put through. */}
        {mode === 'add' && (
          <button
            type="button"
            className={styles.foilMode}
            aria-pressed={foils}
            onClick={() => setFoils((on) => !on)}
            title="Record every scan as its foil printing — for running a stack of foils through"
          >
            ✦ Foils {foils ? 'on' : 'off'}
          </button>
        )}
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
        phase={asking ? 'asking' : phase}
        onView={setView}
      />

      {phase === 'stuck' && (
        <NotRecognised
          sets={sets}
          onChoose={(s) => void lookUp(s).catch(failed)}
          onRescan={retry}
          onSkip={resume}
        />
      )}

      {latest && (
        <LatestScan
          key={latest.id}
          item={latest}
          mode={mode}
          sets={sets}
          nameOf={nameOf}
          sameCard={sameCard}
          previous={phase === 'stuck'}
          onChoose={(p) => void choose(latest, p).catch(failed)}
          onRescan={() => void remove(latest, true).catch(failed)}
          onConfirm={() => void choose(latest, latest.chosen).catch(failed)}
          onToggleFoil={foilToggle(latest)}
          onAdd={() => void addNow(latest).catch(failed)}
          hidden={hidden}
        />
      )}

      {earlier.length > 0 && (
        <section className={styles.history} aria-labelledby="scan-history">
          <h2 id="scan-history" className={styles.historyTitle}>
            Earlier scans
          </h2>
          <ul className={styles.historyList}>
            {earlier.map((item) => (
              <li key={item.id} className={styles.historyItem}>
                <span>
                  {nameOf(item.chosen)}{' '}
                  <span className={styles.muted}>
                    {item.chosen.setKey} · {variantLabel(item.chosen.variant)}
                    {item.question && ' · not added'}
                    {item.added && ` · added, ${FATE_SHORT[item.added.fate.kind]}`}
                  </span>
                </span>
                {(item.receipt || item.stackCardId || item.added) && (
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

      {mode === 'deck' && (
        <p className={styles.footnote}>
          Scan every card of one built deck: leader, base and the rest. It waits in{' '}
          <Link to="/intake">Intake</Link>, where you name it and build it. Its cards go straight
          into the deck’s box, not the binder.
        </p>
      )}
      {mode === 'add' && (
        <p className={styles.footnote}>
          Scans wait in <Link to="/intake">Intake</Link> until you review them. The camera can’t
          tell foil: tap ✦ Foil on a scan, or turn on ✦ Foils to run a stack of foils through. For a
          single booster, Quick Scan files each card as you go.
        </p>
      )}
      {mode === 'info' && (
        <p className={styles.footnote}>
          Add to collection puts a card straight in, no Intake, and says where it goes. The camera
          can’t tell foil: tap ✦ Foil before adding.
        </p>
      )}
      <span className="visually-hidden" aria-live="polite">
        {latest ? `Scanned ${nameOf(latest.chosen)}` : ''}
      </span>
    </div>
  );
}

/**
 * After MAX_MISSES on one card: find it by title or number, or skip it. Cards outside the
 * catalog (promos, other games) end up here, as does a card the camera just can't read.
 */
function NotRecognised({
  sets,
  onChoose,
  onRescan,
  onSkip,
}: {
  sets: Map<SetKey, LoadedSet>;
  onChoose: (suggestion: SearchSuggestion) => void;
  /** Try again now on what's in view — e.g. an empty tray was taken for a card. */
  onRescan: () => void;
  onSkip: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const catalogs = useMemo(() => [...sets.values()].map(toSearchCatalog), [sets]);
  const newest = [...sets.keys()].at(-1) ?? 'SOR';
  return (
    <section className={styles.stuck} aria-labelledby="not-recognised">
      <h2 id="not-recognised" className={styles.stuckTitle}>
        Couldn’t recognise this card
      </h2>
      <p className={styles.meta}>
        Look it up by title or number, rescan, or skip it. Putting a different card in view carries
        on by itself.
      </p>
      <CardSearch
        catalogs={catalogs}
        currentSetKey={newest}
        inputRef={inputRef}
        onChoose={onChoose}
      />
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={onRescan}>
          Rescan
        </button>
        <button type="button" className={styles.button} onClick={onSkip}>
          Skip this card
        </button>
      </div>
    </section>
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
                : phase === 'stuck'
                  ? 'Not recognised — look it up below, or skip it'
                  : phase === 'asking'
                    ? 'Paused — answer below to carry on scanning'
                    : phase === 'tooClose'
                      ? 'Too close — fit the whole card inside the frame'
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
  sameCard,
  previous = false,
  onChoose,
  onRescan,
  onConfirm,
  onToggleFoil,
  onAdd,
  hidden,
}: {
  item: Item;
  mode: Mode;
  sets: Map<SetKey, LoadedSet>;
  nameOf: (p: { setKey: string; base: number }) => string;
  sameCard: (a: { setKey: string; base: number }, b: { setKey: string; base: number }) => boolean;
  /**
   * The scanner has given up on the card now in view: this result is the card before it,
   * and must not read as a guess at the new one.
   */
  previous?: boolean;
  onChoose: (p: Printing) => void;
  onRescan: () => void;
  onConfirm: () => void;
  /** Flip the scan to its foil / non-foil printing; absent when it has none. */
  onToggleFoil?: () => void;
  /** Look up mode: add it to the collection now. */
  onAdd: () => void;
  /** Sets with no binder: their cards are set aside, not filed. */
  hidden: ReadonlySet<SetKey>;
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
  /** Which set it is, when the same art is in several: one choice per set, this one first. */
  const setChoices = [
    chosen,
    ...(item.result.twins ?? [])
      .filter((t) => sameCard(t, chosen))
      .map((entry) => asPrinting({ entry })),
    ...alternatives.filter((m) => nameOf(m.entry) === nameOf(chosen)).map(asPrinting),
  ].filter((p, i, all) => all.findIndex((q) => q.setKey === p.setKey) === i);
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
      data-question={item.question ?? undefined}
      data-previous={previous || undefined}
    >
      <img
        className={styles.art}
        src={artUrl(chosen.setKey, artNumber(printings, chosen))}
        alt=""
      />
      <div className={styles.details}>
        {previous && <p className={styles.previous}>Previous card — not the one in view</p>}
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
              {setChoices.map((p) => (
                <button
                  key={cardKey(p)}
                  type="button"
                  className={styles.button}
                  title={sets.get(p.setKey)?.label}
                  onClick={() => onChoose(p)}
                >
                  {p.setKey} #{p.num}
                </button>
              ))}
            </div>
          </div>
        ) : item.question === 'card' ? (
          <div className={styles.question}>
            <p>Not sure — is this the right card?</p>
            {item.result.tooClose && (
              <p className={styles.meta}>
                The card runs past the edge of the frame — move the phone back so all of it shows,
                for a surer read.
              </p>
            )}
            <div className={styles.choices}>
              <button type="button" className={styles.primary} onClick={onConfirm}>
                {mode === 'info' ? 'Yes' : 'Yes, add it'}
              </button>
              <button type="button" className={styles.button} onClick={() => setCorrecting(true)}>
                No, show others
              </button>
            </div>
          </div>
        ) : mode === 'add' ? (
          <p className={styles.added}>Added to Intake</p>
        ) : mode === 'deck' ? (
          <p className={styles.added}>Added to the scanned deck</p>
        ) : item.added ? (
          <Placement added={item.added} hidden={hidden.has(chosen.setKey)} />
        ) : (
          <>
            <p className={styles.meta}>
              You own {owned ?? '…'} · binder page {position.page}, row {position.row}, column{' '}
              {position.column} ·{' '}
              <Link
                to="/inventory/$setKey/$view"
                params={{ setKey: chosen.setKey, view: 'binder' }}
                search={{ card: chosen.base }}
              >
                Open in binder
              </Link>
            </p>
            <button type="button" className={styles.primary} onClick={onAdd}>
              Add to collection
            </button>
          </>
        )}

        <div className={styles.actions}>
          {onToggleFoil && (
            <button
              type="button"
              className={styles.foil}
              aria-pressed={variantAxes(chosen.variant).finish === 'foil'}
              onClick={onToggleFoil}
            >
              ✦ Foil
            </button>
          )}
          <button
            type="button"
            className={styles.button}
            aria-expanded={correcting}
            onClick={() => setCorrecting((v) => !v)}
          >
            Correct
          </button>
          <button type="button" className={styles.button} onClick={onRescan}>
            {item.added ? 'Undo' : 'Rescan'}
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

/** The history's word for where an added copy went. */
const FATE_SHORT: Record<QuickAdded['fate']['kind'], string> = {
  binder: 'binder',
  bulk: 'bulk',
  swap: 'binder, swapped',
};

const SIDE = { left: 'Left', right: 'Right' } as const;

/** Where a copy just added goes: its pocket (maybe in place of a weaker copy), or bulk. */
function Placement({ added, hidden }: { added: QuickAdded; hidden: boolean }) {
  const { fate, printing } = added;
  if (fate.kind === 'bulk') {
    return (
      <div className={styles.placement} data-fate="bulk" role="status">
        <p className={styles.placeTitle}>Bulk box</p>
        <p className={styles.meta}>The binder already has a playset at least as good.</p>
      </div>
    );
  }
  if (hidden) {
    return (
      <div className={styles.placement} data-fate="aside" role="status">
        <p className={styles.placeTitle}>Set it aside</p>
        <p className={styles.meta}>{printing.setKey} has no binder.</p>
      </div>
    );
  }
  const { page, row, column } = binderLayout(printing.base);
  return (
    <div className={styles.placement} data-fate="binder" role="status">
      <p className={styles.placeTitle}>
        <span className={styles.placeSet}>
          {printing.setKey} · Page {page} · {SIDE[pageSide(page)]}
        </span>
        Row {row} · Column {column}
      </p>
      <Pocket page={page} row={row} column={column} />
      {fate.kind === 'swap' && (
        <p className={styles.swap}>
          Take out the {variantLabel(fate.swapOut.variant)} copy — it goes to bulk.
        </p>
      )}
    </div>
  );
}
