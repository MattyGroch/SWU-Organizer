import { useEffect, useMemo, useRef, useState } from 'react';

import { binderLayout } from '~/domain/binder';
import { VARIANTS, variantLabel } from '~/domain/catalog';
import {
  applyDeconstruct,
  cardKey,
  heldByHome,
  planConstruct,
  type ConstructLine,
  type HomeLookup,
  type TakeFromDeck,
} from '~/domain/deckBuild';
import type { DeckCardRef } from '~/domain/deckContents';
import { formatMissingLine, type DeckLookupSet } from '~/domain/decklist';
import type { DeckLibrary, SavedDeck } from '~/domain/decks';
import { pocketSpill, subtractVariants, sumVariants, type VariantCounts } from '~/domain/ownership';
import { buildPutBackList } from '~/domain/pickList';
import type { SetKey } from '~/domain/types';
import { useToast } from '~/ui/toastContext';

import styles from './PickListDialog.module.css';

type Props = {
  deck: SavedDeck;
  mode: 'construct' | 'deconstruct';
  library: DeckLibrary;
  lookup: Map<SetKey, DeckLookupSet>;
  setOrder: SetKey[];
  /** Everything owned, per home and printing. */
  homes: HomeLookup;
  quotaOf: (setKey: SetKey, base: number) => number;
  onClose: () => void;
  onConstruct: (pulls: DeckCardRef[], takes: TakeFromDeck[]) => void;
  /** Resolves to how many copies went to bulk because their pocket had filled up. */
  onDeconstruct: () => Promise<number>;
};

type Named = { name: string; subtitle?: string };

/**
 * Walk-the-binder list for building a deck, completing a partly built one, or filing one
 * back.
 *
 * Construct pulls from the binder first, in binder order — set, then page, row, column —
 * so one pass front to back finds everything. Then the bulk box, for what the binder is
 * out of. Copies neither can supply but another built deck holds are offered card by
 * card: take it (that deck stays built, now missing the card) or leave it (this deck is
 * built missing it). Whatever you do not own at all becomes the purchase list.
 *
 * Deconstruct sends each copy back where it came from: the binder, or the bulk box.
 */
