import { useMemo, useState } from 'react';

import type { CardPool, PlayFormat } from '~/domain/deckLegality';
import type { Card, SetKey } from '~/domain/types';

import { AspectIcons } from '../binder/AspectIcons';
import styles from './CardSearch.module.css';
import type { OwnedLookup } from './deckRows';
import {
  COST_CHIPS,
  DECK_TYPES,
  DEFAULT_FILTERS,
  searchCards,
  type SearchFilters,
  type SearchHit,
  type SearchMode,
} from './deckSearch';
import type { DeckZone } from '~/domain/deckEdit';

const PAGE = 40;

type Props = {
  sets: ReadonlyArray<{ setKey: SetKey; baseCards: Card[] }>;
  mode: SearchMode;
  format: PlayFormat;
  pool: CardPool;
  deckAspects: readonly string[];
  owned: OwnedLookup;
  /** Copies the deck lists in a zone, to show beside each result. */
  inDeck: (setKey: SetKey, baseNumber: number, zone: DeckZone) => number;
  onAdd: (hit: SearchHit, zone: DeckZone) => void;
  onChoose: (hit: SearchHit) => void;
  onCancelChoose: () => void;
};

const MODE_TITLE: Record<SearchMode, string> = {
  cards: 'Add cards',
  leader: 'Choose a leader',
  base: 'Choose a base',
};

/**
 * Looks up cards for the deck: everything legal in its format, or only what you own. In
 * leader and base mode the same panel picks those instead, then goes back to cards.
 */
export function CardSearch({
  sets,
  mode,
  format,
  pool,
  deckAspects,
  owned,
  inDeck,
  onAdd,
  onChoose,
  onCancelChoose,
}: Props) {
  const [filters, setFilters] = useState<SearchFilters>(DEFAULT_FILTERS);
  const [shown, setShown] = useState(PAGE);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const hits = useMemo(
    () => searchCards({ sets, mode, filters, format, pool, deckAspects, owned }),
    [sets, mode, filters, format, pool, deckAspects, owned],
  );

  function update(patch: Partial<SearchFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setShown(PAGE);
  }

  function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  return (
    <section className={styles.panel} aria-labelledby="card-search-title">
      <div className={styles.heading}>
        <h2 id="card-search-title" className={styles.title}>
          {MODE_TITLE[mode]}
        </h2>
        {mode !== 'cards' && (
          <button type="button" className={styles.secondary} onClick={onCancelChoose}>
            Cancel
          </button>
        )}
      </div>

      <input
        type="search"
        className={styles.text}
        placeholder="Name, trait or rules text…"
        aria-label="Search cards"
        value={filters.text}
        onChange={(event) => update({ text: event.target.value })}
      />

      <div className={styles.chips} role="group" aria-label="Which cards">
        <button
          type="button"
          className={styles.chip}
          aria-pressed={filters.ownedOnly}
          onClick={() => update({ ownedOnly: true })}
        >
          Owned
        </button>
        <button
          type="button"
          className={styles.chip}
          aria-pressed={!filters.ownedOnly}
          onClick={() => update({ ownedOnly: false })}
        >
          All cards
        </button>
        {mode === 'cards' && (
          <button
            type="button"
            className={styles.chip}
            aria-pressed={filters.inAspect}
            title="Only cards your leader and base pay for without an aspect penalty"
            onClick={() => update({ inAspect: !filters.inAspect })}
          >
            In aspect
          </button>
        )}
      </div>

      {mode === 'cards' && (
        <>
          <div className={styles.chips} role="group" aria-label="Type">
            {DECK_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                className={styles.chip}
                aria-pressed={filters.types.includes(type)}
                onClick={() => update({ types: toggle(filters.types, type) })}
              >
                {type}
              </button>
            ))}
          </div>
          <div className={styles.chips} role="group" aria-label="Cost">
            {COST_CHIPS.map((cost) => (
              <button
                key={cost}
                type="button"
                className={`${styles.chip} ${styles.costChip}`}
                aria-pressed={filters.costs.includes(cost)}
                aria-label={cost === 7 ? 'Cost 7 or more' : `Cost ${cost}`}
                onClick={() => update({ costs: toggle(filters.costs, cost) })}
              >
                {cost === 7 ? '7+' : cost}
              </button>
            ))}
          </div>
        </>
      )}

      <p className={styles.count} aria-live="polite">
        {hits.length} {hits.length === 1 ? 'card' : 'cards'}
      </p>

      <ul className={styles.results} aria-label="Search results">
        {hits.slice(0, shown).map((hit) => {
          const key = `${hit.setKey}:${hit.card.Number}`;
          const open = openKey === key;
          const main = inDeck(hit.setKey, hit.card.Number, 'main');
          const side = inDeck(hit.setKey, hit.card.Number, 'side');
          return (
            <li key={key} className={styles.hit}>
              <div className={styles.hitRow}>
                {mode === 'cards' && <span className={styles.cost}>{hit.card.Cost ?? '–'}</span>}
                <AspectIcons className={styles.aspects} aspects={hit.card.Aspects} />
                <button
                  type="button"
                  className={styles.name}
                  aria-expanded={open}
                  onClick={() => setOpenKey(open ? null : key)}
                >
                  {hit.card.Name}
                  {hit.card.Subtitle && (
                    <span className={styles.subtitle}>{hit.card.Subtitle}</span>
                  )}
                  <span className={styles.meta}>
                    {hit.setKey} #{hit.card.Number}
                    {hit.card.Arenas?.length ? ` · ${hit.card.Arenas.join('/')}` : ''}
                    {' · '}
                    {hit.owned > 0 ? `own ${hit.owned}` : 'not owned'}
                    {main + side > 0 && ` · in deck ${main}${side ? ` + ${side} side` : ''}`}
                  </span>
                </button>
                {mode === 'cards' ? (
                  <span className={styles.adds}>
                    <button
                      type="button"
                      className={styles.add}
                      aria-label={`Add ${hit.card.Name} to the main deck`}
                      onClick={() => onAdd(hit, 'main')}
                    >
                      +&nbsp;Main
                    </button>
                    <button
                      type="button"
                      className={styles.add}
                      aria-label={`Add ${hit.card.Name} to the sideboard`}
                      onClick={() => onAdd(hit, 'side')}
                    >
                      +&nbsp;Side
                    </button>
                  </span>
                ) : (
                  <button type="button" className={styles.add} onClick={() => onChoose(hit)}>
                    Choose
                  </button>
                )}
              </div>
              {open && <CardText card={hit.card} />}
            </li>
          );
        })}
      </ul>

      {hits.length > shown && (
        <button type="button" className={styles.secondary} onClick={() => setShown(shown + PAGE)}>
          Show more ({hits.length - shown} left)
        </button>
      )}
    </section>
  );
}

function CardText({ card }: { card: Card }) {
  const stats = [
    card.Type,
    card.Power !== undefined && card.HP !== undefined ? `${card.Power}/${card.HP}` : undefined,
    card.Power === undefined && card.HP !== undefined ? `${card.HP} HP` : undefined,
    card.Traits?.join(', '),
  ].filter(Boolean);
  return (
    <div className={styles.cardText}>
      <p className={styles.stats}>{stats.join(' · ')}</p>
      {card.Text?.split('\n').map((line, i) => (
        <p key={i}>{line}</p>
      ))}
    </div>
  );
}
