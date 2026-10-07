import { Link, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { editDeck } from '~/data/deckLibrary';
import type { LoadedSet } from '~/domain/catalog';
import { applyDeckEdit, deckStatus, editReturns, type DeckEdit } from '~/domain/deckBuild';
import type { DeckCardRef, DeckContents } from '~/domain/deckContents';
import {
  addToZone,
  listOf,
  moveCard,
  sameList,
  setBase,
  setLeader,
  withFormat,
  zoneCount,
  type DeckZone,
} from '~/domain/deckEdit';
import {
  buildCardPool,
  checkDeckLegality,
  FORMAT_RULES,
  isPlayFormat,
  PLAY_FORMATS,
  type PlayFormat,
} from '~/domain/deckLegality';
import { formatDeckList, type DeckLookupSet } from '~/domain/decklist';
import { deckFormat, type DeckLibrary, type SavedDeck } from '~/domain/decks';
import type { Card, SetKey } from '~/domain/types';
import { Loader } from '~/ui/Loader';
import { useToast } from '~/ui/toastContext';
import { useNarrow } from '~/ui/useNarrow';

import { AspectIcons } from '../binder/AspectIcons';
import { CardSearch } from './CardSearch';
import { CostBadge } from './CostBadge';
import styles from './DeckEditorPage.module.css';
import { contentsToRows, deckAspects, type OwnedLookup } from './deckRows';
import type { SearchHit, SearchMode } from './deckSearch';
import { PickListDialog } from './PickListDialog';
import { useDeckCollection, type OwnershipBySet } from './useDeckCollection';
import { useDeckLibrary } from './useDeckLibrary';

type Props = {
  sets: Map<SetKey, LoadedSet>;
  binderOwnership: OwnershipBySet;
  deckId: string;
};

type Draft = { contents: DeckContents; format: PlayFormat; name: string };

const draftOf = (deck: SavedDeck): Draft => ({
  contents: listOf(deck),
  format: deckFormat(deck),
  name: deck.name,
});

/**
 * Edits a saved deck's list: leaders, base, main deck and sideboard, with a card lookup
 * beside it. Changes are a draft until Save. On a built deck, Save first lists the copies
 * the new list no longer holds, to put back; cards it adds leave the deck missing them,
 * for Complete to pull.
 */
export function DeckEditorPage({ sets, binderOwnership, deckId }: Props) {
  const { library, loading } = useDeckLibrary();
  const deck = library.customDecks.find((d) => d.id === deckId);

  if (loading) return <Loader label="Loading deck" />;
  if (!deck) {
    return (
      <div className={styles.page}>
        <p className={styles.missing}>
          This deck no longer exists. <Link to="/decks">Back to decks</Link>
        </p>
      </div>
    );
  }
  // Keyed by deck so a different deck starts a fresh draft.
  return (
    <Editor
      key={deck.id}
      sets={sets}
      binderOwnership={binderOwnership}
      library={library}
      deck={deck}
    />
  );
}

function Editor({
  sets,
  binderOwnership,
  library,
  deck,
}: {
  sets: Map<SetKey, LoadedSet>;
  binderOwnership: OwnershipBySet;
  library: DeckLibrary;
  deck: SavedDeck;
}) {
  const { lookup, setOrder, owned, homes, quotaOf } = useDeckCollection(
    sets,
    binderOwnership,
    library,
  );
  const navigate = useNavigate();
  const showToast = useToast();
  const narrow = useNarrow();

  const [draft, setDraft] = useState<Draft>(() => draftOf(deck));
  const [mode, setMode] = useState<SearchMode>('cards');
  const [leaderSlot, setLeaderSlot] = useState<0 | 1>(0);
  const [tab, setTab] = useState<'deck' | 'search'>('deck');
  const [putBack, setPutBack] = useState<{ refs: DeckCardRef[]; edit: DeckEdit } | null>(null);

  const setList = useMemo(() => [...sets.values()], [sets]);
  const pool = useMemo(() => buildCardPool(setList), [setList]);
  const rows = useMemo(
    () => contentsToRows(draft.contents, lookup, owned),
    [draft.contents, lookup, owned],
  );
  const legality = useMemo(
    () => checkDeckLegality(rows, draft.format, pool),
    [rows, draft.format, pool],
  );
  const aspects = useMemo(() => deckAspects(draft.contents, lookup), [draft.contents, lookup]);

  const saved = draftOf(deck);
  const dirty =
    !sameList(saved.contents, draft.contents) ||
    saved.format !== draft.format ||
    saved.name !== draft.name.trim();

  const edit = (update: (contents: DeckContents) => DeckContents) =>
    setDraft((current) => ({ ...current, contents: update(current.contents) }));

  function chooseFor(nextMode: SearchMode, slot: 0 | 1 = 0) {
    setMode(nextMode);
    setLeaderSlot(slot);
    setTab('search');
  }

  function onChoose(hit: SearchHit) {
    const card = { setKey: hit.setKey, baseNumber: hit.card.Number };
    edit((c) => (mode === 'base' ? setBase(c, card) : setLeader(c, leaderSlot, card)));
    setMode('cards');
    setTab('deck');
  }

  function onAdd(hit: SearchHit, zone: DeckZone) {
    edit((c) => addToZone(c, zone, { setKey: hit.setKey, baseNumber: hit.card.Number }, 1));
  }

  function cancel() {
    if (dirty && !window.confirm('Discard your changes to this deck?')) return;
    void navigate({ to: '/decks' });
  }

  async function save() {
    const next: DeckEdit = {
      contents: draft.contents,
      format: draft.format,
      name: draft.name,
      sourceText: formatDeckList(rows),
    };
    const refs = editReturns(library, deck.id, next.contents);
    if (refs.length) {
      setPutBack({ refs, edit: next });
      return;
    }
    try {
      await editDeck(deck.id, next, quotaOf);
    } catch {
      showToast({ tone: 'danger', message: `“${deck.name}” could not be saved.` });
      return;
    }
    const after = applyDeckEdit(library, deck.id, next);
    const status = deckStatus(
      after.customDecks.find((d) => d.id === deck.id)!,
      after,
      homes,
    );
    showToast({
      tone: 'success',
      message:
        `Saved “${next.name.trim() || deck.name}”.` +
        (status.state === 'partial' ? ' Use Complete to pull the cards it now needs.' : ''),
    });
    void navigate({ to: '/decks' });
  }

  const card = (ref: { setKey: SetKey; baseNumber: number }) =>
    lookup.get(ref.setKey)?.byNumber.get(ref.baseNumber);
  const rules = FORMAT_RULES[draft.format];
  const mainCount = draft.contents.mainDeck.reduce((n, r) => n + r.count, 0);
  const sideCount = draft.contents.sideboard.reduce((n, r) => n + r.count, 0);
  const copyLimit = (c: Card | undefined) => c?.MaxCopies ?? rules.copyLimit;

  const deckPanel = (
    <section className={styles.deck} aria-label="Deck list">
      <p className={legality.legal ? styles.legal : styles.illegal}>
        {legality.legal ? `Legal for ${rules.label}.` : `Not legal for ${rules.label} yet.`}{' '}
        <span className={styles.counts}>
          Main {mainCount}/{rules.minDeck} · Side {sideCount}/{rules.maxSideboard}
        </span>
      </p>
      {legality.issues.length > 0 && (
        <ul className={styles.issues}>
          {legality.issues.map((issue, i) => (
            <li key={`${issue.code}-${i}`} data-severity={issue.severity}>
              {issue.message}
            </li>
          ))}
        </ul>
      )}

      <div className={styles.slots}>
        <Slot
          label={draft.format === 'twinSuns' ? 'Leader 1' : 'Leader'}
          card={card(draft.contents.leader)}
          refCard={draft.contents.leader}
          owned={owned}
          onChange={() => chooseFor('leader', 0)}
        />
        {draft.format === 'twinSuns' && (
          <Slot
            label="Leader 2"
            card={draft.contents.secondLeader && card(draft.contents.secondLeader)}
            refCard={draft.contents.secondLeader}
            owned={owned}
            onChange={() => chooseFor('leader', 1)}
            onRemove={
              draft.contents.secondLeader ? () => edit((c) => setLeader(c, 1, null)) : undefined
            }
          />
        )}
        <Slot
          label="Base"
          card={card(draft.contents.base)}
          refCard={draft.contents.base}
          owned={owned}
          onChange={() => chooseFor('base')}
        />
      </div>

      <ZoneList
        title="Main deck"
        zone="main"
        refs={draft.contents.mainDeck}
        count={mainCount}
        lookup={lookup}
        owned={owned}
        copyLimit={copyLimit}
        onCount={(ref, delta) => edit((c) => addToZone(c, 'main', ref, delta))}
        onMove={(ref) => edit((c) => moveCard(c, 'main', ref))}
      />
      <ZoneList
        title="Sideboard"
        zone="side"
        refs={draft.contents.sideboard}
        count={sideCount}
        lookup={lookup}
        owned={owned}
        copyLimit={copyLimit}
        onCount={(ref, delta) => edit((c) => addToZone(c, 'side', ref, delta))}
        onMove={(ref) => edit((c) => moveCard(c, 'side', ref))}
      />
    </section>
  );

  const searchPanel = (
    <CardSearch
      sets={setList}
      mode={mode}
      format={draft.format}
      pool={pool}
      deckAspects={aspects}
      owned={owned}
      inDeck={(setKey, baseNumber, zone) => zoneCount(draft.contents, zone, { setKey, baseNumber })}
      onAdd={onAdd}
      onChoose={onChoose}
      onCancelChoose={() => {
        setMode('cards');
        if (narrow) setTab('deck');
      }}
    />
  );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button type="button" className={styles.back} onClick={cancel}>
          ← Decks
        </button>
        <AspectIcons className={styles.headerAspects} aspects={aspects} />
        <input
          className={styles.nameInput}
          value={draft.name}
          aria-label="Deck name"
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
        <label className={styles.format}>
          <span>Format</span>
          <select
            value={draft.format}
            onChange={(event) => {
              const format = event.target.value;
              if (!isPlayFormat(format)) return;
              setDraft({ ...draft, format, contents: withFormat(draft.contents, format) });
            }}
          >
            {PLAY_FORMATS.map((f) => (
              <option key={f} value={f}>
                {FORMAT_RULES[f].label}
              </option>
            ))}
          </select>
        </label>
      </header>

      {narrow && (
        <div className={styles.tabs} role="tablist" aria-label="Editor view">
          <button
            type="button"
            role="tab"
            className={styles.tab}
            aria-selected={tab === 'deck'}
            onClick={() => setTab('deck')}
          >
            Deck ({mainCount}
            {sideCount ? ` + ${sideCount}` : ''})
          </button>
          <button
            type="button"
            role="tab"
            className={styles.tab}
            aria-selected={tab === 'search'}
            onClick={() => setTab('search')}
          >
            {mode === 'cards' ? 'Add cards' : mode === 'leader' ? 'Choose leader' : 'Choose base'}
          </button>
        </div>
      )}

      <div className={styles.columns}>
        {(!narrow || tab === 'deck') && deckPanel}
        {(!narrow || tab === 'search') && searchPanel}
      </div>

      <footer className={styles.footer}>
        <span className={styles.footerNote}>
          {dirty ? 'Unsaved changes' : 'No changes'}
          {deck.constructed && dirty && ' · built deck: removed cards get a put-back list'}
        </span>
        <button type="button" className={styles.secondary} onClick={cancel}>
          Cancel
        </button>
        <button
          type="button"
          className={styles.primary}
          disabled={!dirty}
          onClick={() => void save()}
        >
          Save
        </button>
      </footer>

      {putBack && (
        <PickListDialog
          deck={{ ...deck, name: putBack.edit.name.trim() || deck.name }}
          mode="deconstruct"
          library={library}
          lookup={lookup}
          setOrder={setOrder}
          homes={homes}
          quotaOf={quotaOf}
          putBack={{
            refs: putBack.refs,
            after: applyDeckEdit(library, deck.id, putBack.edit),
          }}
          onClose={() => setPutBack(null)}
          onConstruct={() => {}}
          onDeconstruct={async () => {
            const moved = await editDeck(deck.id, putBack.edit, quotaOf);
            void navigate({ to: '/decks' });
            return moved;
          }}
        />
      )}
    </div>
  );
}

