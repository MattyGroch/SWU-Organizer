import { useEffect, type ReactNode } from 'react';

import { useSharedCollection } from '~/data/shared';
import type { SetKey } from '~/domain/types';

import { usePublishedHeight } from '~/ui/usePublishedHeight';

import styles from './InventoryNav.module.css';
import { InventoryLink } from './inventoryLinks';
import { readLastSet, rememberPlace, type InventoryPlace } from './lastPlace';

/**
 * Binder · List · Bulk · Stats. Binder and List show one set; Bulk and Stats span every
 * set, so leaving them goes back to the set you were last looking at.
 */
export function InventoryNav({
  setKey,
  current,
}: {
  /** The set on screen; absent on the Bulk and Stats pages. */
  setKey?: SetKey;
  current: InventoryPlace;
}) {
  // A share link is someone else's collection: where you were in it isn't your place.
  const shared = useSharedCollection() !== null;

  // Coming back to the Inventory tab, or reopening the app, returns to this page.
  useEffect(() => {
    if (!shared) rememberPlace(current, setKey);
  }, [current, setKey, shared]);

  const key = setKey ?? (shared ? undefined : readLastSet());
  const setLink = (view: 'binder' | 'list') =>
    key ? (
      <InventoryLink
        target={{ place: 'set', setKey: key, view }}
        className={styles.tab}
        aria-current={current === view ? 'page' : undefined}
      >
        {view === 'binder' ? 'Binder' : 'List'}
      </InventoryLink>
    ) : (
      // No set opened yet: /inventory picks one, but it goes to the last view remembered,
      // which from here is Bulk or Stats — so remember the view tapped first, or the tab loops back.
      // Exact, or the router marks it current on every page under /inventory.
      <InventoryLink
        target={{ place: 'home' }}
        activeOptions={{ exact: true }}
        className={styles.tab}
        onClick={shared ? undefined : () => rememberPlace(view)}
      >
        {view === 'binder' ? 'Binder' : 'List'}
      </InventoryLink>
    );

  return (
    <nav className={styles.nav} aria-label="Inventory">
      {setLink('binder')}
      {setLink('list')}
      <InventoryLink
        target={{ place: 'bulk' }}
        className={styles.tab}
        aria-current={current === 'bulk' ? 'page' : undefined}
      >
        Bulk
      </InventoryLink>
      <InventoryLink
        target={{ place: 'stats' }}
        className={styles.tab}
        aria-current={current === 'stats' ? 'page' : undefined}
      >
        Stats
      </InventoryLink>
    </nav>
  );
}

/**
 * The inventory's sub-nav: a dark strip hanging from the app bar, with Binder · List · Bulk
 * and, beside them (below them on a phone), whatever the page puts there — the set's name —
 * with the page's own settings at the far right.
 * It sits first on the page, flush under the bar; on wider screens it pins there as the page
 * scrolls, and publishes its height so the binder's selected-card panel pins below it.
 */
export function InventorySubnav({
  setKey,
  current,
  children,
  actions,
}: {
  setKey?: SetKey;
  current: InventoryPlace;
  children?: ReactNode;
  /** Buttons at the strip's right edge, e.g. the set settings. */
  actions?: ReactNode;
}) {
  const strip = usePublishedHeight<HTMLDivElement>('--inventory-subnav-height');
  return (
    <div ref={strip} className={styles.strip}>
      <InventoryNav setKey={setKey} current={current} />
      {children && <div className={styles.extra}>{children}</div>}
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
