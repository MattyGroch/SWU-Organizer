import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';

import { db } from '~/data/db';
import type { LoadedSet, SetManifestEntry } from '~/domain/catalog';
import type { SetKey } from '~/domain/types';
import { AspectIcons } from '~/features/binder/AspectIcons';
import { EMPTY_FILTERS, hasActiveFilters, type Filters } from '~/features/binder/cardRows';
import { FilterBar } from '~/features/binder/FilterBar';
import { RarityBadge } from '~/features/binder/RarityBadge';
import { useDeckLibrary } from '~/features/decks/useDeckLibrary';
import { Loader } from '~/ui/Loader';

import styles from './BulkPage.module.css';
import { filterBulkRows } from './bulkFilters';
import {
  buildBulkRows,
  groupBulkRows,
  printingsLabel,
  type BulkRow,
  type BulkSectionKey,
} from './bulkRows';
import { InventorySubnav } from './InventoryNav';
import { RemoveFromBulkDialog } from './RemoveFromBulkDialog';

const COLLAPSED_KEY = 'bulk:collapsed';

function readCollapsed(): Set<BulkSectionKey> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    return new Set(raw ? (JSON.parse(raw) as BulkSectionKey[]) : []);
  } catch {
    return new Set();
  }
}

function writeCollapsed(collapsed: Set<BulkSectionKey>) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
  } catch {
    // A remembered fold is a convenience; losing it is fine.
  }
}

type Props = {
  entries: SetManifestEntry[];
  sets: Map<SetKey, LoadedSet>;
};

/**
 * The bulk box: every copy beyond the binder's playsets, across every set — hidden sets
 * too, since their cards are just as real. The box itself is one unsorted pile, so this
 * list is how you find out whether a card is in it before you go digging.
 */
