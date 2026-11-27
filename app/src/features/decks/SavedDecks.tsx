import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import {
  cardKey,
  deckHoldings,
  deckStatus,
  inBoxCounts,
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

import { DeckRowsTable, type BoxColumn } from './DeckRowsTable';
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
  onQueue: (deck: SavedDeck) => void;
  onQueueMissing: (deck: SavedDeck) => void;
  onImport: () => void;
};

/**
 * Saved decklists.
 *
 * A deck is *built* once its cards are pulled from the binder into its box. A built deck
 * can lose cards — to another deck, or one at a time with − — and stays listed, flagged
 * with what is missing and whether you own those copies elsewhere.
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
  onQueue,
  onQueueMissing,
  onImport,
}: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const decks = library.customDecks;
  // Every deck that could use a binder copy is flagged, so you choose which one gets it.
  const upgradesByDeck = libraryUpgrades(library, homes);
  const holdings = deckHoldings(library);

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

      {!loading && decks.length === 0 && (
        <p className={styles.empty}>
          No saved decks yet. Choose <strong>New deck</strong> to build one, or{' '}
          <strong>Import</strong> to paste a decklist.
        </p>
      )}

      <ul className={styles.list}>
        {decks.map((deck, index) => (
          <SavedDeckItem
            key={deck.id}
            deck={deck}
            status={deckStatus(deck, library, homes)}
            upgrades={upgradesByDeck.get(deck.id) ?? []}
            holdings={holdings.get(deck.id)}
            lookup={lookup}
            owned={owned}
            pullable={pullable}
            expanded={expandedId === deck.id}
            onToggle={() => setExpandedId(expandedId === deck.id ? null : deck.id)}
            onUpdate={(patch) => onUpdate(deck.id, patch)}
            onDelete={() => onDelete(deck, index)}
            onOpenPickList={(mode) => onOpenPickList(deck, mode)}
            onAdjustBox={(row, delta, max) => onAdjustBox(deck, row, delta, max)}
            onSwap={(upgrade) => onSwap(deck, upgrade)}
            onQueue={() => onQueue(deck)}
            onQueueMissing={() => onQueueMissing(deck)}
          />
        ))}
      </ul>
    </section>
  );
}

type ItemProps = {
  deck: SavedDeck;
  status: DeckStatus;
  /** Better printings in the binder than the ones this built deck holds. */
  upgrades: DeckUpgrade[];
  /** What the deck's box holds, per card, by home: where a swapped-out copy goes back to. */
  holdings: Map<string, Homes> | undefined;
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
  onQueue: () => void;
  onQueueMissing: () => void;
};

/**
 * Splits the box's per-card counts across the deck's rows, in row order — so a card
 * listed in both main deck and sideboard fills the main deck first.
 */
function boxColumn(
  deck: SavedDeck,
  rows: DeckRowWithNeed[],
  pullable: OwnedLookup,
  onAdjust: ItemProps['onAdjustBox'],
): BoxColumn {
  const remaining = inBoxCounts(deck);
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

function StatusBadges({
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
        <>
          <span className={styles.badge}>Not built</span>
          <span className={styles.badge} data-tone={needed > 0 ? 'warning' : 'success'}>
            {needed > 0 ? `Need ${needed} to buy` : 'All owned'}
          </span>
        </>
      );
    case 'complete':
      return (
        <span className={styles.badge} data-tone="success">
          Built
        </span>
      );
    case 'partial':
      return (
        <>
          <span className={styles.badge} data-tone="warning">
            Built · cards missing
          </span>
          {status.missingOwned > 0 && (
            <span
              className={styles.badge}
              data-tone="warning"
              title="You own these — they are in the binder or another deck."
            >
              {status.missingOwned} owned elsewhere
            </span>
          )}
          {status.missingInBulk > 0 && (
            <span
              className={styles.badge}
              data-tone="warning"
              title="You own these — they are in the bulk box."
            >
              {status.missingInBulk} in bulk
            </span>
          )}
          {status.missingUnowned > 0 && (
            <span
              className={styles.badge}
              data-tone="danger"
              title={`You do not own enough of these for “${deck.name}”.`}
            >
              {status.missingUnowned} not owned
            </span>
          )}
        </>
      );
  }
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
    <li>
      {u.count > 1 ? `${u.count} × ` : ''}
      <strong>{cardName}</strong>: {variantLabel(u.from)} → {variantLabel(u.to)}
      {u.alsoFor && <span className={styles.shared}> · also fits {u.alsoFor.join(', ')}</span>}{' '}
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
              Put it in “{deckName}”’s box in place of the {variantLabel(u.from)}.
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

function SavedDeckItem({
  deck,
  status,
  upgrades,
  holdings,
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
          <StatusBadges deck={deck} status={status} needed={needed} />
          {upgrades.length > 0 && (
            <button
              type="button"
              className={styles.badgeButton}
              data-tone="info"
              aria-expanded={expanded}
              aria-controls={panelId}
              title="Your binder holds better printings of cards in this deck. Open the deck to see them."
              onClick={() => {
                if (!expanded) onToggle();
              }}
            >
              {upgradeCount(upgrades)} {upgradeCount(upgrades) === 1 ? 'upgrade' : 'upgrades'} in
              binder
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
          {status.state !== 'unbuilt' && (
            <button
              type="button"
              className={status.state === 'complete' ? styles.primary : styles.action}
              onClick={() => onOpenPickList('deconstruct')}
            >
              Deconstruct
            </button>
          )}
          {status.state === 'unbuilt' && (
            <button
              type="button"
              className={styles.action}
              title="Bought this deck already built? Queue its cards for review, then add them to your collection with the deck marked built."
              onClick={onQueue}
            >
              Add to collection
            </button>
          )}
          {needed > 0 && (
            <button
              type="button"
              className={styles.action}
              title="Bought the cards this deck is missing? Queue just those for review, then add them to your collection and into the deck's box."
              onClick={onQueueMissing}
            >
              Add missing
            </button>
          )}
          <Link
            to="/decks/$deckId"
            params={{ deckId: deck.id }}
            className={styles.action}
            title="Change the list: move cards between main deck and sideboard, add or remove cards"
          >
            Edit
          </Link>
          <button type="button" className={styles.action} onClick={() => void copyMissing()}>
            Copy missing
          </button>
          <button
            type="button"
            className={styles.action}
            title="Copy the deck as JSON, to play it on Karabast or import it into swudb.com"
            onClick={() => void copyExport()}
          >
            Export
          </button>
        </span>
      </div>

      {expanded && (
        <div id={panelId} className={styles.details}>
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
          {upgrades.length > 0 && (
            <section className={styles.upgrades} aria-label="Upgrades in your binder">
              <h3 className={styles.upgradesTitle}>Upgrades in your binder</h3>
              <p className={styles.upgradesNote}>
                Swap one in for a better-looking build. Nothing changes until you confirm. A copy
                shared with another deck is noted; once one deck has it, the other’s flag clears.
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
            box={deck.constructed ? boxColumn(deck, rows, pullable, onAdjustBox) : undefined}
          />
        </div>
      )}
    </li>
  );
}
