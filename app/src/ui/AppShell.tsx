import { Link } from '@tanstack/react-router';
import { type ReactNode } from 'react';

import { AccountMenu } from '~/features/account/AccountMenu';
import { FirstSyncDialog } from '~/features/account/FirstSyncDialog';
import { useIntakeCount } from '~/features/intake/useIntake';

import styles from './AppShell.module.css';
import { StorageBanner } from './StorageBanner';
import { usePublishedHeight } from './usePublishedHeight';

export function AppShell({ children }: { children: ReactNode }) {
  const queued = useIntakeCount();
  // The binder's selected-card panel and the inventory sub-nav pin just below the header.
  const header = usePublishedHeight<HTMLElement>('--app-header-height');
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
