import { useQuery, type QueryClient } from '@tanstack/react-query';
import { Link, Outlet, type ErrorComponentProps } from '@tanstack/react-router';
import { type ReactNode } from 'react';

import { ShareNotFoundError, SharedCollectionContext, sharedQuery } from '~/data/shared';
import shellStyles from '~/ui/AppShell.module.css';
import { Loader } from '~/ui/Loader';
import { usePublishedHeight } from '~/ui/usePublishedHeight';

import styles from './ShareShell.module.css';

/**
 * The frame around a share link: the app bar, saying whose view this is and offering the
 * way back, with none of your own tabs, account or sync. The pages inside read the share
 * through `SharedCollectionContext`, never this device's database.
 */
export function ShareLayout({ queryClient, token }: { queryClient: QueryClient; token: string }) {
  const query = useQuery(sharedQuery(queryClient, token));

  let body: ReactNode;
  if (query.data) {
    body = (
      <SharedCollectionContext.Provider value={query.data}>
        <Outlet />
      </SharedCollectionContext.Provider>
    );
  } else if (query.error) {
    body = <ShareProblem error={query.error} />;
  } else {
    body = <Loader label="Opening the shared collection" />;
  }

  return <ShareShell>{body}</ShareShell>;
}

function ShareShell({ children }: { children: ReactNode }) {
  // The binder's selected-card panel and the inventory sub-nav pin just below the header.
  const header = usePublishedHeight<HTMLElement>('--app-header-height');
  return (
    <div className={shellStyles.shell}>
      <header ref={header} className={shellStyles.header}>
        <h1 className={shellStyles.title}>SWU Organizer</h1>
        <p className={styles.notice}>
          <strong>Shared collection</strong>
          <span>read-only</span>
        </p>
        <Link to="/" className={styles.exit}>
          Exit
        </Link>
      </header>
      <main className={shellStyles.main}>{children}</main>
    </div>
  );
}

function ShareProblem({ error }: { error: unknown }) {
  const gone = error instanceof ShareNotFoundError;
  return (
    <div className={styles.gone} role="alert">
      <h2>{gone ? 'This link isn’t shared any more' : 'Couldn’t open this collection'}</h2>
      <p>
        {gone
          ? 'Its owner has turned the link off, or made a new one. Ask them for the current link.'
          : 'The server didn’t answer. Check your connection and try again.'}
      </p>
      <Link to="/" className={styles.exit}>
        Go to your collection
      </Link>
    </div>
  );
}

/** For a share page that couldn't load: the same message, inside the share's frame. */
export function ShareError({ error }: ErrorComponentProps) {
  return <ShareProblem error={error} />;
}