function Slot({
  label,
  card,
  refCard,
  owned,
  onChange,
  onRemove,
}: {
  label: string;
  card: Card | undefined;
  refCard: { setKey: SetKey; baseNumber: number } | undefined;
  owned: OwnedLookup;
  onChange: () => void;
  onRemove?: () => void;
}) {
  const have = refCard ? owned(refCard.setKey, refCard.baseNumber) : 0;
  return (
    <div className={styles.slot}>
      <span className={styles.slotLabel}>{label}</span>
      {card && refCard ? (
        <span className={styles.slotCard}>
          <span className={styles.lineAspects}>
            <AspectIcons aspects={card.Aspects} />
          </span>
          <span className={styles.lineName}>
            {card.Name}
            {card.Subtitle && <span className={styles.subtitle}>{card.Subtitle}</span>}
          </span>
          {have === 0 && <span className={styles.unowned}>not owned</span>}
        </span>
      ) : (
        <span className={styles.slotEmpty}>None</span>
      )}
      <span className={styles.slotActions}>
        <button type="button" className={styles.small} onClick={onChange}>
          {card ? 'Change' : 'Choose'}
        </button>
        {onRemove && (
          <button type="button" className={styles.small} onClick={onRemove}>
            Remove
          </button>
        )}
      </span>
    </div>
  );
}

