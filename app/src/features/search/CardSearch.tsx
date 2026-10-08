import { useEffect, useId, useMemo, useRef, useState } from 'react';

import {
  buildSearchSuggestions,
  submittedSuggestion,
  type SearchCatalog,
  type SearchSuggestion,
} from '~/domain/search';
import type { SetKey } from '~/domain/types';

import styles from './CardSearch.module.css';

/**
 * How many suggestions to show.
 *
 * Search spans every loaded set, so a common name matches far more than the old
 * single-set assumption allowed — "Vader" alone is 13 cards across 8 sets. One extra is
 * requested so truncation can be reported rather than silently hiding matches.
 */
const DISPLAY_LIMIT = 25;

type Props = {
  catalogs: SearchCatalog[];
  currentSetKey: SetKey;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChoose: (suggestion: SearchSuggestion) => void;
  onQueryChange?: (query: string) => void;
  /**
   * On phones, let the results span the page instead of the search box — for a box that
   * shares its row with other controls and would otherwise cut every name short.
   */
  wideResults?: boolean;
};

/**
 * Name/number typeahead across every loaded set.
 *
 * Implements the ARIA combobox pattern — the legacy version was a bare `<input>` beside a
 * `<div class="sug">` with no roles, no `aria-activedescendant`, and no announcement of
 * how many results were found.
 */
export function CardSearch({
  catalogs,
  currentSetKey,
  inputRef,
  onChoose,
  onQueryChange,
  wideResults = false,
}: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const listId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const matches = useMemo(
    () => buildSearchSuggestions(query, catalogs, currentSetKey, DISPLAY_LIMIT + 1),
    [query, catalogs, currentSetKey],
  );
  const suggestions = matches.length > DISPLAY_LIMIT ? matches.slice(0, DISPLAY_LIMIT) : matches;
  const truncated = matches.length > DISPLAY_LIMIT;

  useEffect(() => onQueryChange?.(query), [query, onQueryChange]);

  /**
   * Keeps the keyboard-highlighted option visible.
   *
   * The list scrolls, but arrowing past its lower edge left the highlight off-screen —
   * so a result below the fold could be selected but never seen. `block: 'nearest'`
   * scrolls the list only as far as needed, rather than jumping the option to the centre.
   */
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLLIElement>('[data-active="true"]')
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [open, highlight, suggestions.length]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  function choose(suggestion: SearchSuggestion) {
    onChoose(suggestion);
    setQuery('');
    setOpen(false);
    setHighlight(0);
    inputRef.current?.blur();
  }

  function submit() {
    const suggestion = submittedSuggestion(suggestions, highlight);
    if (suggestion) choose(suggestion);
  }

  return (
    <div
      ref={containerRef}
      className={wideResults ? `${styles.container} ${styles.wideContainer}` : styles.container}
    >
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open && suggestions.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && suggestions[highlight] ? `${listId}-${highlight}` : undefined
        }
        aria-label="Search cards by name or number"
        placeholder="Search name or number…"
        className={styles.input}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setHighlight(0);
        }}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
            setHighlight((i) => Math.min(i + 1, Math.max(0, suggestions.length - 1)));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setHighlight((i) => Math.max(i - 1, 0));
          } else if (event.key === 'Enter') {
            event.preventDefault();
            submit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            setOpen(false);
            setHighlight(0);
            inputRef.current?.blur();
          }
        }}
      />

      <span className={styles.hint} aria-hidden="true">
        /
      </span>

      <span role="status" className="visually-hidden">
        {query.trim() ? `${suggestions.length} result${suggestions.length === 1 ? '' : 's'}` : ''}
      </span>

      {open && suggestions.length > 0 && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Card suggestions"
          className={wideResults ? `${styles.list} ${styles.wideList}` : styles.list}
        >
          {suggestions.map((suggestion, index) => (
            <li
              key={`${suggestion.setKey}:${suggestion.baseNumber}`}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === highlight}
              data-active={index === highlight}
              className={`${styles.option} ${index === highlight ? styles.active : ''}`}
              onMouseEnter={() => setHighlight(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(suggestion);
              }}
            >
              <span className={styles.setBadge} data-current={suggestion.setKey === currentSetKey}>
                {suggestion.setKey}
              </span>
              <span className={styles.optionName}>
                {suggestion.name}
                {suggestion.subtitle && (
                  <span className={styles.optionSubtitle}>{suggestion.subtitle}</span>
                )}
              </span>
              {suggestion.type && <span className={styles.optionType}>{suggestion.type}</span>}
              <span className={styles.optionNumbers}>
                {suggestion.printingNumbers.map((n) => `#${n}`).join(', ')}
              </span>
            </li>
          ))}
          {truncated && (
            <li className={styles.truncated} role="presentation">
              More matches — keep typing to narrow it down.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
