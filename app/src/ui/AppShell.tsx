import { Link } from '@tanstack/react-router';
import { useLayoutEffect, useRef, type ReactNode } from 'react';

import { AccountMenu } from '~/features/account/AccountMenu';
import { FirstSyncDialog } from '~/features/account/FirstSyncDialog';
import { useIntakeCount } from '~/features/intake/useIntake';

import styles from './AppShell.module.css';
import { StorageBanner } from './StorageBanner';

export function AppShell({ children }: { children: ReactNode }) {
  const queued = useIntakeCount();
  const header = useHeaderHeight();
  return (
    <div className={styles.shell}>
      <header ref={header} className={styles.header}>
        <h1 className={styles.title}>SWU Organizer</h1>
        <nav className={styles.nav} aria-label="Main">
          <Link to="/inventory" className={styles.navLink} activeProps={{ 'aria-current': 'page' }}>
            Inventory
          </Link>
          <Link to="/decks" className={styles.navLink} activeProps={{ 'aria-current': 'page' }}>
            Decks
          </Link>
          <Link to="/intake" className={styles.navLink} activeProps={{ 'aria-current': 'page' }}>
            Intake
            {queued > 0 && (
              <span className={styles.count} aria-label={`, ${queued} cards waiting`}>
                {queued}
              </span>
            )}
          </Link>
          <Link to="/scan" className={styles.navLink} activeProps={{ 'aria-current': 'page' }}>
            Scan
          </Link>
        </nav>
        <div className={styles.account}>
          <AccountMenu />
        </div>
        <StorageBanner />
      </header>
      <FirstSyncDialog />
      <main className={styles.main}>{children}</main>
    </div>
  );
}

/**
 * Publishes the sticky header's height as `--app-header-height` on the root, so anything
 * else pinned to the top of the page (the binder's selected-card panel) can sit just
 * below it. The height changes as the header wraps and as the storage banner comes and goes.
 */
function useHeaderHeight() {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty('--app-header-height', `${el.offsetHeight}px`);
    publish();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--app-header-height');
    };
  }, []);
  return ref;
}