export function PickListDialog({
  deck,
  mode,
  library,
  lookup,
  setOrder,
  homes,
  quotaOf,
  onClose,
  onConstruct,
  onDeconstruct,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const showToast = useToast();
  const [includeSideboard, setIncludeSideboard] = useState(false);
  /** `${deckId}|${cardKey}` for every copy chosen to be taken from another deck. */
  const [taken, setTaken] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const card = (setKey: SetKey, baseNumber: number): Named => {
    const found = lookup.get(setKey)?.byNumber.get(baseNumber);
    return found ? { name: found.Name, subtitle: found.Subtitle } : { name: `#${baseNumber}` };
  };

  const plan = useMemo(
    () => (mode === 'construct' ? planConstruct(deck, library, homes, includeSideboard) : []),
    [mode, deck, library, homes, includeSideboard],
  );

  const binderGroups = useMemo(() => groupInBinderOrder(plan, setOrder), [plan, setOrder]);
  const deckOffers = plan.flatMap((line) =>
    line.fromDecks.map((source) => ({
      line,
      source,
      id: `${source.deckId}|${cardKey(line.setKey, line.baseNumber)}`,
    })),
  );
  const unowned = plan.filter((line) => line.unowned > 0);
  const fromBulk = inCardOrder(
    plan
      .filter((line) => line.fromBulk > 0)
      .map((line) => ({ ...line, printings: line.bulkPrintings })),
    setOrder,
  );

  const pullCount = plan.reduce((sum, l) => sum + l.fromBinder, 0);
  const bulkCount = plan.reduce((sum, l) => sum + l.fromBulk, 0);
  const takeCount = deckOffers.reduce(
    (sum, o) => sum + (taken.has(o.id) ? o.source.available : 0),
    0,
  );
  const leftCount = deckOffers.reduce(
    (sum, o) => sum + (taken.has(o.id) ? 0 : o.source.available),
    0,
  );
  const unownedCount = unowned.reduce((sum, l) => sum + l.unowned, 0);

  function close() {
    dialogRef.current?.close();
  }

  function toggleTake(id: string) {
    setTaken((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function copyPurchaseList() {
    const text = unowned
      .map((line) => {
        const { name, subtitle } = card(line.setKey, line.baseNumber);
        return formatMissingLine(name, subtitle, line.setKey, line.unowned);
      })
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      showToast({ tone: 'success', message: 'Purchase list copied.' });
    } catch {
      showToast({ tone: 'danger', message: 'Copy failed.' });
    }
  }

  function markBuilt() {
    // The binder first, then the bulk box — the same order the plan was made in.
    const pulls = plan
      .filter((line) => line.fromBinder + line.fromBulk > 0)
      .map((line) => ({
        setKey: line.setKey,
        baseNumber: line.baseNumber,
        count: line.fromBinder + line.fromBulk,
      }));
    const takes = deckOffers
      .filter((offer) => taken.has(offer.id))
      .map((offer) => ({
        deckId: offer.source.deckId,
        setKey: offer.line.setKey,
        baseNumber: offer.line.baseNumber,
        count: offer.source.available,
      }));
    onConstruct(pulls, takes);
    const missing = leftCount + unownedCount;
    showToast({
      tone: missing ? 'warning' : 'success',
      message: missing
        ? `“${deck.name}” built with ${missing} ${missing === 1 ? 'card' : 'cards'} missing.`
        : `“${deck.name}” built.`,
    });
    close();
  }

  async function markReturned() {
    close();
    try {
      const moved = await onDeconstruct();
      showToast({
        tone: 'success',
        message:
          `“${deck.name}” put away.` +
          (moved ? ` ${moved} ${moved === 1 ? 'copy' : 'copies'} went to the bulk box.` : ''),
      });
    } catch {
      showToast({ tone: 'danger', message: `“${deck.name}” could not be put away.` });
    }
  }

  const putAway = useMemo(() => {
    if (mode !== 'deconstruct') return null;
    const toBinder: DeckCardRef[] = [];
    const toBulk: PrintedLine[] = [];
    for (const ref of deck.pulledCards) {
      const bulk = ref.fromBulk ?? {};
      const binder = sumVariants(subtractVariants(ref.variants ?? { normal: ref.count }, bulk));
      if (binder > 0) toBinder.push({ ...ref, count: binder });
      if (sumVariants(bulk) > 0) toBulk.push({ ...ref, printings: bulk });
    }
    // Pockets that filled up while these were out keep only their best playset.
    const heldAfter = heldByHome(applyDeconstruct(library, deck.id));
    const overflow: PrintedLine[] = [];
    for (const ref of toBinder) {
      const key = cardKey(ref.setKey, ref.baseNumber);
      const printings = pocketSpill(
        homes(ref.setKey, ref.baseNumber),
        heldAfter.get(key)?.binder ?? {},
        quotaOf(ref.setKey, ref.baseNumber),
      );
      if (sumVariants(printings) > 0) overflow.push({ ...ref, printings });
    }
    return {
      binder: buildPutBackList(toBinder, lookup, setOrder),
      binderCount: toBinder.reduce((sum, ref) => sum + ref.count, 0),
      bulk: inCardOrder(toBulk, setOrder),
      overflow: inCardOrder(overflow, setOrder),
    };
  }, [mode, deck, library, homes, quotaOf, lookup, setOrder]);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onClose={onClose}
      aria-labelledby="pick-list-title"
    >
      <div className={styles.header}>
        <h2 id="pick-list-title" className={styles.title}>
          {mode === 'deconstruct' ? 'Deconstruct' : deck.constructed ? 'Complete' : 'Construct'}:{' '}
          {deck.name}
        </h2>
        <button type="button" className={styles.secondary} onClick={close}>
          Close
        </button>
      </div>

      {mode === 'deconstruct' && putAway ? (
        <div className={styles.body}>
          <p className={styles.lead}>
            Flip through your binders front to back and put each card below back in its slot.
          </p>
          <p className={styles.totals}>
            <strong>{putAway.binderCount}</strong> to the binder
            {putAway.bulk.length > 0 && (
              <>
                {' · '}
                <strong>{sumLines(putAway.bulk)}</strong> to the bulk box
              </>
            )}
          </p>
          {putAway.binder.map((group) => (
            <BinderTable
              key={group.setKey}
              setKey={group.setKey}
              verb="Put back"
              items={group.items.map((item) => ({ ...item, count: item.count }))}
            />
          ))}
          {putAway.overflow.length > 0 && (
            <PrintedList
              id="overflow-title"
              title="Pockets that filled up meanwhile"
              note="These pockets got new copies while the deck was out. Once the cards above are back, take these out for the bulk box."
              lines={putAway.overflow}
              card={card}
            />
          )}
          {putAway.bulk.length > 0 && (
            <PrintedList
              id="to-bulk-title"
              title="Back to the bulk box"
              note="These came from the bulk box, so that is where they go."
              lines={putAway.bulk}
              card={card}
            />
          )}
          <div className={styles.buttons}>
            <button type="button" className={styles.primary} onClick={() => void markReturned()}>
              Mark as put away
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.body}>
          <p className={styles.lead}>
            Flip through your binders front to back and pull each card below, in order.
          </p>

          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={includeSideboard}
              onChange={(event) => setIncludeSideboard(event.target.checked)}
            />
            <span>Include sideboard</span>
          </label>

          <p className={styles.totals}>
            <strong>{pullCount}</strong> from the binder
            {bulkCount > 0 && (
              <>
                {' · '}
                <strong>{bulkCount}</strong> from the bulk box
              </>
            )}
            {deckOffers.length > 0 && (
              <>
                {' · '}
                <strong>{takeCount}</strong> taken from other decks
              </>
            )}
            {leftCount + unownedCount > 0 && (
              <span className={styles.short}>
                {' · '}will be missing {leftCount + unownedCount}
              </span>
            )}
          </p>

          {plan.length === 0 && <p className={styles.muted}>This deck already has everything.</p>}

          {binderGroups.map((group) => (
            <BinderTable
              key={group.setKey}
              setKey={group.setKey}
              verb="Pull"
              items={group.items.map((item) => ({
                ...item,
                ...card(item.setKey, item.baseNumber),
              }))}
            />
          ))}

          {fromBulk.length > 0 && (
            <PrintedList
              id="from-bulk-title"
              title="From the bulk box"
              note="The binder is out of these. Dig these printings out of the bulk box."
              lines={fromBulk}
              card={card}
            />
          )}

          {deckOffers.length > 0 && (
            <section className={styles.group} aria-labelledby="from-decks-title">
              <h3 id="from-decks-title" className={styles.groupTitle}>
                In other built decks
              </h3>
              <p className={styles.muted}>
                The binder and bulk box are out of these. Take them and that deck stays built,
                flagged as missing the card — or leave them, and this deck is built without it.
              </p>
              <ul className={styles.offers}>
                {deckOffers.map((offer) => {
                  const { name, subtitle } = card(offer.line.setKey, offer.line.baseNumber);
                  return (
                    <li key={offer.id}>
                      <label className={styles.checkbox}>
                        <input
                          type="checkbox"
                          checked={taken.has(offer.id)}
                          onChange={() => toggleTake(offer.id)}
                        />
                        <span>
                          Take <strong>{offer.source.available}×</strong> {name}
                          {subtitle ? ` - ${subtitle}` : ''} ({offer.line.setKey}) from{' '}
                          <strong>{offer.source.deckName}</strong>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {unowned.length > 0 && (
            <section className={styles.group} aria-labelledby="purchase-title">
              <h3 id="purchase-title" className={styles.groupTitle}>
                Not owned — purchase list
              </h3>
              <ul className={styles.plain}>
                {unowned.map((line) => {
                  const { name, subtitle } = card(line.setKey, line.baseNumber);
                  return (
                    <li key={cardKey(line.setKey, line.baseNumber)}>
                      {line.unowned}× {name}
                      {subtitle ? ` - ${subtitle}` : ''} ({line.setKey})
                    </li>
                  );
                })}
              </ul>
              <div>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => void copyPurchaseList()}
                >
                  Copy purchase list
                </button>
              </div>
            </section>
          )}

          <div className={styles.buttons}>
            <button
              type="button"
              className={styles.primary}
              onClick={markBuilt}
              disabled={plan.length === 0}
            >
              {leftCount + unownedCount > 0 ? 'Mark as built, cards missing' : 'Mark as built'}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}

type BinderItem = Named & {
  setKey: SetKey;
  baseNumber: number;
  count: number;
  page: number;
  row: number;
  column: number;
};

function groupInBinderOrder(plan: ConstructLine[], setOrder: SetKey[]) {
  const bySet = new Map<SetKey, Array<Omit<BinderItem, keyof Named>>>();
  for (const line of plan) {
    if (line.fromBinder <= 0) continue;
    const list = bySet.get(line.setKey) ?? [];
    list.push({
      setKey: line.setKey,
      baseNumber: line.baseNumber,
      count: line.fromBinder,
      ...binderLayout(line.baseNumber),
    });
    bySet.set(line.setKey, list);
  }
  for (const list of bySet.values()) {
    list.sort((a, b) => a.page - b.page || a.row - b.row || a.column - b.column);
  }
  return setOrder
    .filter((k) => bySet.has(k))
    .map((setKey) => ({ setKey, items: bySet.get(setKey)! }));
}

function BinderTable({
  setKey,
  verb,
  items,
}: {
  setKey: SetKey;
  verb: string;
  items: BinderItem[];
}) {
  return (
    <section className={styles.group}>
      <h3 className={styles.groupTitle}>{setKey}</h3>
      <div className={styles.tableWrap}>
        <table className={styles.table} aria-label={`${setKey} — ${verb.toLowerCase()}`}>
          <thead>
            <tr>
              <th scope="col" className={styles.numeric}>
                Page
              </th>
              <th scope="col" className={styles.numeric}>
                Row
              </th>
              <th scope="col" className={styles.numeric}>
                Col
              </th>
              <th scope="col">Card</th>
              <th scope="col" className={styles.numeric}>
                {verb}
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={cardKey(item.setKey, item.baseNumber)}>
                <td className={styles.numeric}>{item.page}</td>
                <td className={styles.numeric}>{item.row}</td>
                <td className={styles.numeric}>{item.column}</td>
                <td>
                  {item.name}
                  {item.subtitle && <span className={styles.subtitle}>{item.subtitle}</span>}
                </td>
                <td className={styles.numeric}>{item.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** A card and the printings to move, for the lists outside the binder walk. */
type PrintedLine = { setKey: SetKey; baseNumber: number; printings: VariantCounts };

/** The bulk box is unsorted, so these lists just go by set, then card number. */
function inCardOrder<T extends { setKey: SetKey; baseNumber: number }>(
  lines: T[],
  setOrder: SetKey[],
): T[] {
  const rank = (setKey: SetKey) => {
    const i = setOrder.indexOf(setKey);
    return i < 0 ? setOrder.length : i;
  };
  return [...lines].sort((a, b) => rank(a.setKey) - rank(b.setKey) || a.baseNumber - b.baseNumber);
}

function sumLines(lines: PrintedLine[]): number {
  return lines.reduce((sum, line) => sum + sumVariants(line.printings), 0);
}

function printingsLabel(printings: VariantCounts): string {
  return VARIANTS.filter((v) => (printings[v] ?? 0) > 0)
    .map((v) => `${printings[v]} ${variantLabel(v)}`)
    .join(', ');
}

function PrintedList({
  id,
  title,
  note,
  lines,
  card,
}: {
  id: string;
  title: string;
  note: string;
  lines: PrintedLine[];
  card: (setKey: SetKey, baseNumber: number) => Named;
}) {
  return (
    <section className={styles.group} aria-labelledby={id}>
      <h3 id={id} className={styles.groupTitle}>
        {title}
      </h3>
      <p className={styles.muted}>{note}</p>
      <ul className={styles.plain}>
        {lines.map((line) => {
          const { name, subtitle } = card(line.setKey, line.baseNumber);
          return (
            <li key={cardKey(line.setKey, line.baseNumber)}>
              {sumVariants(line.printings)}× {name}
              {subtitle ? ` - ${subtitle}` : ''} ({line.setKey} #{line.baseNumber}) —{' '}
              {printingsLabel(line.printings)}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
