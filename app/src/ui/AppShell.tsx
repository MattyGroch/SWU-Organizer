import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { AccountMenu } from '~/features/account/AccountMenu';
import { FirstSyncDialog } from '~/features/account/FirstSyncDialog';
import { useIntakeCount } from '~/features/intake/useIntake';

import styles from './AppShell.module.css';

export function AppShell({ children }: { children: ReactNode }) {
  const queued = useIntakeCount();
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <h1 className={styles.title}>SWU Organizer</h1>
        <nav className={styles.nav} aria-label="Main">
          <Link to="/" className={styles.navLink} activeProps={{ 'aria-current': 'page' }}>
            Binder
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
      </header>
      <FirstSyncDialog />
      <main className={styles.main}>{children}</main>
    </div>
  );
}
