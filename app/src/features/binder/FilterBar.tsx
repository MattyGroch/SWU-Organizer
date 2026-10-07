import { useState, type CSSProperties, type ReactNode } from 'react';

import {
  ALL_ASPECTS,
  ALL_RARITIES,
  ALL_STATUSES,
  ALL_TYPES,
  EMPTY_FILTERS,
  hasActiveFilters,
  STATUS_GLYPH,
  STATUS_LABEL,
  type Filters,
} from './cardRows';
import styles from './FilterBar.module.css';
import { RarityBadge } from './RarityBadge';
import { AspectGlyph } from './AspectGlyph';

type Props = {
  filters: Filters;
  onChange: (filters: Filters) => void;
  /** Extra class for the panel, e.g. to sit inline in the phone toolbar. */
  className?: string;
};

const ASPECT_VAR: Record<string, string> = {
  Vigilance: '--aspect-vigilance',
  Command: '--aspect-command',
  Aggression: '--aspect-aggression',
  Cunning: '--aspect-cunning',
  Heroism: '--aspect-heroism',
  Villainy: '--aspect-villainy',
  NEUTRAL: '--aspect-neutral',
};

const RARITY_VAR: Record<string, string> = {
  Common: '--rarity-common',
  Uncommon: '--rarity-uncommon',
  Rare: '--rarity-rare',
  Legendary: '--rarity-legendary',
  Special: '--rarity-special',
};

/**
 * Each filter category is a labelled, visually separated group.
 *
 * A single undifferentiated pool of twenty-odd chips is hard to scan — you cannot tell
 * where aspects end and rarities begin without reading every label.
 */
function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{label}</legend>
      <div className={styles.chips}>{children}</div>
    </fieldset>
  );
}

/** Phones get the filters folded away by default: they would fill the whole screen. */
const NARROW = '(max-width: 760px)';

/**
 * The chip's own colour, for its indicator light and the HUD's lit edge (styles/hud.css).
 * data-tone="dark" (Villainy, Neutral, Special): too dark to glow, so those light in silver.
 */
function toneStyle(colorVar: string | undefined): CSSProperties | undefined {
  return colorVar ? ({ '--chip-color': `var(${colorVar})` } as CSSProperties) : undefined;
}

function activeFilterCount(filters: Filters): number {
  return (
    filters.aspect.length +
    filters.rarity.length +
    filters.type.length +
    filters.status.length +
    (filters.text.trim() ? 1 : 0) +
    (filters.hideInDecks ? 1 : 0)
  );
}

export function FilterBar({ filters, onChange, className }: Props) {
  const [open, setOpen] = useState(() => !window.matchMedia?.(NARROW)?.matches);
  const active = activeFilterCount(filters);
  function toggle<K extends 'aspect' | 'rarity' | 'type' | 'status'>(
    key: K,
    value: Filters[K][number],
  ) {
    const current = filters[key] as Array<Filters[K][number]>;
    const next = current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value];
    onChange({ ...filters, [key]: next });
  }

  return (
    <details
      className={className ? `${styles.panel} ${className}` : styles.panel}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className={styles.summary}>
        Filters
        {/* Folded away, the count is what says the table is narrowed. */}
        {active > 0 && <span className={styles.activeCount}>{active} active</span>}
      </summary>
      <div className={styles.bar}>
        <FilterGroup label="Aspect">
          {ALL_ASPECTS.map((aspect) => {
            const label = aspect === 'NEUTRAL' ? 'Neutral' : aspect;
            return (
              <button
                key={aspect}
                type="button"
                className={`${styles.chip} ${styles.aspectChip}`}
                aria-pressed={filters.aspect.includes(aspect)}
                aria-label={label}
                title={label}
                style={toneStyle(ASPECT_VAR[aspect])}
                data-tone={aspect === 'Villainy' || aspect === 'NEUTRAL' ? 'dark' : undefined}
                data-fill="solid"
                data-aspect={aspect}
                onClick={() => toggle('aspect', aspect)}
              >
                {aspect === 'NEUTRAL' ? (
                  <span className={styles.neutralPip} aria-hidden="true" />
                ) : (
                  <AspectGlyph aspect={aspect} className={styles.aspectGlyph} />
                )}
              </button>
            );
          })}
        </FilterGroup>

        <FilterGroup label="Rarity">
          {ALL_RARITIES.map((rarity) => {
            const active = filters.rarity.includes(rarity);
            return (
              <button
                key={rarity}
                type="button"
                className={`${styles.chip} ${styles.rarityChip}`}
                aria-pressed={active}
                aria-label={rarity}
                title={rarity}
                style={toneStyle(RARITY_VAR[rarity])}
                data-tone={rarity === 'Special' ? 'dark' : undefined}
                onClick={() => toggle('rarity', rarity)}
              >
                <RarityBadge rarity={rarity} />
              </button>
            );
          })}
        </FilterGroup>

        <FilterGroup label="Type">
          {ALL_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              className={styles.chip}
              aria-pressed={filters.type.includes(type)}
              onClick={() => toggle('type', type)}
            >
              {type}
            </button>
          ))}
        </FilterGroup>

        <FilterGroup label="Status">
          {ALL_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              className={`${styles.chip} ${styles.statusChip}`}
              data-status={status}
              aria-pressed={filters.status.includes(status)}
              title={STATUS_LABEL[status]}
              aria-label={STATUS_LABEL[status]}
              onClick={() => toggle('status', status)}
            >
              <span aria-hidden="true">{STATUS_GLYPH[status]}</span>
            </button>
          ))}
          <button
            type="button"
            className={styles.chip}
            aria-pressed={filters.hideInDecks}
            title="Hide cards you own a full playset of, but whose slot is short because copies are in built decks"
            onClick={() => onChange({ ...filters, hideInDecks: !filters.hideInDecks })}
          >
            Hide out in decks
          </button>
        </FilterGroup>

        <FilterGroup label="Name">
          <input
            type="search"
            className={styles.text}
            placeholder="Filter by name…"
            aria-label="Filter cards by name"
            value={filters.text}
            onChange={(event) => onChange({ ...filters, text: event.target.value })}
          />
          <button
            type="button"
            className={styles.clear}
            onClick={() => onChange(EMPTY_FILTERS)}
            disabled={!hasActiveFilters(filters)}
          >
            Clear all
          </button>
        </FilterGroup>
      </div>
    </details>
  );
}
