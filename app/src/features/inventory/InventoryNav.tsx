import { Link } from '@tanstack/react-router';
import { useEffect, type ReactNode } from 'react';

import type { SetKey } from '~/domain/types';

import { usePublishedHeight } from '~/ui/usePublishedHeight';

import styles from './InventoryNav.module.css';
import { readLastSet, rememberPlace } from './lastPlace';

/**
 * Binder · List · Bulk. Binder and List show one set; Bulk shows the whole box, so leaving
 * it goes back to the set you were last looking at.
 */
export function InventoryNav({
  setKey,
  current,
}: {
  /** The set on screen; absent on the Bulk page. */
  setKey?: SetKey;
  current: 'binder' | 'list' | 'bulk';
}) {
  // Coming back to the Inventory tab, or reopening the app, returns to this page.
  useEffect(() => {
    rememberPlace(current, setKey);
  }, [current, setKey]);

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
      {setLink('binder')}
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

/**
 * The inventory's sub-nav: a dark strip hanging from the app bar, with Binder · List · Bulk
 * and, beside them (below them on a phone), whatever the page puts there — the set's name.
 * It sits first on the page, flush under the bar; on wider screens it pins there as the page
 * scrolls, and publishes its height so the binder's selected-card panel pins below it.
 */
export function InventorySubnav({
  setKey,
  current,
  children,
}: {
  setKey?: SetKey;
  current: 'binder' | 'list' | 'bulk';
  children?: ReactNode;
}) {
  const strip = usePublishedHeight<HTMLDivElement>('--inventory-subnav-height');
  return (
    <div ref={strip} className={styles.strip}>
      <InventoryNav setKey={setKey} current={current} />
      {children && <div className={styles.extra}>{children}</div>}
    </div>
  );
}
