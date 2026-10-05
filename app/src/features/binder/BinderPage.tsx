import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  adjustPrinting,
  clearSlot,
  defaultPrinting,
  fillPlayset,
  printingFor,
  restorePrintings,
} from '~/data/inventory';
import {
  toSearchCatalog,
  variantForHotkey,
  type LoadedSet,
  type Printing,
  type SetManifestEntry,
} from '~/domain/catalog';
import { settleCards } from '~/data/spill';
import { heldInSet } from '~/domain/deckBuild';
import { NO_HOMES, ownedFor } from '~/domain/ownership';
import type { SearchCatalog, SearchSuggestion } from '~/domain/search';

import { BinderGrid } from './BinderGrid';
import {
  buildCardRows,
  collectionTotals,
  EMPTY_FILTERS,
  missingListSummary,
  missingListText,
  type Filters,
} from './cardRows';
import { CardTable } from './CardTable';
import { CollectionProgress } from './CollectionProgress';
import { FilterBar } from './FilterBar';
import { SelectedCardPanel } from './SelectedCardPanel';
import { SetVisibility } from './SetVisibility';
import { ShortcutsDialog } from './ShortcutsDialog';
import { SpreadPager } from './SpreadPager';
import { isTypingTarget, resolveShortcut } from './shortcuts';
import { useBinder } from './useBinder';
import { useSetOwnership } from './useOwnership';
import { binderEntries, DEFAULT_HIDDEN_SETS, useHiddenSets } from '~/data/binderSettings';
import { useDeckLibrary } from '~/features/decks/useDeckLibrary';
import { BulkEditDialog } from '~/features/bulk/BulkEditDialog';
import { ImportDialog } from '~/features/import/ImportDialog';
import { CardSearch } from '~/features/search/CardSearch';
import { InventoryNav } from '~/features/inventory/InventoryNav';
import { useQuota } from '~/features/inventory/useQuota';
import type { InventoryView } from '~/features/inventory/views';
import { formatUsd } from '~/ui/format';
import { useToast } from '~/ui/toastContext';
import { useNarrow } from '~/ui/useNarrow';
import { accentText, setAccent } from './setAccent';
import styles from './BinderPage.module.css';

type Props = {
  set: LoadedSet;
  entries: SetManifestEntry[];
  /** The binder spread, or the card list. Phones always get the list. */
  view: InventoryView;
  /** Every set already resolved, so search can span the whole collection. */
  loadedSets: Map<string, LoadedSet>;
  /** Base number from `?card=` — selected on arrival and paged to. */
  selectCard?: number;
};

