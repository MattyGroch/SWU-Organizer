import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import {
  cardKey,
  deckHoldings,
  deckStatus,
  inBoxCounts,
  swapAllInBox,
  type DeckStatus,
  type HomeLookup,
} from '~/domain/deckBuild';
import type { Homes } from '~/domain/ownership';
import { binderLayout } from '~/domain/binder';
import { variantLabel } from '~/domain/catalog';
import { formatSwudbJson } from '~/domain/deckExport';
import { libraryUpgrades, upgradeCount, type DeckUpgrade } from '~/domain/deckUpgrades';
import {
  formatMissingCardsList,
  type DeckLookupSet,
  type DeckRowWithNeed,
} from '~/domain/decklist';
import type { DeckLibrary, SavedDeck } from '~/domain/decks';
import type { SetKey } from '~/domain/types';
import { useToast } from '~/ui/toastContext';

import { AspectIcons } from '../binder/AspectIcons';

import { DeckMenu } from './DeckMenu';
import { DeckRowsTable, type BoxColumn } from './DeckRowsTable';
import { DECK_GROUPS, groupDecks, type DeckGroupKey } from './deckGroups';
import {
  cardsNeeded,
  contentsToRows,
  deckAspects,
  formatLabel,
  type OwnedLookup,
} from './deckRows';
import styles from './SavedDecks.module.css';

type DeckPatch = Partial<Pick<SavedDeck, 'name'>>;

type Props = {
  library: DeckLibrary;
  loading: boolean;
  lookup: Map<SetKey, DeckLookupSet>;
  /** Everything owned — binder, bulk box and built decks alike. */
  owned: OwnedLookup;
  /** The same, per home and printing. */
  homes: HomeLookup;
  /** What a deck could still take: in the binder or the bulk box, not in a deck. */
  pullable: OwnedLookup;
  onUpdate: (id: string, patch: DeckPatch) => void;
  onDelete: (deck: SavedDeck, index: number) => void;
  onOpenPickList: (deck: SavedDeck, mode: 'construct' | 'deconstruct') => void;
  onAdjustBox: (deck: SavedDeck, row: DeckRowWithNeed, delta: 1 | -1, max: number) => void;
  /** Trades one copy in the deck for a better printing from the binder. */
  onSwap: (deck: SavedDeck, upgrade: DeckUpgrade) => void;
  /** Swap every bling-potential copy for a deck in one go. */
  onSwapAll: (deck: SavedDeck, upgrades: DeckUpgrade[]) => void;
  onQueue: (deck: SavedDeck) => void;
  onQueueMissing: (deck: SavedDeck) => void;
  onImport: () => void;
  view: DecksView;
  onViewChange: (view: DecksView) => void;
  /** Shown under the Precons tab: the checklist for marking which precons you own. */
  preconsPanel: ReactNode;
};

export type DecksView = 'decks' | 'precons';

const CLOSED_KEY = 'swu.decks.closedGroups';

function readClosed(): DeckGroupKey[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CLOSED_KEY) ?? 'null') as unknown;
    return Array.isArray(raw) ? (raw as DeckGroupKey[]) : [];
  } catch {
    return [];
  }
}

/**
 * Saved decklists.
 *
 * A deck is *built* once its cards are pulled from the binder into its box. A built deck
 * can lose cards — to another deck, or one at a time with − — and stays listed, flagged
 * with what is missing and whether you own those copies elsewhere.
 *
 * Owned precons are listed after them, tagged Precon: sealed decks that are complete until
 * a card is taken for another deck. They cannot be edited, renamed, deleted or taken apart.
 */