/** Units by arena, then events and upgrades — each by cost, then name. */
const GROUPS: Array<{ label: string; test: (c: Card | undefined) => boolean }> = [
  { label: 'Ground units', test: (c) => c?.Type === 'Unit' && !c.Arenas?.includes('Space') },
  { label: 'Space units', test: (c) => c?.Type === 'Unit' && !!c.Arenas?.includes('Space') },
  { label: 'Events', test: (c) => c?.Type === 'Event' },
  { label: 'Upgrades', test: (c) => c?.Type === 'Upgrade' },
];

function ZoneList({
  title,
  zone,
  refs,
  count,
  lookup,
  owned,
  copyLimit,
  onCount,
  onMove,
}: {
  title: string;
  zone: DeckZone;
  refs: DeckCardRef[];
  count: number;
  lookup: Map<SetKey, DeckLookupSet>;
  owned: OwnedLookup;
  copyLimit: (card: Card | undefined) => number;
  onCount: (ref: DeckCardRef, delta: 1 | -1) => void;
  onMove: (ref: DeckCardRef) => void;
}) {
  const card = (ref: DeckCardRef) => lookup.get(ref.setKey)?.byNumber.get(ref.baseNumber);
  const sorted = [...refs].sort((a, b) => {
    const ca = card(a);
    const cb = card(b);
    return (ca?.Cost ?? 0) - (cb?.Cost ?? 0) || (ca?.Name ?? '').localeCompare(cb?.Name ?? '');
  });
  const groups = GROUPS.map((g) => ({ ...g, refs: sorted.filter((r) => g.test(card(r))) }));
  const other = sorted.filter((r) => !GROUPS.some((g) => g.test(card(r))));
  if (other.length) groups.push({ label: 'Other', test: () => false, refs: other });
  const otherZone = zone === 'main' ? 'sideboard' : 'main deck';

  return (
    <section className={styles.zone} aria-label={title}>
      <h2 className={styles.zoneTitle}>
        {title} <span className={styles.zoneCount}>{count}</span>
      </h2>
      {refs.length === 0 && (
        <p className={styles.empty}>
          {zone === 'main' ? 'No cards yet — add some from the search.' : 'Empty.'}
        </p>
      )}
      {groups
        .filter((g) => g.refs.length)
        .map((group) => (
          <div key={group.label} className={styles.group}>
            <h3 className={styles.groupTitle}>
              {group.label}{' '}
              <span className={styles.zoneCount}>
                {group.refs.reduce((n, r) => n + r.count, 0)}
              </span>
            </h3>
            <ul className={styles.lines}>
              {group.refs.map((ref) => {
                const c = card(ref);
                const have = owned(ref.setKey, ref.baseNumber);
                const name = c?.Name ?? `#${ref.baseNumber}`;
                return (
                  <li key={`${ref.setKey}:${ref.baseNumber}`} className={styles.line}>
                    <CostBadge cost={c?.Cost} />
                    <span className={styles.lineAspects}>
                      <AspectIcons aspects={c?.Aspects} />
                    </span>
                    <span className={styles.lineName}>
                      {name}
                      <span className={styles.subtitle}>
                        {c?.Subtitle ? `${c.Subtitle} · ` : ''}
                        {ref.setKey}
                        {have < ref.count && (
                          <span className={styles.unowned}>
                            {' '}
                            · own {have} of {ref.count}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className={styles.stepper}>
                      <button
                        type="button"
                        className={styles.step}
                        aria-label={`One fewer ${name}`}
                        onClick={() => onCount(ref, -1)}
                      >
                        −
                      </button>
                      <span className={styles.qty}>{ref.count}</span>
                      <button
                        type="button"
                        className={styles.step}
                        aria-label={`One more ${name}`}
                        disabled={ref.count >= copyLimit(c)}
                        onClick={() => onCount(ref, 1)}
                      >
                        +
                      </button>
                    </span>
                    <button
                      type="button"
                      className={styles.move}
                      aria-label={`Move one ${name} to the ${otherZone}`}
                      title={`Move one to the ${otherZone}`}
                      onClick={() => onMove(ref)}
                    >
                      {zone === 'main' ? '→ SB' : '→ Main'}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
    </section>
  );
}
