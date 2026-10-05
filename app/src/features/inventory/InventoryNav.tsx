import { Link } from '@tanstack/react-router';
import { useEffect } from 'react';

import type { SetKey } from '~/domain/types';
import { useNarrow } from '~/ui/useNarrow';

import styles from './InventoryNav.module.css';

const LAST_SET_KEY = 'inventory:lastSet';

function readLastSet(): SetKey | undefined {
  try {
    return localStorage.getItem(LAST_SET_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Binder · List · Bulk. Binder and List show one set; Bulk shows the whole box, so leaving
 * it goes back to the set you were last looking at. Phones have no binder grid, so no
 * Binder tab.
 */
export function InventoryNav({
  setKey,
  current,
}: {
  /** The set on screen; absent on the Bulk page. */
  setKey?: SetKey;
  current: 'binder' | 'list' | 'bulk';
}) {
  const narrow = useNarrow();

  useEffect(() => {
    if (!setKey) return;
    try {
      localStorage.setItem(LAST_SET_KEY, setKey);
    } catch {
      // A convenience only: without storage, leaving Bulk opens the newest set instead.
    }
  }, [setKey]);

  const key = setKey ?? readLastSet();
  const setLink = (view: 'binder' | 'list') =>
    key ? (
      <Link
        to="/inventory/$setKey/$view"
        params={{ setKey: key, view }}
        className={styles.tab}
        aria-current={current === view ? 'page' : undefined}
      >
        {view === 'binder' ? 'Binder' : 'List'}
      </Link>
    ) : (
      <Link to="/inventory" className={styles.tab}>
        {view === 'binder' ? 'Binder' : 'List'}
      </Link>
    );

  return (
    <nav className={styles.nav} aria-label="Inventory">
      {!narrow && setLink('binder')}
      {setLink('list')}
      <Link
        to="/inventory/bulk"
        className={styles.tab}
        aria-current={current === 'bulk' ? 'page' : undefined}
      >
        Bulk
      </Link>
    </nav>
  );
}