export function BinderPage({ set, entries, view, loadedSets, selectCard }: Props) {
  const navigate = useNavigate();
  const binder = useBinder(set);
  const ownership = useSetOwnership(set.setKey);
  const searchInputRef = useRef<HTMLInputElement>(null);
  /** Phones get a shorter stack of controls, so the card table has the screen. */
  const narrow = useNarrow();
  const showBinder = view === 'binder';
  /** Where a swipe on the phone's single page began, to turn the page when it ends. */
  const swipeRef = useRef<{ x: number; y: number } | null>(null);
  const quota = useQuota();
  const moreRef = useRef<HTMLDetailsElement>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const hasQueryRef = useRef(false);
  const showToast = useToast();

  const hiddenSets = useHiddenSets();
  const hidden = useMemo(() => hiddenSets ?? new Set(DEFAULT_HIDDEN_SETS), [hiddenSets]);
  /** Sets with a binder — the picker, `[`/`]` and search only ever go to these. */
  const visibleEntries = useMemo(() => binderEntries(entries, hidden), [entries, hidden]);

  // Hiding the set on screen leaves nothing to show here; go to the default binder.
  useEffect(() => {
    if (hiddenSets && !visibleEntries.some((e) => e.key === set.setKey)) {
      void navigate({ to: '/inventory' });
    }
  }, [hiddenSets, visibleEntries, set.setKey, navigate]);

  /** Sets that have a binder, and the ones hidden — for whole-collection bulk edits. */
  const binderSets = visibleEntries;
  const hiddenSetKeys = useMemo(
    () => [...hidden].filter((key) => entries.some((e) => e.key === key)),
    [hidden, entries],
  );

  const searchCatalogs = useMemo<SearchCatalog[]>(
    () =>
      [...loadedSets.values()]
        .filter((loaded) => visibleEntries.some((e) => e.key === loaded.setKey))
        .map(toSearchCatalog),
    [loadedSets, visibleEntries],
  );

  const { library } = useDeckLibrary();
  /** What built decks hold of this set's cards, by the home each copy returns to. */
  const held = useMemo(() => heldInSet(library, set.setKey), [library, set.setKey]);

  const rows = useMemo(
    () => buildCardRows(set, ownership, filters, held, quota),
    [set, ownership, filters, held, quota],
  );

  /**
   * A copy added by hand goes in the pocket; if that overfills it, the weakest copy goes to
   * the bulk box, exactly as when Intake adds one.
   */
  const settle = useCallback(
    (base: number) => {
      const quotaOf = (_setKey: string, number: number) => {
        const card = set.cardsByBase.get(number);
        return card ? quota(card) : Infinity;
      };
      void settleCards([{ setKey: set.setKey, base }], quotaOf).then((moved) => {
        if (moved) {
          showToast({
            tone: 'info',
            message: `Pocket full: ${moved} ${moved === 1 ? 'copy goes' : 'copies go'} to the bulk box.`,
          });
        }
      });
    },
    [set, quota, showToast],
  );
  const adjustCopies = useCallback(
    (base: number, printing: Printing, delta: number) => {
      void adjustPrinting(set.setKey, base, printing, delta).then(() => {
        if (delta > 0) settle(base);
      });
    },
    [set.setKey, settle],
  );
  const totals = useMemo(() => collectionTotals(rows), [rows]);
  // The copy buttons take exactly the rows the table shows, so filters decide what goes
  // into a TCGplayer order: filter to Rares, and only missing Rares are copied.
  const toOrder = useMemo(() => missingListSummary(rows), [rows]);

  const goToSet = useCallback(
    (delta: number) => {
      const index = visibleEntries.findIndex((e) => e.key === set.setKey);
      if (index === -1 || visibleEntries.length < 2) return;
      const next = visibleEntries[(index + delta + visibleEntries.length) % visibleEntries.length];
      // `search: {}` is deliberate — the router preserves search params by default, and a
      // stale `?card=` would select an unrelated card in the set you just moved to.
      if (next) {
        void navigate({
          to: '/inventory/$setKey/$view',
          params: { setKey: next.key, view },
          search: {},
        });
      }
    },
    [visibleEntries, set.setKey, navigate, view],
  );

  const adjustDefault = useCallback(
    (delta: number) => {
      const base = binder.active?.card.Number;
      if (base === undefined) return;
      const printing = defaultPrinting(set, base);
      if (printing) adjustCopies(base, printing, delta);
    },
    [binder.active, set, adjustCopies],
  );

  const adjustPrinting_ = useCallback(
    (printing: Printing, delta: number) => {
      const base = binder.active?.card.Number;
      if (base === undefined) return;
      adjustCopies(base, printing, delta);
    },
    [binder.active, adjustCopies],
  );

  const adjustVariant = useCallback(
    (hotkey: number, delta: number) => {
      const base = binder.active?.card.Number;
      const variant = variantForHotkey(hotkey);
      if (base === undefined || !variant) return;
      // Only live for printings this card actually has — SOR units have no Prestige run,
      // and LAW/ASH/HMW list no plain Foil.
      const printing = printingFor(set, base, variant);
      if (printing) adjustCopies(base, printing, delta);
    },
    [binder.active, set, adjustCopies],
  );

  /** Shift+plus — top this card up to a full playset of its default printing. */
  const fillSelectedPlayset = useCallback(() => {
    const card = binder.active?.card;
    if (!card) return;
    const printing = defaultPrinting(set, card.Number);
    if (!printing) return;

    const playset = quota({ type: card.Type, maxCopies: card.MaxCopies });
    void fillPlayset(set.setKey, card.Number, printing, playset).then(() => settle(card.Number));
  }, [binder.active, set, quota, settle]);

  /** Shift+minus — empty the slot, with undo rather than a confirmation prompt. */
  const clearSelectedSlot = useCallback(() => {
    const card = binder.active?.card;
    if (!card) return;

    void clearSlot(set.setKey, card.Number).then((removed) => {
      if (!removed.length) return;
      const copies = removed.reduce((sum, row) => sum + row.count, 0);
      showToast({
        tone: 'danger',
        message: `Removed ${copies} ${copies === 1 ? 'copy' : 'copies'} of ${card.Name}.`,
        action: { label: 'Undo', onAction: () => restorePrintings(removed) },
      });
    });
  }, [binder.active, set.setKey, showToast]);

  /**
   * Routes every pick through the URL, so a same-set and a cross-set result behave
   * identically — both select the card and page the binder to it, and both leave a
   * linkable address behind. Previously the cross-set branch navigated with a `card`
   * param that nothing read, so choosing a card from another set changed set and then
   * did nothing.
   */
  const chooseSuggestion = useCallback(
    (suggestion: SearchSuggestion) => {
      if (suggestion.setKey === set.setKey) {
        // Already here: select directly so the page flip is immediate, and record the
        // position in the URL without stacking history entries.
        binder.selectNumber(suggestion.baseNumber);
        appliedSelectionRef.current = `${set.setKey}:${suggestion.baseNumber}`;
        void navigate({
          to: '/inventory/$setKey/$view',
          params: { setKey: set.setKey, view },
          search: { card: suggestion.baseNumber },
          replace: true,
        });
        return;
      }

      void navigate({
        to: '/inventory/$setKey/$view',
        params: { setKey: suggestion.setKey, view },
        search: { card: suggestion.baseNumber },
      });
    },
    [set.setKey, navigate, binder, view],
  );

  /**
   * Selects the card named by `?card=`, which also pages the binder to it — `selectNumber`
   * derives the spread from the card's own position.
   *
   * Keyed on the set and the number so arriving from a cross-set search selects there,
   * and so re-selecting the same card after browsing away works.
   */
  const appliedSelectionRef = useRef<string>('');
  useEffect(() => {
    if (selectCard === undefined) return;
    const token = `${set.setKey}:${selectCard}`;
    if (appliedSelectionRef.current === token) return;
    if (!set.byNumber.has(selectCard)) return;

    appliedSelectionRef.current = token;
    binder.selectNumber(selectCard);
  }, [selectCard, set, binder]);

  // Paint the toolbar, tab and table header in the set's accent colour; cleared on leaving the binder.
  useEffect(() => {
    const accent = setAccent(set.setKey);
    const root = document.documentElement;
    if (accent) {
      root.style.setProperty('--set-accent', accent);
      root.style.setProperty('--set-accent-text', accentText(accent));
    } else {
      root.style.removeProperty('--set-accent');
      root.style.removeProperty('--set-accent-text');
    }
    return () => {
      root.style.removeProperty('--set-accent');
      root.style.removeProperty('--set-accent-text');
    };
  }, [set.setKey]);

  // One global key handler, driven by the pure `resolveShortcut` map.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // A modal (import, bulk edit) owns the keyboard: without this, `]` or Shift+−
      // pressed inside one would change set or clear a slot in the binder behind it.
      if (document.querySelector('dialog[open]')) return;
      const intent = resolveShortcut(event, {
        typing: isTypingTarget(event.target),
        hasSelection: binder.active !== null,
        hasQuery: hasQueryRef.current,
      });
      if (!intent) return;

      switch (intent.type) {
        case 'showHelp':
          event.preventDefault();
          setHelpOpen(true);
          break;
        case 'focusSearch':
          event.preventDefault();
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
          break;
        case 'submitSearch':
          break;
        case 'clearSelection': {
          binder.clearSelection();
          // The deselected cell keeps DOM focus, and with it the purple focus ring — so it
          // still looked selected. Arrows do nothing without a selection, so there is no
          // keyboard position worth keeping on the grid.
          const focused = document.activeElement;
          if (focused instanceof HTMLElement && focused.closest('[role="grid"]')) focused.blur();
          break;
        }
        case 'move':
          event.preventDefault();
          binder.move(intent.direction);
          break;
        case 'stepSpread':
          event.preventDefault();
          binder.stepSpread(intent.delta);
          break;
        case 'stepSet':
          event.preventDefault();
          goToSet(intent.delta);
          break;
        case 'adjustDefault':
          event.preventDefault();
          adjustDefault(intent.delta);
          break;
        case 'adjustVariant':
          event.preventDefault();
          adjustVariant(intent.hotkey, intent.delta);
          break;
        case 'fillPlayset':
          event.preventDefault();
          fillSelectedPlayset();
          break;
        case 'clearSlot':
          event.preventDefault();
          clearSelectedSlot();
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [binder, goToSet, adjustDefault, adjustVariant, fillSelectedPlayset, clearSelectedSlot]);

  async function copyMissing(mode: 'fullNeeded' | 'oneEach') {
    const text = missingListText(rows, set.setKey, mode);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
    window.setTimeout(() => setCopyState('idle'), 2400);
  }

  /** Copy-for-TCGplayer buttons and value totals: beside the progress on desktop, in More on a phone. */
  const copyButtons = (
    <div className={styles.copyGroup} role="group" aria-label="Copy for TCGplayer mass entry">
      <button
        type="button"
        className={styles.action}
        disabled={toOrder.cards === 0}
        onClick={() => copyMissing('fullNeeded')}
        title="Every copy still needed for the cards shown, in TCGplayer mass-entry format"
      >
        Copy full need{toOrder.cards > 0 && ` (${toOrder.copies})`}
      </button>
      <button
        type="button"
        className={styles.action}
        disabled={toOrder.cards === 0}
        onClick={() => copyMissing('oneEach')}
        title="One copy of each card shown that is still needed"
      >
        Copy 1 each{toOrder.cards > 0 && ` (${toOrder.cards})`}
      </button>
      <span role="status" className={styles.copyStatus}>
        {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : ''}
      </span>
    </div>
  );
  const totalsList = (
    <dl className={styles.totals} aria-label="Collection totals">
      <div>
        <dt>Value</dt>
        <dd>{formatUsd(totals.value)}</dd>
      </div>
      <div>
        <dt>To finish</dt>
        <dd>{formatUsd(totals.missingCost)}</dd>
      </div>
    </dl>
  );

  /** Run a More-menu action and fold the menu away. */
  function fromMore(action: () => void) {
    if (moreRef.current) moreRef.current.open = false;
    action();
  }

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <InventoryNav setKey={set.setKey} current={view} />

        <label className={styles.setPicker}>
          <span className="visually-hidden">Card set</span>
          <select
            value={set.setKey}
            onChange={(event) =>
              navigate({
                to: '/inventory/$setKey/$view',
                params: { setKey: event.target.value, view },
                search: {},
              })
            }
          >
            {visibleEntries.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>

        <SetVisibility entries={entries} hidden={hidden} />

        <CardSearch
          catalogs={searchCatalogs}
          currentSetKey={set.setKey}
          inputRef={searchInputRef}
          onChoose={chooseSuggestion}
          onQueryChange={(query) => {
            hasQueryRef.current = query.trim().length > 0;
          }}
          wideResults
        />

        {narrow ? (
          <>
            {!showBinder && (
              <FilterBar filters={filters} onChange={setFilters} className={styles.inlineFilters} />
            )}
            <details className={styles.more} ref={moreRef}>
              <summary className={styles.moreSummary} aria-label="More: bulk edit, import, copy">
                ⋯
              </summary>
              <div className={styles.morePanel}>
                <button
                  type="button"
                  className={styles.action}
                  onClick={() => fromMore(() => setBulkOpen(true))}
                >
                  Bulk edit
                </button>
                <button
                  type="button"
                  className={styles.action}
                  onClick={() => fromMore(() => setImportOpen(true))}
                >
                  Import / export
                </button>
                {copyButtons}
                {totalsList}
              </div>
            </details>
          </>
        ) : (
          <>
            <button type="button" className={styles.action} onClick={() => setBulkOpen(true)}>
              Bulk edit
            </button>
            <button
              type="button"
              className={`${styles.action} ${styles.keyboardOnly}`}
              onClick={() => setHelpOpen(true)}
              title="Keyboard shortcuts — ?"
              aria-keyshortcuts="Shift+?"
            >
              Shortcuts
            </button>
            <button type="button" className={styles.action} onClick={() => setImportOpen(true)}>
              Import / export
            </button>
          </>
        )}
      </div>

      {helpOpen && <ShortcutsDialog onClose={() => setHelpOpen(false)} />}
      {bulkOpen && (
        <BulkEditDialog
          set={set}
          rows={rows}
          filters={filters}
          binderSets={binderSets}
          hiddenSetKeys={hiddenSetKeys}
          onClose={() => setBulkOpen(false)}
        />
      )}
      {importOpen && <ImportDialog catalog={loadedSets} onClose={() => setImportOpen(false)} />}

      <div className={styles.panelSlot} data-active={binder.active !== null}>
        <SelectedCardPanel
          set={set}
          active={binder.active}
          counts={ownedFor(ownership, binder.active?.card.Number)}
          held={(binder.active && held.get(binder.active.card.Number)) || NO_HOMES}
          quota={
            binder.active
              ? quota({ type: binder.active.card.Type, maxCopies: binder.active.card.MaxCopies })
              : 0
          }
          onAdjust={adjustDefault}
          onAdjustPrinting={adjustPrinting_}
          onClose={binder.clearSelection}
        />
      </div>

      {/* A two-page spread is too wide for a phone, so a phone shows one page at a time and
          a sideways swipe turns it. */}
      {showBinder ? (
        <div
          className={styles.binderArea}
          onTouchStart={(event) => {
            const touch = event.touches[0];
            swipeRef.current = narrow && touch ? { x: touch.clientX, y: touch.clientY } : null;
          }}
          onTouchEnd={(event) => {
            const start = swipeRef.current;
            const touch = event.changedTouches[0];
            swipeRef.current = null;
            if (!start || !touch) return;
            const dx = touch.clientX - start.x;
            const dy = touch.clientY - start.y;
            // Mostly sideways and far enough to be deliberate, so scrolling never flips.
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
              binder.stepPage(dx < 0 ? 1 : -1);
            }
          }}
        >
          {narrow ? (
            <SpreadPager
              unit="page"
              value={binder.viewPage}
              total={binder.geometry.totalPages}
              onGoTo={binder.goToPage}
              onStep={binder.stepPage}
            />
          ) : (
            <SpreadPager
              unit="spread"
              value={binder.viewSpread}
              total={binder.geometry.totalSpreads}
              onGoTo={binder.goToSpread}
              onStep={binder.stepSpread}
            />
          )}

          <BinderGrid
            set={set}
            viewSpread={binder.viewSpread}
            active={binder.active}
            ownership={ownership}
            held={held}
            focusRequest={binder.focusRequest}
            onSelect={binder.selectCard}
            {...(narrow && { singlePage: binder.viewPage })}
          />
        </div>
      ) : (
        <>
          {!narrow && <FilterBar filters={filters} onChange={setFilters} />}

          {narrow ? (
            <div className={styles.progressSlot}>
              <CollectionProgress totals={totals} compact />
            </div>
          ) : (
            <div className={styles.listHeader}>
              {copyButtons}

              <div className={styles.progressSlot}>
                <CollectionProgress totals={totals} />
              </div>

              {totalsList}
            </div>
          )}

          <CardTable
            rows={rows}
            selectedBase={binder.active?.card.Number ?? null}
            onSelect={binder.selectNumber}
          />
        </>
      )}
    </div>
  );
}
