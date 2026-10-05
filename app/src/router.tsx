import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  type RouterHistory,
} from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';

import {
  loadedSets,
  manifestQuery,
  newestSetKey,
  prefetchOtherSets,
  preconQuery,
  setQuery,
} from '~/data/catalog';
import { binderEntries, readHiddenSets } from '~/data/binderSettings';
import { BinderRoute } from '~/routes/BinderRoute';
import { DecksRoute } from '~/routes/DecksRoute';
import { IntakePage } from '~/features/intake/IntakePage';
import { ScanPage } from '~/features/scan/ScanPage';
import { AppShell } from '~/ui/AppShell';

/**
 * Routing exists so the app has addressable state. The legacy app held its view in
 * `useState<'binder' | 'decks'>`, so there was no URL for "SOR, page 12", no back button,
 * and nothing to link to. The scanner needs a real route regardless.
 */

export type RouterContext = { queryClient: QueryClient };

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: async ({ context }) => {
    const entries = await context.queryClient.ensureQueryData(manifestQuery());
    const key = newestSetKey(binderEntries(entries, await readHiddenSets()));
    throw redirect({ to: '/binder/$setKey', params: { setKey: key ?? 'SOR' } });
  },
});

const binderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/binder/$setKey',
  /**
   * `?card=` names the base number to select on arrival, which is what makes a binder
   * position linkable — "SOR, page 12, Vader selected" is a URL rather than transient
   * component state. Search params are untyped until validated, so an unvalidated one
   * would simply be dropped.
   */
  validateSearch: (search: Record<string, unknown>): { card?: number } => {
    const card = Number(search.card);
    return Number.isInteger(card) && card > 0 ? { card } : {};
  },
  loader: async ({ context, params }) => {
    const entries = await context.queryClient.ensureQueryData(manifestQuery());
    const entry = entries.find((e) => e.key === params.setKey);
    if (!entry) throw redirect({ to: '/' });
    // A set hidden from the binder has no pages; send its link to the default binder.
    const visible = binderEntries(entries, await readHiddenSets());
    if (!visible.some((e) => e.key === params.setKey)) throw redirect({ to: '/' });

    // Only the active set is awaited; the rest warm in the background so first paint
    // never waits on them.
    const set = await context.queryClient.ensureQueryData(setQuery(entry));
    prefetchOtherSets(context.queryClient, entries, params.setKey);
    return { set, entries };
  },
  component: function BinderRouteComponent() {
    const { set, entries } = binderRoute.useLoaderData();
    const { card } = binderRoute.useSearch();
    return <BinderRoute set={set} entries={entries} selectCard={card} />;
  },
});

const decksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/decks',
  loader: async ({ context }) => {
    const entries = await context.queryClient.ensureQueryData(manifestQuery());
    // Deck check needs every set, so unlike the binder this route waits for all of them.
    await Promise.all(entries.map((entry) => context.queryClient.ensureQueryData(setQuery(entry))));
    const precons = await context.queryClient.ensureQueryData(preconQuery()).catch(() => []);
    return { entries, precons };
  },
  component: function DecksRouteComponent() {
    const { entries, precons } = decksRoute.useLoaderData();
    const { queryClient } = decksRoute.useRouteContext();
    return <DecksRoute sets={loadedSets(queryClient, entries)} precons={precons} />;
  },
});

const intakeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/intake',
  loader: async ({ context }) => {
    const entries = await context.queryClient.ensureQueryData(manifestQuery());
    // A batch can hold cards from any set, and each line needs its set's printings.
    await Promise.all(entries.map((entry) => context.queryClient.ensureQueryData(setQuery(entry))));
    return { entries };
  },
  component: function IntakeRouteComponent() {
    const { entries } = intakeRoute.useLoaderData();
    const { queryClient } = intakeRoute.useRouteContext();
    return <IntakePage sets={loadedSets(queryClient, entries)} />;
  },
});

const scanRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/scan',
  loader: async ({ context }) => {
    const entries = await context.queryClient.ensureQueryData(manifestQuery());
    // A scan can be any card in any set: names, printings and binder slots come from here.
    await Promise.all(entries.map((entry) => context.queryClient.ensureQueryData(setQuery(entry))));
    return { entries };
  },
  component: function ScanRouteComponent() {
    const { entries } = scanRoute.useLoaderData();
    const { queryClient } = scanRoute.useRouteContext();
    return <ScanPage sets={loadedSets(queryClient, entries)} />;
  },
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  binderRoute,
  decksRoute,
  intakeRoute,
  scanRoute,
]);

/** `history` defaults to the browser's; tests pass an in-memory one. */
export function buildRouter(queryClient: QueryClient, history?: RouterHistory) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    ...(history && { history }),
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof buildRouter>;
  }
}