export function BulkPage({ entries, sets }: Props) {
  const { library } = useDeckLibrary();
  const owned = useLiveQuery(() => db.owned.filter((row) => (row.bulk ?? 0) > 0).toArray(), []);
  const [query, setQuery] = useState('');
  const [setFilter, setSetFilter] = useState<SetKey | ''>('');
  const [chips, setChips] = useState<Filters>(EMPTY_FILTERS);

  const setOrder = useMemo(() => entries.map((e) => e.key), [entries]);
  const all = useMemo(
    () => (owned ? buildBulkRows(owned, library, sets, setOrder) : []),
    [owned, library, sets, setOrder],
  );
  const rows = filterBulkRows(all, { setKey: setFilter, query, chips });
  const copies = rows.reduce((sum, row) => sum + row.boxCount, 0);
  const sections = groupBulkRows(rows);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = (key: BulkSectionKey) => {
    const next = new Set(collapsed);
    if (!next.delete(key)) next.add(key);
    writeCollapsed(next);
    setCollapsed(next);
  };
  const setsInBox = new Set(all.map((row) => row.setKey));
  const [removing, setRemoving] = useState<BulkRow | null>(null);

  return (
    <div className={styles.page}>
      <InventorySubnav current="bulk" />
      <div className={styles.toolbar}>
        <label className={styles.setPicker}>
          <span className="visually-hidden">Set</span>
          <select value={setFilter} onChange={(event) => setSetFilter(event.target.value)}>
            <option value="">All sets</option>
            {entries
              .filter((entry) => setsInBox.has(entry.key))
              .map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.label}
                </option>
              ))}
          </select>
        </label>
        <label className={styles.search}>
          <span className="visually-hidden">Search the bulk box</span>
          <input
            type="search"
            value={query}
            placeholder="Search name or number…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      <FilterBar filters={chips} onChange={setChips} omit={['status', 'name']} />

      {owned === undefined ? (
        <Loader label="Opening the bulk box" />
      ) : (
        <p className={styles.summary} role="status">
          {`${copies} ${copies === 1 ? 'copy' : 'copies'} of ${rows.length} ${
            rows.length === 1 ? 'card' : 'cards'
          } in the bulk box${setFilter || query || hasActiveFilters(chips) ? ' match' : ''}.`}
        </p>
      )}

      {owned !== undefined && all.length === 0 && (
        <p className={styles.empty}>
          Nothing in the bulk box yet. Copies go here when a scan finds their binder pocket full, or
          a better printing bumps them out of it.
        </p>
      )}

      {rows.length > 0 && (
        <div className={styles.scroller}>
          <table className={styles.table} aria-label="Bulk box">
            <thead>
              <tr>
                <th scope="col" className={styles.where}>
                  Card
                </th>
                <th scope="col" className={styles.aspectCol}>
                  <span className="visually-hidden">Aspect</span>
                </th>
                <th scope="col" className={styles.rarityCol}>
                  <span className="visually-hidden">Rarity</span>
                </th>
                <th scope="col">Name</th>
                <th scope="col">In the box</th>
                <th scope="col" className={styles.decks} title="Bulk-box copies out in built decks">
                  In decks
                </th>
              </tr>
            </thead>
            {sections.map((section) => {
              const open = !collapsed.has(section.key);
              const sectionCopies = section.rows.reduce((sum, row) => sum + row.boxCount, 0);
              return (
                <tbody key={section.key}>
                  <tr className={styles.sectionRow}>
                    <th scope="rowgroup" colSpan={6}>
                      <button
                        type="button"
                        className={styles.sectionToggle}
                        aria-expanded={open}
                        onClick={() => toggle(section.key)}
                      >
                        <span className={styles.chevron} aria-hidden="true" />
                        {section.label}
                        <span className={styles.sectionCount}>
                          {section.rows.length} {section.rows.length === 1 ? 'card' : 'cards'} ·{' '}
                          {sectionCopies} {sectionCopies === 1 ? 'copy' : 'copies'}
                        </span>
                      </button>
                    </th>
                  </tr>
                  {open &&
                    section.rows.map((row) => (
                      <tr key={`${row.setKey}:${row.base}`}>
                        <td className={styles.where}>
                          {row.setKey} #{row.base}
                        </td>
                        <td className={styles.aspectCol}>
                          <AspectIcons className={styles.aspects} aspects={row.aspects} />
                        </td>
                        <td className={styles.rarityCol}>
                          <RarityBadge rarity={row.rarity} title={row.rarity}>
                            <span className="visually-hidden">{row.rarity}</span>
                          </RarityBadge>
                        </td>
                        <td className={styles.name}>
                          <Link
                            to="/inventory/$setKey/$view"
                            params={{ setKey: row.setKey, view: 'list' }}
                            search={{ card: row.base }}
                          >
                            {row.name}
                          </Link>
                          {row.subtitle && <span className={styles.subtitle}>{row.subtitle}</span>}
                          <span className={styles.narrowWhere}>
                            {row.setKey} #{row.base}
                          </span>
                        </td>
                        <td>
                          <div className={styles.boxCell}>
                            <span>
                              <span className={styles.count}>{row.boxCount}</span>
                              {row.boxCount > 0 && (
                                <span className={styles.printings}>
                                  {printingsLabel(row.inBox)}
                                </span>
                              )}
                            </span>
                            {row.boxCount > 0 && (
                              <button
                                type="button"
                                className={styles.remove}
                                title="Remove from the bulk box (sold, traded, given away)"
                                aria-label={`Remove ${row.name} from the bulk box`}
                                onClick={() => setRemoving(row)}
                              >
                                −
                              </button>
                            )}
                          </div>
                        </td>
                        <td className={styles.decks}>{row.inDecks || ''}</td>
                      </tr>
                    ))}
                </tbody>
              );
            })}
          </table>
        </div>
      )}

      {removing && (
        <RemoveFromBulkDialog
          key={`${removing.setKey}:${removing.base}`}
          row={removing}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