export function SavedDecks({
  library,
  loading,
  lookup,
  owned,
  homes,
  pullable,
  onUpdate,
  onDelete,
  onOpenPickList,
  onAdjustBox,
  onSwap,
  onSwapAll,
  onQueue,
  onQueueMissing,
  onImport,
  view,
  onViewChange,
  preconsPanel,
}: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [closed, setClosed] = useState<DeckGroupKey[]>(readClosed);
  const decks = library.customDecks;
  // Every deck that could use a binder copy is flagged, so you choose which one gets it.
  const upgradesByDeck = libraryUpgrades(library, homes);
  const holdings = deckHoldings(library);
  const preconNames = new Map(
    decks.flatMap((deck) => (deck.precon ? [[deck.precon, deck.name] as const] : [])),
  );
  const statusOf = (deck: SavedDeck) => deckStatus(deck, library, homes);
  const neededOf = (deck: SavedDeck) => cardsNeeded(deck, owned);
  const groups = groupDecks(decks, statusOf, neededOf);
  const mine = decks.filter((deck) => !deck.precon);
  const precons = decks.filter((deck) => deck.precon);

  // A deck that changes section (built, deconstructed, a card lost) opens the one it lands
  // in, so it never vanishes into a collapsed list. This is not remembered.
  const lastGroup = useRef<Map<string, DeckGroupKey> | null>(null);
  const placement = DECK_GROUPS.flatMap(({ key }) =>
    groups[key].map((deck) => [deck.id, key] as const),
  );
  const placementKey = placement.map(([id, key]) => `${id}:${key}`).join('|');
  useEffect(() => {
    const now = new Map(placement);
    const before = lastGroup.current;
    lastGroup.current = now;
    if (!before) return;
    const landed = new Set<DeckGroupKey>();
    for (const [id, key] of now) if (before.has(id) && before.get(id) !== key) landed.add(key);
    if (landed.size > 0) setClosed((prev) => prev.filter((key) => !landed.has(key)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- placementKey stands for placement
  }, [placementKey]);

  function toggleGroup(key: DeckGroupKey) {
    const next = closed.includes(key) ? closed.filter((k) => k !== key) : [...closed, key];
    setClosed(next);
    try {
      localStorage.setItem(CLOSED_KEY, JSON.stringify(next));
    } catch {
      // Remembering the layout is a convenience only.
    }
  }

  function renderDeck(deck: SavedDeck) {
    return (
      <SavedDeckItem
        key={deck.id}
        deck={deck}
        library={library}
        preconNames={preconNames}
        status={statusOf(deck)}
        upgrades={upgradesByDeck.get(deck.id) ?? []}
        holdings={holdings.get(deck.id)}
        homes={homes}
        lookup={lookup}
        owned={owned}
        pullable={pullable}
        expanded={expandedId === deck.id}
        onToggle={() => setExpandedId(expandedId === deck.id ? null : deck.id)}
        onUpdate={(patch) => onUpdate(deck.id, patch)}
        onDelete={() => onDelete(deck, decks.indexOf(deck))}
        onOpenPickList={(mode) => onOpenPickList(deck, mode)}
        onAdjustBox={(row, delta, max) => onAdjustBox(deck, row, delta, max)}
        onSwap={(upgrade) => onSwap(deck, upgrade)}
        onSwapAll={(upgrades) => onSwapAll(deck, upgrades)}
        onQueue={() => onQueue(deck)}
        onQueueMissing={() => onQueueMissing(deck)}
      />
    );
  }

  return (
    <section className={styles.panel} aria-labelledby="my-decks-title">
      <div className={styles.heading}>
        <h2 id="my-decks-title" className={styles.title}>
          My decks
        </h2>
        <span className={styles.count}>{decks.length || ''}</span>
        <button type="button" className={styles.importDeck} onClick={onImport}>
          Import
        </button>
        <Link to="/decks/new" className={styles.newDeck}>
          New deck
        </Link>
      </div>

      <div className={styles.tabs} role="radiogroup" aria-label="Show">
        <button
          type="button"
          role="radio"
          className={styles.tab}
          aria-checked={view === 'decks'}
          onClick={() => onViewChange('decks')}
        >
          Decks ({mine.length})
        </button>
        <button
          type="button"
          role="radio"
          className={styles.tab}
          aria-checked={view === 'precons'}
          onClick={() => onViewChange('precons')}
        >
          Precons ({precons.length})
        </button>
      </div>

      {view === 'decks' && (
        <>
          {!loading && mine.length === 0 && (
            <p className={styles.empty}>
              No saved decks yet. Choose <strong>New deck</strong> to build one, or{' '}
              <strong>Import</strong> to paste a decklist.
            </p>
          )}
          {DECK_GROUPS.map(({ key, title, hint }) => {
            const list = groups[key];
            if (list.length === 0) return null;
            const open = !closed.includes(key);
            return (
              <div key={key} className={styles.group} data-group={key}>
                <button
                  type="button"
                  className={styles.groupHeader}
                  aria-expanded={open}
                  onClick={() => toggleGroup(key)}
                >
                  <span className={styles.chevron} aria-hidden="true">
                    {open ? '▾' : '▸'}
                  </span>
                  <span className={styles.groupTitle}>{title}</span>
                  <span className={styles.count}>{list.length}</span>
                  <span className={styles.groupHint}>{hint}</span>
                </button>
                {open && <ul className={styles.list}>{list.map(renderDeck)}</ul>}
              </div>
            );
          })}
        </>
      )}

      {view === 'precons' && (
        <>
          {!loading && precons.length === 0 && (
            <p className={styles.empty}>
              No precons marked as owned yet. Mark them in <strong>Precon decks</strong> below.
            </p>
          )}
          {precons.length > 0 && <ul className={styles.list}>{precons.map(renderDeck)}</ul>}
          {preconsPanel}
        </>
      )}
    </section>
  );
}

type ItemProps = {
  deck: SavedDeck;
  library: DeckLibrary;
  /** Precon catalog key -> its name, for saying where a borrowed card came from. */
  preconNames: Map<string, string>;
  status: DeckStatus;
  /** Better printings in the binder than the ones this built deck holds. */
  upgrades: DeckUpgrade[];
  /** What the deck's box holds, per card, by home: where a swapped-out copy goes back to. */
  holdings: Map<string, Homes> | undefined;
  homes: HomeLookup;
  lookup: Map<SetKey, DeckLookupSet>;
  owned: OwnedLookup;
  pullable: OwnedLookup;
  expanded: boolean;
  onToggle: () => void;
  onUpdate: (patch: DeckPatch) => void;
  onDelete: () => void;
  onOpenPickList: (mode: 'construct' | 'deconstruct') => void;
  onAdjustBox: (row: DeckRowWithNeed, delta: 1 | -1, max: number) => void;
  onSwap: (upgrade: DeckUpgrade) => void;
  onSwapAll: (upgrades: DeckUpgrade[]) => void;
  onQueue: () => void;
  onQueueMissing: () => void;
};

/**
 * Splits the box's per-card counts across the deck's rows, in row order — so a card
 * listed in both main deck and sideboard fills the main deck first.
 */
function boxColumn(
  deck: SavedDeck,
  library: DeckLibrary,
  rows: DeckRowWithNeed[],
  pullable: OwnedLookup,
  onAdjust: ItemProps['onAdjustBox'],
): BoxColumn {
  const remaining = inBoxCounts(deck, library);
  const listed = new Map<string, number>();
  for (const row of rows) {
    const key = cardKey(row.setKey, row.baseNumber);
    listed.set(key, (listed.get(key) ?? 0) + row.count);
  }
  const counts = rows.map((row) => {
    const key = cardKey(row.setKey, row.baseNumber);
    const here = Math.min(row.count, remaining.get(key) ?? 0);
    remaining.set(key, (remaining.get(key) ?? 0) - here);
    return here;
  });
  return {
    counts,
    canAdd: rows.map((row) => pullable(row.setKey, row.baseNumber) > 0),
    onAdjust: (row, delta) =>
      onAdjust(row, delta, listed.get(cardKey(row.setKey, row.baseNumber)) ?? row.count),
  };
}

/** One pill says where the deck stands; the breakdown of what is missing lives in the details. */
function StatusPill({
  deck,
  status,
  needed,
}: {
  deck: SavedDeck;
  status: DeckStatus;
  needed: number;
}) {
  switch (status.state) {
    case 'unbuilt':
      return (
        <span className={styles.badge} data-tone={needed > 0 ? 'warning' : 'success'}>
          {needed > 0 ? `Need ${needed} to buy` : 'All owned'}
        </span>
      );
    case 'complete':
      return (
        <span className={styles.badge} data-tone="success">
          {deck.precon ? 'Complete' : 'Built'}
        </span>
      );
    case 'partial': {
      const total =
        status.missingOwned + status.missingInBulk + status.missingInPrecon + status.missingUnowned;
      return (
        <span
          className={styles.badge}
          data-tone={status.missingUnowned > 0 ? 'danger' : 'warning'}
          title="Open the deck to see where the missing cards are."
        >
          {total} missing
        </span>
      );
    }
  }
}

function MissingBreakdown({ deck, status }: { deck: SavedDeck; status: DeckStatus }) {
  if (status.state !== 'partial') return null;
  const parts: { text: string; tone: string; title: string }[] = [];
  if (status.missingOwned > 0)
    parts.push({
      text: `${status.missingOwned} owned elsewhere`,
      tone: 'warning',
      title: deck.precon
        ? 'You own these — they are in the binder, or lent to a deck you built.'
        : 'You own these — they are in the binder or another deck.',
    });
  if (status.missingInBulk > 0)
    parts.push({
      text: `${status.missingInBulk} in bulk`,
      tone: 'warning',
      title: 'You own these — they are in the bulk box.',
    });
  if (status.missingInPrecon > 0)
    parts.push({
      text: `${status.missingInPrecon} in a precon`,
      tone: 'warning',
      title: 'You own these — they are in a precon. Complete the deck to take them from it.',
    });
  if (status.missingUnowned > 0)
    parts.push({
      text: `${status.missingUnowned} not owned`,
      tone: 'danger',
      title: `You do not own enough of these for “${deck.name}”.`,
    });
  return (
    <p className={styles.breakdown}>
      <span>Missing:</span>
      {parts.map((part) => (
        <span key={part.text} className={styles.badge} data-tone={part.tone} title={part.title}>
          {part.text}
        </span>
      ))}
    </p>
  );
}

function UpgradeRow({
  upgrade: u,
  deckName,
  cardName,
  toBulk,
  onSwap,
}: {
  upgrade: DeckUpgrade;
  deckName: string;
  cardName: string;
  toBulk: boolean;
  onSwap: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const { page, row, column } = binderLayout(u.baseNumber);
  return (
    <li className={styles.upgradeItem}>
      <span className={styles.upgradeText}>
        {u.count > 1 ? `${u.count} × ` : ''}
        <strong>{cardName}</strong>: {variantLabel(u.from)} → {variantLabel(u.to)}
        {u.alsoFor && <span className={styles.shared}> · also fits {u.alsoFor.join(', ')}</span>}
      </span>
      {!confirming && (
        <button
          type="button"
          className={styles.action}
          title={u.count > 1 ? 'Swaps one copy at a time' : undefined}
          aria-label={`Swap ${variantLabel(u.to)} ${cardName} into ${deckName}`}
          onClick={() => setConfirming(true)}
        >
          Swap
        </button>
      )}
      {confirming && (
        <div className={styles.confirm} role="group" aria-label={`Confirm swap for ${cardName}`}>
          <ol className={styles.steps}>
            <li>
              Take the {variantLabel(u.to)} {cardName} out of the binder: {u.setKey} page {page},
              row {row}, column {column}.
            </li>
            <li>
              Put it in the “{deckName}” box in place of the {variantLabel(u.from)}.
            </li>
            <li>
              {toBulk
                ? `Put the ${variantLabel(u.from)} back in the bulk box.`
                : `Put the ${variantLabel(u.from)} in that binder pocket.`}
            </li>
          </ol>
          <button
            type="button"
            className={styles.primary}
            onClick={() => {
              setConfirming(false);
              onSwap();
            }}
          >
            Swap now
          </button>{' '}
          <button type="button" className={styles.action} onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * "Swap all": previews exactly what swapping every copy would do, as a pick list in binder
 * order (set, page, row, column) so one pass through the binder pulls them all. Nothing is
 * written until it is confirmed.
 */
function SwapAll({
  deck,
  library,
  homes,
  upgrades,
  lookup,
  onSwapAll,
}: {
  deck: SavedDeck;
  library: DeckLibrary;
  homes: HomeLookup;
  upgrades: DeckUpgrade[];
  lookup: Map<SetKey, DeckLookupSet>;
  onSwapAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const plan = open ? swapAllInBox(library, deck.id, upgrades, homes).applied : [];
  const nameOf = (setKey: SetKey, base: number) =>
    lookup.get(setKey)?.byNumber.get(base)?.Name ?? `#${base}`;
  const spot = (setKey: SetKey, base: number) => {
    const { page, row, column } = binderLayout(base);
    return { setKey, base, page, row, column };
  };
  const pick = plan
    .map((p) => ({ ...p, ...spot(p.setKey, p.baseNumber) }))
    .sort(
      (a, b) =>
        a.setKey.localeCompare(b.setKey) || a.page - b.page || a.row - b.row || a.column - b.column,
    );
  const toBulk = pick.filter((p) => p.toBulk).length;
  return (
    <>
      {!open && (
        <button
          type="button"
          className={styles.action}
          aria-label={`Swap all bling into ${deck.name}`}
          onClick={() => setOpen(true)}
        >
          Swap all
        </button>
      )}
      {open && (
        <div
          className={styles.confirm}
          role="group"
          aria-label={`Confirm swap all for ${deck.name}`}
        >
          <p className={styles.upgradesNote}>
            Pick list: {pick.length} {pick.length === 1 ? 'copy' : 'copies'}, in binder order. For
            each, take the bling copy from the binder and put it in the “{deck.name}” box, then put
            the copy it replaces where it says.
          </p>
          <ol className={styles.steps}>
            {pick.map((p, i) => (
              <li key={i}>
                <strong>{nameOf(p.setKey, p.baseNumber)}</strong>: take {variantLabel(p.to)} from{' '}
                {p.setKey} page {p.page}, row {p.row}, column {p.column}. Pull the{' '}
                {variantLabel(p.from)} out of the deck;{' '}
                {p.toBulk ? 'it goes back in the bulk box.' : 'it goes in that binder pocket.'}
              </li>
            ))}
          </ol>
          {toBulk > 0 && (
            <p className={styles.upgradesNote}>
              {toBulk} of the swapped-out {toBulk === 1 ? 'copy goes' : 'copies go'} to the bulk
              box.
            </p>
          )}
          <button
            type="button"
            className={styles.primary}
            disabled={pick.length === 0}
            onClick={() => {
              setOpen(false);
              onSwapAll();
            }}
          >
            Swap all now
          </button>{' '}
          <button type="button" className={styles.action} onClick={() => setOpen(false)}>
            Cancel
          </button>
        </div>
      )}
    </>
  );
}

function SavedDeckItem({
  deck,
  library,
  preconNames,
  status,
  upgrades,
  holdings,
  homes,
  lookup,
  owned,
  pullable,
  expanded,
  onToggle,
  onUpdate,
  onDelete,
  onOpenPickList,
  onAdjustBox,
  onSwap,
  onSwapAll,
  onQueue,
  onQueueMissing,
}: ItemProps) {
  const showToast = useToast();
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(deck.name);

  const needed = cardsNeeded(deck, owned);
  const rows = expanded ? contentsToRows(deck, lookup, owned) : [];
  const panelId = `deck-${deck.id}`;

  async function copyMissing() {
    const list = formatMissingCardsList(contentsToRows(deck, lookup, owned), true);
    if (!list) {
      showToast({ tone: 'info', message: `Nothing missing for “${deck.name}”.` });
      return;
    }
    try {
      await navigator.clipboard.writeText(list);
      showToast({ tone: 'success', message: `Missing cards for “${deck.name}” copied.` });
    } catch {
      showToast({ tone: 'danger', message: 'Copy failed.' });
    }
  }

  async function copyExport() {
    try {
      await navigator.clipboard.writeText(formatSwudbJson(deck));
      showToast({
        tone: 'success',
        message: `“${deck.name}” copied. Paste it into Karabast or swudb.com’s deck import.`,
      });
    } catch {
      showToast({ tone: 'danger', message: 'Copy failed.' });
    }
  }

  function commitRename() {
    const name = nameDraft.trim();
    if (name && name !== deck.name) onUpdate({ name });
    else setNameDraft(deck.name);
    setRenaming(false);
  }

  return (
    <li className={styles.item} data-status={status.state}>
      <div className={styles.row}>
        {renaming ? (
          <input
            className={styles.rename}
            value={nameDraft}
            aria-label="Deck name"
            autoFocus
            onChange={(event) => setNameDraft(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitRename();
              if (event.key === 'Escape') {
                setNameDraft(deck.name);
                setRenaming(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className={styles.name}
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={onToggle}
          >
            <span className={styles.chevron} aria-hidden="true">
              {expanded ? '▾' : '▸'}
            </span>
            <AspectIcons className={styles.aspects} aspects={deckAspects(deck, lookup)} />
            {deck.name}
          </button>
        )}

        <span className={styles.badges}>
          <span className={styles.badge}>{formatLabel(deck)}</span>
          <StatusPill deck={deck} status={status} needed={needed} />
          {upgrades.length > 0 && (
            <button
              type="button"
              className={styles.badgeButton}
              data-tone="info"
              aria-expanded={expanded}
              aria-controls={panelId}
              title="Your binder holds flashier printings of cards in this deck. Open the deck to see them."
              onClick={() => {
                if (!expanded) onToggle();
              }}
            >
              Bling potential · {upgradeCount(upgrades)}
            </button>
          )}
        </span>

        <span className={styles.actions}>
          {status.state !== 'complete' && (
            <button
              type="button"
              className={styles.primary}
              onClick={() => onOpenPickList('construct')}
            >
              {status.state === 'partial' ? 'Complete' : 'Construct'}
            </button>
          )}
          {status.state === 'complete' && !deck.precon && (
            <button
              type="button"
              className={styles.primary}
              onClick={() => onOpenPickList('deconstruct')}
            >
              Deconstruct
            </button>
          )}
          <DeckMenu label={`More actions for ${deck.name}`}>
            {status.state === 'partial' && !deck.precon && (
              <button type="button" onClick={() => onOpenPickList('deconstruct')}>
                Deconstruct
              </button>
            )}
            {status.state === 'unbuilt' && (
              <button
                type="button"
                title="Bought this deck already built? Queue its cards for review, then add them to your collection with the deck marked built."
                onClick={onQueue}
              >
                Add to collection
              </button>
            )}
            {needed > 0 && !deck.precon && (
              <button
                type="button"
                title="Bought the cards this deck is missing? Queue just those for review, then add them to your collection and into the deck's box."
                onClick={onQueueMissing}
              >
                Add missing
              </button>
            )}
            {!deck.precon && (
              <Link
                to="/decks/$deckId"
                params={{ deckId: deck.id }}
                title="Change the list: move cards between main deck and sideboard, add or remove cards"
              >
                Edit
              </Link>
            )}
            {status.state !== 'complete' && (
              <button type="button" onClick={() => void copyMissing()}>
                Copy missing
              </button>
            )}
            <button
              type="button"
              title="Copy the deck as JSON, to play it on Karabast or import it into swudb.com"
              onClick={() => void copyExport()}
            >
              Export
            </button>
          </DeckMenu>
        </span>
      </div>

      {expanded && (
        <div id={panelId} className={styles.details}>
          <MissingBreakdown deck={deck} status={status} />
          {!deck.precon && (
            <div className={styles.settings}>
              <span className={styles.spacer} />
              <button
                type="button"
                className={styles.action}
                onClick={() => {
                  setNameDraft(deck.name);
                  setRenaming(true);
                }}
              >
                Rename
              </button>
              <button type="button" className={styles.danger} onClick={onDelete}>
                Delete
              </button>
            </div>
          )}
          {(deck.borrowed?.length ?? 0) > 0 && (
            <section className={styles.upgrades} aria-label="Borrowed from precons">
              <h3 className={styles.upgradesTitle}>Borrowed from precons</h3>
              <p className={styles.upgradesNote}>
                These went from a precon into this deck. Deconstructing the deck, or taking the card
                out of its list, puts each one back in its precon.
              </p>
              <ul className={styles.upgradeList}>
                {deck.borrowed?.map((loan) => (
                  <li
                    key={`${loan.preconKey}:${loan.setKey}:${loan.baseNumber}`}
                    className={styles.upgradeItem}
                  >
                    {loan.count}×{' '}
                    <strong>
                      {lookup.get(loan.setKey)?.byNumber.get(loan.baseNumber)?.Name ??
                        `#${loan.baseNumber}`}
                    </strong>{' '}
                    from {preconNames.get(loan.preconKey) ?? loan.preconKey}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {upgrades.length > 0 && (
            <section className={styles.upgrades} aria-label="Bling potential in your binder">
              <div className={styles.upgradesHead}>
                <h3 className={styles.upgradesTitle}>Bling potential in your binder</h3>
                {upgradeCount(upgrades) > 1 && (
                  <SwapAll
                    deck={deck}
                    library={library}
                    homes={homes}
                    upgrades={upgrades}
                    lookup={lookup}
                    onSwapAll={() => onSwapAll(upgrades)}
                  />
                )}
              </div>
              <p className={styles.upgradesNote}>
                Swap one in for a flashier build, or swap them all and get a pick list. Nothing
                changes until you confirm. A copy shared with another deck is noted; once one deck
                has it, the other’s flag clears.
              </p>
              <ul className={styles.upgradeList}>
                {upgrades.map((u) => (
                  <UpgradeRow
                    key={`${u.setKey}:${u.baseNumber}:${u.from}:${u.to}`}
                    upgrade={u}
                    deckName={deck.name}
                    cardName={
                      lookup.get(u.setKey)?.byNumber.get(u.baseNumber)?.Name ?? `#${u.baseNumber}`
                    }
                    // The old copy goes back to bulk only when none of the deck's are binder-homed.
                    toBulk={
                      !((holdings?.get(cardKey(u.setKey, u.baseNumber))?.binder[u.from] ?? 0) > 0)
                    }
                    onSwap={() => onSwap(u)}
                  />
                ))}
              </ul>
            </section>
          )}
          <DeckRowsTable
            rows={rows}
            label={`${deck.name} cards`}
            box={
              deck.constructed ? boxColumn(deck, library, rows, pullable, onAdjustBox) : undefined
            }
          />
        </div>
      )}
    </li>
  );
}
